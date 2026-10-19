// Disposable PostgreSQL only. No live database, accounts, or credentials.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');

test('old explicit event_id projection fails; selecting available columns preserves actual historic events', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE cheating_violations (
      id uuid PRIMARY KEY, quiz_attempt_id uuid, violation_type text, timestamp timestamptz,
      details jsonb, severity text, detection_method text);
      INSERT INTO cheating_violations VALUES ('00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002','tab_change','2030-01-01','{"note":"actual event"}','medium','browser_event');`);
    await assert.rejects(db.query('SELECT quiz_attempt_id, violation_type, timestamp, details, event_id, severity, detection_method FROM cheating_violations'), /event_id/);
    const rows = (await db.query('SELECT * FROM cheating_violations ORDER BY timestamp')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].violation_type, 'tab_change');
    assert.deepEqual(rows[0].details, { note: 'actual event' });
    assert.equal(Object.hasOwn(rows[0], 'event_id'), false);
    await db.exec('ALTER TABLE cheating_violations ADD COLUMN event_id text');
    await db.exec("UPDATE cheating_violations SET event_id='stable-event'");
    assert.equal((await db.query('SELECT * FROM cheating_violations')).rows[0].event_id, 'stable-event');
  } finally { await db.close(); }
});

test('omitting a nullable student reference avoids an invalid UUID filter without dropping its attempt', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE users (id uuid PRIMARY KEY, name text);
      CREATE TABLE quiz_attempts (id uuid PRIMARY KEY, user_id uuid, status text);
      INSERT INTO quiz_attempts VALUES ('00000000-0000-4000-8000-000000000003',NULL,'completed');`);
    await assert.rejects(db.query("SELECT id, name FROM users WHERE id IN ('null')"), /uuid/);
    const attempts = (await db.query("SELECT * FROM quiz_attempts WHERE status='completed'")).rows;
    assert.equal(attempts.length, 1); assert.equal(attempts[0].user_id, null);
    assert.deepEqual(attempts.map(row => row.user_id).filter(value => typeof value === 'string' && value.trim()), []);
  } finally { await db.close(); }
});
