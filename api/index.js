require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const { createClient } = require('@libsql/client');

const app = express();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.use(cors());
app.use(express.json());

function signToken(user) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ userId: user.user_id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  return {
    user_id: user.user_id,
    email: user.email,
    name: user.name || null,
    picture: user.picture || null,
    isGoogleAccount: Boolean(user.google_id)
  };
}

function normaliseEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}

async function findUserByEmail(email) {
  const result = await db.execute({
    sql: 'SELECT user_id, email, password_hash, google_id, name, picture FROM users WHERE email = ? LIMIT 1',
    args: [email]
  });
  return result.rows[0] || null;
}

async function findValidOtp(email, code, type) {
  const result = await db.execute({
    sql: "SELECT email FROM otps WHERE email = ? AND code = ? AND type = ? AND expires_at > datetime('now') LIMIT 1",
    args: [email, code, type]
  });
  return result.rows[0] || null;
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
    sql: 'SELECT user_id, email, password_hash, google_id, name, picture FROM users WHERE google_id = ? OR email = ? LIMIT 1',
    args: [googleId, email]
  });
  return result.rows[0] || null;
}

async function initSchema() {
  await db.execute('DROP TABLE IF EXISTS question_attempts');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      name TEXT,
      picture TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS otps (
      email TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      type TEXT NOT NULL,
      expires_at DATETIME NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, question_id)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS question_status (
      user_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      is_done INTEGER NOT NULL DEFAULT 0,
      subject TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, question_id)
    )
  `);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_status_user ON question_status(user_id)');
  const statusColumns = await db.execute('PRAGMA table_info(question_status)');
  if (!statusColumns.rows.some((column) => column.name === 'subject')) {
    await db.execute('ALTER TABLE question_status ADD COLUMN subject TEXT');
  }
}

const schemaReady = initSchema();
app.use((req, res, next) => {
  schemaReady.then(() => next()).catch(next);
});

app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const email = normaliseEmail(req.body && req.body.email);
    const type = req.body && req.body.type;
    if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (type !== 'signup' && type !== 'reset') return res.status(400).json({ error: 'Invalid OTP request type' });

    const user = await findUserByEmail(email);
    if (type === 'signup' && user) return res.status(400).json({ error: 'Email already registered' });
    if (type === 'reset' && !user) return res.status(404).json({ error: 'No account found with this email address' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await db.execute({
      sql: "INSERT INTO otps (email, code, type, expires_at) VALUES (?, ?, ?, datetime('now', '+10 minutes')) ON CONFLICT(email) DO UPDATE SET code = excluded.code, type = excluded.type, expires_at = excluded.expires_at",
      args: [email, code, type]
    });

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your Verification Code',
        text: `Your GATE CS PYQ verification code is ${code}. It expires in 10 minutes.`
      });
    } catch (mailError) {
      await db.execute({ sql: 'DELETE FROM otps WHERE email = ? AND code = ?', args: [email, code] });
      throw mailError;
    }
    return res.json({ message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('Failed to send verification code', err);
    return res.status(500).json({ error: 'Unable to send verification code' });
  }
});

app.post('/api/auth/verify-signup-otp', async (req, res) => {
  try {
    const email = normaliseEmail(req.body && req.body.email);
    const name = typeof (req.body && req.body.name) === 'string' ? req.body.name.trim() : null;
    const password = req.body && req.body.password;
    const code = typeof (req.body && req.body.code) === 'string' ? req.body.code.trim() : '';
    if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!/^\d{6}$/.test(code) || !(await findValidOtp(email, code, 'signup'))) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }
    if (await findUserByEmail(email)) return res.status(400).json({ error: 'Email already registered' });

    const user = { user_id: crypto.randomUUID(), email, name: name || null, picture: null };
    const passwordHash = await bcrypt.hash(password, 10);
    await db.batch([
      { sql: 'DELETE FROM otps WHERE email = ? AND code = ? AND type = ?', args: [email, code, 'signup'] },
      { sql: 'INSERT INTO users (user_id, email, password_hash, name) VALUES (?, ?, ?, ?)', args: [user.user_id, user.email, passwordHash, user.name] }
    ], 'write');
    return res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error('Sign-up verification failed', err);
    return res.status(500).json({ error: 'Unable to create account' });
  }
});

app.post('/api/auth/verify-reset-otp', async (req, res) => {
  try {
    const email = normaliseEmail(req.body && req.body.email);
    const code = typeof (req.body && req.body.code) === 'string' ? req.body.code.trim() : '';
    if (!isValidEmail(email) || !/^\d{6}$/.test(code) || !(await findValidOtp(email, code, 'reset'))) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }
    return res.json({ valid: true });
  } catch (err) {
    console.error('Password reset verification failed', err);
    return res.status(500).json({ error: 'Unable to verify code' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const email = normaliseEmail(req.body && req.body.email);
    const code = typeof (req.body && req.body.code) === 'string' ? req.body.code.trim() : '';
    const newPassword = req.body && req.body.newPassword;
    if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!isValidEmail(email) || !/^\d{6}$/.test(code) || !(await findValidOtp(email, code, 'reset'))) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    const user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'No account found with this email address' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.batch([
      { sql: 'DELETE FROM otps WHERE email = ? AND code = ? AND type = ?', args: [email, code, 'reset'] },
      { sql: 'UPDATE users SET password_hash = ? WHERE user_id = ?', args: [passwordHash, user.user_id] }
    ], 'write');
    return res.json({ token: signToken(user), user: publicUser(user), message: 'Password updated successfully' });
  } catch (err) {
    console.error('Password reset failed', err);
    return res.status(500).json({ error: 'Unable to reset password' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = normaliseEmail(req.body && req.body.email);
    const password = req.body && req.body.password;
    if (!email || typeof password !== 'string') return res.status(400).json({ error: 'Email and password are required' });

    const result = await db.execute({
      sql: 'SELECT user_id, email, password_hash, google_id, name, picture FROM users WHERE email = ? LIMIT 1',
      args: [email]
    });
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.password_hash) return res.status(400).json({ error: 'Please sign in using Google' });
    if (!(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
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
      user = { user_id: crypto.randomUUID(), email, google_id: payload.sub, name: payload.name || null, picture: payload.picture || null };
      await db.execute({
        sql: 'INSERT INTO users (user_id, email, google_id, name, picture) VALUES (?, ?, ?, ?, ?)',
        args: [user.user_id, user.email, user.google_id, user.name, user.picture]
      });
    } else {
      await db.execute({
        sql: 'UPDATE users SET google_id = COALESCE(google_id, ?), picture = COALESCE(?, picture) WHERE user_id = ?',
        args: [payload.sub, payload.picture || null, user.user_id]
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

app.get('/api/user/profile-stats', requireAuth, async (req, res) => {
  try {
    const [userResult, solvedResult, bookmarkedResult, subjectResult] = await Promise.all([
      db.execute({ sql: 'SELECT user_id, email, google_id, name, picture FROM users WHERE user_id = ? LIMIT 1', args: [req.userId] }),
      db.execute({ sql: 'SELECT COUNT(*) AS total_solved FROM question_status WHERE user_id = ? AND is_done = 1', args: [req.userId] }),
      db.execute({ sql: 'SELECT COUNT(*) AS total_bookmarked FROM bookmarks WHERE user_id = ?', args: [req.userId] }),
      db.execute({
        sql: "SELECT COALESCE(NULLIF(subject, ''), 'Uncategorized') AS subject, COUNT(*) AS solved FROM question_status WHERE user_id = ? AND is_done = 1 GROUP BY COALESCE(NULLIF(subject, ''), 'Uncategorized') ORDER BY subject",
        args: [req.userId]
      })
    ]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User account not found' });
    return res.json({
      totalSolved: Number(solvedResult.rows[0].total_solved || 0),
      totalBookmarked: Number(bookmarkedResult.rows[0].total_bookmarked || 0),
      subjectProgress: subjectResult.rows.map((row) => ({ subject: row.subject, solved: Number(row.solved || 0) })),
      user: publicUser(user)
    });
  } catch (err) {
    console.error('Failed to load profile stats', err);
    return res.status(500).json({ error: 'Failed to load profile stats' });
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
      if (change.subject != null && (typeof change.subject !== 'string' || change.subject.length > 120)) return res.status(400).json({ error: 'Each status subject must be a short string' });
      statuses.set(change.questionId, { isDone: change.isDone, subject: typeof change.subject === 'string' ? change.subject.trim() || null : null });
    }
    const syncedCount = bookmarks.size + statuses.size;
    if (!syncedCount) return res.json({ success: true, syncedCount });

    const statements = [];
    for (const [questionId, bookmarked] of bookmarks) {
      statements.push(bookmarked
        ? { sql: 'INSERT INTO bookmarks (user_id, question_id) VALUES (?, ?) ON CONFLICT(user_id, question_id) DO NOTHING', args: [req.userId, questionId] }
        : { sql: 'DELETE FROM bookmarks WHERE user_id = ? AND question_id = ?', args: [req.userId, questionId] });
    }
    for (const [questionId, status] of statuses) {
      statements.push({ sql: "INSERT INTO question_status (user_id, question_id, is_done, subject) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, question_id) DO UPDATE SET is_done = excluded.is_done, subject = COALESCE(excluded.subject, question_status.subject), updated_at = datetime('now')", args: [req.userId, questionId, status.isDone ? 1 : 0, status.subject] });
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
    await db.execute({ sql: 'INSERT INTO bookmarks (user_id, question_id) VALUES (?, ?) ON CONFLICT(user_id, question_id) DO NOTHING', args: [req.userId, questionId] });
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
