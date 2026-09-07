require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = 3000;

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

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize Turso schema', err);
    process.exit(1);
  });
