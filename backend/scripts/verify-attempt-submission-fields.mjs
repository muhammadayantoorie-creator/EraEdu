// Disposable PostgreSQL only. Never accepts a live URL or account credentials.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const migration = await readFile(new URL('../migrations/032_reconcile_attempt_submission_fields.sql', import.meta.url), 'utf8');

test('legacy submissions keep their answers and unknown provenance; new rows get the normal default', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE quiz_attempts(id integer PRIMARY KEY, answers jsonb, status text);
      INSERT INTO quiz_attempts VALUES (1,'[{"selectedAnswer":0}]','completed');`);
    await db.exec(migration);
    assert.deepEqual((await db.query('SELECT * FROM quiz_attempts')).rows, [{
      id: 1, answers: [{ selectedAnswer: 0 }], status: 'completed', auto_submitted: null, submission_reason: null,
    }]);
    await db.exec("INSERT INTO quiz_attempts(id,status) VALUES (2,'in-progress')");
    assert.equal((await db.query('SELECT auto_submitted FROM quiz_attempts WHERE id=2')).rows[0].auto_submitted, false);
    await db.exec("UPDATE quiz_attempts SET status='completed',auto_submitted=true,submission_reason='deadline' WHERE id=2");
    assert.deepEqual((await db.query('SELECT auto_submitted,submission_reason FROM quiz_attempts WHERE id=2')).rows[0], {
      auto_submitted: true, submission_reason: 'deadline',
    });
  } finally { await db.close(); }
});

test('repeat application preserves recorded reasons and automatic submission flags', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE quiz_attempts(id integer PRIMARY KEY, auto_submitted boolean, submission_reason text);
      INSERT INTO quiz_attempts VALUES (1,true,'deadline'),(2,false,'student'),(3,NULL,NULL);`);
    const before = (await db.query('SELECT * FROM quiz_attempts ORDER BY id')).rows;
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query('SELECT * FROM quiz_attempts ORDER BY id')).rows, before);
  } finally { await db.close(); }
});

for (const [columns, missing] of [
  ['auto_submitted text', 'submission_reason'], ['submission_reason integer', 'auto_submitted'],
]) test(`incompatible ${columns} refuses atomically and preserves existing values`, async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE quiz_attempts(id integer PRIMARY KEY,${columns}); INSERT INTO quiz_attempts(id) VALUES(1);`);
    await assert.rejects(db.exec(migration), /incompatible types/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM quiz_attempts')).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name=$1 AND column_name=$2',
      ['quiz_attempts', missing])).rows[0].n, 0);
  } finally { await db.close(); }
});
