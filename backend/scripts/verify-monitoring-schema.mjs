// Disposable PostgreSQL only. No live database, accounts, or credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/019_make_cheating_events_authoritative.sql', import.meta.url), 'utf8');
const verification = await readFile(new URL('./verify-monitoring-schema.sql', import.meta.url), 'utf8');

async function legacyDatabase() {
  const db = await PGlite.create();
  await db.exec(`CREATE TABLE public.quiz_attempts (id integer PRIMARY KEY, score integer);
    CREATE TABLE public.cheating_violations (
      id serial PRIMARY KEY, quiz_attempt_id integer REFERENCES public.quiz_attempts(id), violation_type text);
    INSERT INTO public.quiz_attempts VALUES (1, 85), (2, 70);
    INSERT INTO public.cheating_violations (quiz_attempt_id, violation_type)
      VALUES (1, 'tab_change'), (1, 'focus_loss');`);
  return db;
}
async function missingColumn(db, table, column) {
  const result = await db.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, column]);
  assert.equal(result.rows.length, 0);
}
async function refused(db, expected) {
  await assert.rejects(db.exec(migration), expected);
  await db.exec('ROLLBACK');
}

test('migration is repeatable, preserves records and summaries, and makes retries unique per attempt', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(migration);
    await db.exec(`UPDATE public.quiz_attempts SET violation_count=7, violations='[{"historic":true}]' WHERE id=1;
      INSERT INTO public.cheating_violations (quiz_attempt_id, violation_type, event_id)
        VALUES (1,'tab_change','stable-event'),(NULL,'tab_change','unlinked-event'),(NULL,'focus_loss','unlinked-event');`);
    const before = (await db.query('SELECT * FROM public.cheating_violations ORDER BY id')).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query('SELECT * FROM public.cheating_violations ORDER BY id')).rows, before);
    assert.deepEqual((await db.query('SELECT score, violation_count, violations FROM public.quiz_attempts WHERE id=1')).rows,
      [{ score: 85, violation_count: 7, violations: [{ historic: true }] }]);
    await assert.rejects(db.query(`INSERT INTO public.cheating_violations (quiz_attempt_id,event_id) VALUES (1,'stable-event')`), /unique constraint/);
    await db.exec(`INSERT INTO public.cheating_violations (quiz_attempt_id,event_id) VALUES (2,'stable-event'),(1,NULL),(1,NULL);
      INSERT INTO public.quiz_attempts (id,score) VALUES (3,90);`);
    assert.deepEqual((await db.query('SELECT violation_count, violations FROM public.quiz_attempts WHERE id=3')).rows,
      [{ violation_count: 0, violations: [] }]);
    const checks = (await db.exec(verification)).flatMap(result => result.rows || []);
    assert.equal(checks.length, 8);
    assert.ok(checks.every(check => check.status === 'PASS'), JSON.stringify(checks));
  } finally { await db.close(); }
});

test('a missing prerequisite table rolls back the earlier event_id addition', async () => {
  const db = await PGlite.create();
  try {
    await db.exec('CREATE TABLE public.cheating_violations (id integer, quiz_attempt_id integer)');
    await refused(db, /quiz_attempts/);
    await missingColumn(db, 'cheating_violations', 'event_id');
  } finally { await db.close(); }
});

test('duplicate existing event identities are refused without deleting events or partially adding summaries', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec("ALTER TABLE public.cheating_violations ADD COLUMN event_id text; UPDATE public.cheating_violations SET event_id='existing-duplicate'");
    await refused(db, /Duplicate monitoring event IDs require review/);
    assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.cheating_violations')).rows[0].count, 2);
    await missingColumn(db, 'quiz_attempts', 'violation_count');
    await missingColumn(db, 'quiz_attempts', 'violations');
  } finally { await db.close(); }
});

for (const [name, definition] of [
  ['nonunique', '(quiz_attempt_id,event_id) WHERE event_id IS NOT NULL'],
  ['wrong keys', '(id,event_id) WHERE event_id IS NOT NULL'],
  ['wrong predicate', '(quiz_attempt_id,event_id) WHERE event_id IS NULL'],
]) {
  test(`an existing ${name} retry index is refused and preserved for review`, async () => {
    const db = await legacyDatabase();
    try {
      await db.exec(`ALTER TABLE public.cheating_violations ADD COLUMN event_id text;
        CREATE ${name === 'nonunique' ? '' : 'UNIQUE'} INDEX cheating_violations_attempt_event_id_unique
        ON public.cheating_violations ${definition}`);
      const before = (await db.query("SELECT pg_get_indexdef('public.cheating_violations_attempt_event_id_unique'::regclass) AS definition")).rows;
      await refused(db, /retry index has an incompatible definition/);
      assert.deepEqual((await db.query("SELECT pg_get_indexdef('public.cheating_violations_attempt_event_id_unique'::regclass) AS definition")).rows, before);
      await missingColumn(db, 'quiz_attempts', 'violation_count');
      const checks = (await db.exec(verification)).flatMap(result => result.rows || []);
      assert.notEqual(checks.find(check => check.check_type === 'index').status, 'PASS');
    } finally { await db.close(); }
  });
}

test('incompatible existing column types are refused without converting data', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec('ALTER TABLE public.cheating_violations ADD COLUMN event_id integer; UPDATE public.cheating_violations SET event_id=id');
    await refused(db, /Monitoring columns have incompatible types/);
    assert.deepEqual((await db.query('SELECT event_id FROM public.cheating_violations ORDER BY id')).rows, [{ event_id: 1 }, { event_id: 2 }]);
    await missingColumn(db, 'quiz_attempts', 'violation_count');
  } finally { await db.close(); }
});
