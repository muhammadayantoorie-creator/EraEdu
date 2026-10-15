// Isolated in-memory PostgreSQL; no remote database or credentials.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const sql = await readFile(new URL('../migrations/029_reconcile_account_status.sql', import.meta.url), 'utf8');

test('missing column gets false default, not-null and repeatable migration', async () => {
  const db = await PGlite.create();
  try {
    await db.exec('CREATE TABLE users (id integer PRIMARY KEY); INSERT INTO users VALUES (1);');
    await db.exec(sql);
    await db.exec(sql);
    await db.exec('INSERT INTO users (id) VALUES (2);');
    assert.deepEqual((await db.query('SELECT is_suspended FROM users ORDER BY id')).rows, [{ is_suspended: false }, { is_suspended: false }]);
    await assert.rejects(db.exec('INSERT INTO users VALUES (3, NULL, NULL);'), /null/i);
  } finally { await db.close(); }
});

test('existing column gets its missing default/constraint without restoring suspended users', async () => {
  const db = await PGlite.create();
  try {
    await db.exec('CREATE TABLE users (id integer PRIMARY KEY, is_suspended boolean); INSERT INTO users VALUES (1,true),(2,false);');
    await db.exec(sql);
    await db.exec('INSERT INTO users (id) VALUES (3);');
    assert.deepEqual((await db.query('SELECT is_suspended FROM users ORDER BY id')).rows, [{ is_suspended: true }, { is_suspended: false }, { is_suspended: false }]);
    await assert.rejects(db.exec('UPDATE users SET is_suspended=NULL WHERE id=1'), /null/i);
  } finally { await db.close(); }
});

test('unknown legacy statuses stop migration atomically until explicitly reviewed', async () => {
  const db = await PGlite.create();
  try {
    await db.exec('CREATE TABLE users (id integer PRIMARY KEY, is_suspended boolean); INSERT INTO users VALUES (1,true),(2,NULL);');
    await assert.rejects(db.exec(sql), /Unknown legacy account statuses/);
    await db.exec('ROLLBACK;');
    assert.deepEqual((await db.query('SELECT is_suspended FROM users ORDER BY id')).rows, [{ is_suspended: true }, { is_suspended: null }]);
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM information_schema.columns WHERE table_name='users' AND column_name='suspended_at'")).rows[0].n, 0);
  } finally { await db.close(); }
});
