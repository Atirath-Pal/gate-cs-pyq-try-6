require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');
const { createClient } = require('@libsql/client');

const app = express();

app.use(cors());
app.use(express.json());

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

function getUserId(req) {
  const auth = typeof req.auth === 'function' ? req.auth() : req.auth;
  return auth && auth.userId;
}

function getUserEmail(req) {
  const auth = typeof req.auth === 'function' ? req.auth() : req.auth;
  const claims = auth && (auth.sessionClaims || auth.claims);
  return (claims && (claims.email || claims.email_address)) || 'user@example.com';
}

async function ensureUserExists(userId, email = 'user@example.com') {
  await db.execute({
    sql: `INSERT INTO users (user_id, email) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING`,
    args: [userId, email]
  });
}

async function initSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL
    )
  `);
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

app.get('/api/user-data', ClerkExpressRequireAuth(), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    await ensureUserExists(userId, getUserEmail(req));

    const bookmarksResult = await db.execute({
      sql: 'SELECT question_id FROM bookmarks WHERE user_id = ?',
      args: [userId]
    });
    const completedResult = await db.execute({
      sql: 'SELECT question_id FROM question_status WHERE user_id = ? AND is_done = 1',
      args: [userId]
    });

    return res.json({
      bookmarks: bookmarksResult.rows.map((row) => row.question_id),
      completed: completedResult.rows.map((row) => row.question_id)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load user data' });
  }
});

// Applies the latest client-side bookmark and completion changes together.  The
// frontend coalesces repeated clicks by question ID before it reaches this route.
app.post('/api/sync', ClerkExpressRequireAuth(), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const body = req.body || {};
    const bookmarkChanges = body.bookmarks == null ? [] : body.bookmarks;
    const statusChanges = body.statuses == null ? [] : body.statuses;

    if (!Array.isArray(bookmarkChanges) || !Array.isArray(statusChanges)) {
      return res.status(400).json({ error: 'bookmarks and statuses must be arrays' });
    }

    // Last write wins if a caller sends more than one change for a question.
    // This mirrors the Map-based queue on the client and avoids unnecessary SQL.
    const bookmarks = new Map();
    const statuses = new Map();

    for (const change of bookmarkChanges) {
      if (!change || typeof change.questionId !== 'string' || !change.questionId.trim()
        || typeof change.bookmarked !== 'boolean') {
        return res.status(400).json({ error: 'Each bookmark requires questionId and bookmarked' });
      }
      bookmarks.set(change.questionId, change.bookmarked);
    }

    for (const change of statusChanges) {
      if (!change || typeof change.questionId !== 'string' || !change.questionId.trim()
        || typeof change.isDone !== 'boolean') {
        return res.status(400).json({ error: 'Each status requires questionId and isDone' });
      }
      statuses.set(change.questionId, change.isDone);
    }

    const syncedCount = bookmarks.size + statuses.size;
    if (syncedCount === 0) return res.json({ success: true, syncedCount });

    const statements = [
      {
        sql: 'INSERT INTO users (user_id, email) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING',
        args: [userId, getUserEmail(req)]
      }
    ];

    for (const [questionId, bookmarked] of bookmarks) {
      statements.push(bookmarked
        ? {
            sql: 'INSERT INTO bookmarks (user_id, question_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
            args: [userId, questionId]
          }
        : {
            sql: 'DELETE FROM bookmarks WHERE user_id = ? AND question_id = ?',
            args: [userId, questionId]
          });
    }

    for (const [questionId, isDone] of statuses) {
      statements.push({
        sql: `
          INSERT INTO question_status (user_id, question_id, is_done)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, question_id)
          DO UPDATE SET is_done = excluded.is_done, updated_at = datetime('now')
        `,
        args: [userId, questionId, isDone ? 1 : 0]
      });
    }

    // libSQL executes batch statements as one transaction; "write" obtains the
    // appropriate write transaction up front.
    await db.batch(statements, 'write');
    return res.json({ success: true, syncedCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to sync user data' });
  }
});

app.post('/api/bookmark', ClerkExpressRequireAuth(), async (req, res) => {
  try {
    const userId = getUserId(req);
    const questionId = req.body && req.body.questionId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!questionId) return res.status(400).json({ error: 'questionId is required' });

    await ensureUserExists(userId, getUserEmail(req));

    const existing = await db.execute({
      sql: 'SELECT 1 FROM bookmarks WHERE user_id = ? AND question_id = ? LIMIT 1',
      args: [userId, questionId]
    });

    if (existing.rows.length > 0) {
      await db.execute({
        sql: 'DELETE FROM bookmarks WHERE user_id = ? AND question_id = ?',
        args: [userId, questionId]
      });
      return res.json({ bookmarked: false });
    }

    await db.execute({
      sql: 'INSERT INTO bookmarks (user_id, question_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      args: [userId, questionId]
    });
    return res.json({ bookmarked: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update bookmark' });
  }
});

app.post('/api/status', ClerkExpressRequireAuth(), async (req, res) => {
  try {
    const userId = getUserId(req);
    const questionId = req.body && req.body.questionId;
    const isDone = Boolean(req.body && req.body.isDone);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!questionId) return res.status(400).json({ error: 'questionId is required' });

    await ensureUserExists(userId, getUserEmail(req));

    await db.execute({
      sql: `
        INSERT INTO question_status (user_id, question_id, is_done)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, question_id)
        DO UPDATE SET is_done = excluded.is_done, updated_at = datetime('now')
      `,
      args: [userId, questionId, isDone ? 1 : 0]
    });

    return res.json({ questionId, isDone });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update question status' });
  }
});

initSchema().catch((err) => {
  console.error('Failed to initialize Turso schema', err);
});

module.exports = app;
