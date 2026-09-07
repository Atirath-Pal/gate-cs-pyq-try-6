require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { createClient } = require('@libsql/client');

const app = express();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

app.use(cors());
app.use(express.json());

function signToken(user) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name || null, picture: user.picture || null };
}

function normaliseEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function requireAuth(req, res, next) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!match) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(match[1], process.env.JWT_SECRET);
    if (!decoded || typeof decoded.userId !== 'string') throw new Error('Invalid token payload');
    req.userId = decoded.userId;
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function findUserByEmailOrGoogleId(email, googleId) {
  const result = await db.execute({
    sql: 'SELECT id, email, password_hash, google_id, name, picture FROM users WHERE email = ? OR google_id = ? LIMIT 1',
    args: [email, googleId]
  });
  return result.rows[0] || null;
}

async function initSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      name TEXT,
      picture TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrate the earlier users.user_id table without losing existing progress.
  const columns = (await db.execute('PRAGMA table_info(users)')).rows.map((column) => column.name);
  const additions = { id: 'TEXT', password_hash: 'TEXT', google_id: 'TEXT', name: 'TEXT', picture: 'TEXT', created_at: 'TIMESTAMP' };
  for (const [name, type] of Object.entries(additions)) {
    if (!columns.includes(name)) await db.execute(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
  if (columns.includes('user_id') && !columns.includes('id')) {
    await db.execute('UPDATE users SET id = user_id WHERE id IS NULL');
  }
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_id_unique ON users(id)');
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email)');
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique ON users(google_id) WHERE google_id IS NOT NULL');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      user_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, question_id)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS question_status (
      user_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      is_done INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, question_id)
    )
  `);
}

const schemaReady = initSchema();
app.use((req, res, next) => {
  schemaReady.then(() => next()).catch(next);
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = normaliseEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    const name = typeof (req.body && req.body.name) === 'string' ? req.body.name.trim() : null;
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ? LIMIT 1', args: [email] });
    if (existing.rows.length) return res.status(409).json({ error: 'An account with this email already exists' });

    const user = { id: crypto.randomUUID(), email, name: name || null, picture: null };
    const passwordHash = await bcrypt.hash(password, 10);
    await db.execute({
      sql: 'INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)',
      args: [user.id, user.email, passwordHash, user.name]
    });
    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('Sign-up failed', err);
    return res.status(500).json({ error: 'Unable to create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = normaliseEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    if (!email || typeof password !== 'string') return res.status(400).json({ error: 'Email and password are required' });

    const result = await db.execute({
      sql: 'SELECT id, email, password_hash, name, picture FROM users WHERE email = ? LIMIT 1',
      args: [email]
    });
    const user = result.rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('Login failed', err);
    return res.status(500).json({ error: 'Unable to sign in' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const credential = req.body && req.body.credential;
    if (typeof credential !== 'string' || !credential) return res.status(400).json({ error: 'Google credential is required' });

    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = normaliseEmail(payload && payload.email);
    if (!payload || !payload.sub || !email || payload.email_verified === false) return res.status(401).json({ error: 'Google account email could not be verified' });

    let user = await findUserByEmailOrGoogleId(email, payload.sub);
    if (!user) {
      user = { id: crypto.randomUUID(), email, google_id: payload.sub, name: payload.name || null, picture: payload.picture || null };
      await db.execute({
        sql: 'INSERT INTO users (id, email, google_id, name, picture) VALUES (?, ?, ?, ?, ?)',
        args: [user.id, user.email, user.google_id, user.name, user.picture]
      });
    } else {
      await db.execute({
        sql: 'UPDATE users SET google_id = COALESCE(google_id, ?), name = COALESCE(name, ?), picture = COALESCE(picture, ?) WHERE id = ?',
        args: [payload.sub, payload.name || null, payload.picture || null, user.id]
      });
      user = { ...user, google_id: user.google_id || payload.sub, name: user.name || payload.name || null, picture: user.picture || payload.picture || null };
    }
    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('Google sign-in failed', err);
    return res.status(401).json({ error: 'Google sign-in failed' });
  }
});

app.get('/api/user-data', requireAuth, async (req, res) => {
  try {
    const bookmarksResult = await db.execute({ sql: 'SELECT question_id FROM bookmarks WHERE user_id = ?', args: [req.userId] });
    const completedResult = await db.execute({ sql: 'SELECT question_id FROM question_status WHERE user_id = ? AND is_done = 1', args: [req.userId] });
    return res.json({ bookmarks: bookmarksResult.rows.map((row) => row.question_id), completed: completedResult.rows.map((row) => row.question_id) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load user data' });
  }
});

app.post('/api/sync', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const bookmarkChanges = body.bookmarks == null ? [] : body.bookmarks;
    const statusChanges = body.statuses == null ? [] : body.statuses;
    if (!Array.isArray(bookmarkChanges) || !Array.isArray(statusChanges)) return res.status(400).json({ error: 'bookmarks and statuses must be arrays' });

    const bookmarks = new Map();
    const statuses = new Map();
    for (const change of bookmarkChanges) {
      if (!change || typeof change.questionId !== 'string' || !change.questionId.trim() || typeof change.bookmarked !== 'boolean') return res.status(400).json({ error: 'Each bookmark requires questionId and bookmarked' });
      bookmarks.set(change.questionId, change.bookmarked);
    }
    for (const change of statusChanges) {
      if (!change || typeof change.questionId !== 'string' || !change.questionId.trim() || typeof change.isDone !== 'boolean') return res.status(400).json({ error: 'Each status requires questionId and isDone' });
      statuses.set(change.questionId, change.isDone);
    }
    const syncedCount = bookmarks.size + statuses.size;
    if (!syncedCount) return res.json({ success: true, syncedCount });

    const statements = [];
    for (const [questionId, bookmarked] of bookmarks) {
      statements.push(bookmarked
        ? { sql: 'INSERT INTO bookmarks (user_id, question_id) VALUES (?, ?) ON CONFLICT DO NOTHING', args: [req.userId, questionId] }
        : { sql: 'DELETE FROM bookmarks WHERE user_id = ? AND question_id = ?', args: [req.userId, questionId] });
    }
    for (const [questionId, isDone] of statuses) {
      statements.push({ sql: "INSERT INTO question_status (user_id, question_id, is_done) VALUES (?, ?, ?) ON CONFLICT(user_id, question_id) DO UPDATE SET is_done = excluded.is_done, updated_at = datetime('now')", args: [req.userId, questionId, isDone ? 1 : 0] });
    }
    await db.batch(statements, 'write');
    return res.json({ success: true, syncedCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to sync user data' });
  }
});

// Compatibility endpoints retained for older browser builds; they use native JWT auth too.
app.post('/api/bookmark', requireAuth, async (req, res) => {
  const questionId = req.body && req.body.questionId;
  if (!questionId) return res.status(400).json({ error: 'questionId is required' });
  try {
    const existing = await db.execute({ sql: 'SELECT 1 FROM bookmarks WHERE user_id = ? AND question_id = ? LIMIT 1', args: [req.userId, questionId] });
    if (existing.rows.length) {
      await db.execute({ sql: 'DELETE FROM bookmarks WHERE user_id = ? AND question_id = ?', args: [req.userId, questionId] });
      return res.json({ bookmarked: false });
    }
    await db.execute({ sql: 'INSERT INTO bookmarks (user_id, question_id) VALUES (?, ?) ON CONFLICT DO NOTHING', args: [req.userId, questionId] });
    return res.json({ bookmarked: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update bookmark' });
  }
});

app.post('/api/status', requireAuth, async (req, res) => {
  const questionId = req.body && req.body.questionId;
  if (!questionId) return res.status(400).json({ error: 'questionId is required' });
  const isDone = Boolean(req.body && req.body.isDone);
  try {
    await db.execute({ sql: "INSERT INTO question_status (user_id, question_id, is_done) VALUES (?, ?, ?) ON CONFLICT(user_id, question_id) DO UPDATE SET is_done = excluded.is_done, updated_at = datetime('now')", args: [req.userId, questionId, isDone ? 1 : 0] });
    return res.json({ questionId, isDone });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update question status' });
  }
});

schemaReady.catch((err) => console.error('Failed to initialize Turso schema', err));
module.exports = app;
