import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const original = await readFile(new URL('../migrations/021_enforce_organization_seats_atomically.sql', import.meta.url), 'utf8');
const repair = await readFile(new URL('../migrations/033_protect_organization_seat_rpc.sql', import.meta.url), 'utf8');
const organization = '10000000-0000-4000-8000-000000000001';
const teacher = '20000000-0000-4000-8000-000000000001';
async function fixture() {
  const db = await PGlite.create();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE organizations(id uuid PRIMARY KEY, seat_limit integer);
    CREATE TABLE organization_members(organization_id uuid,user_id uuid,role text,PRIMARY KEY(organization_id,user_id));`);
  await db.exec(original);
  // Reproduce Supabase defaults, which are absent from the plain PostgreSQL
  // fixtures: these explicit grants survive migration 021's PUBLIC revoke.
  await db.exec('GRANT EXECUTE ON FUNCTION add_organization_teacher_atomic(uuid,uuid) TO anon, authenticated');
  return db;
}

test('explicit browser grants are removed while the real atomic seat operation still works for the service', async () => {
  const db = await fixture();
  try {
    await db.query('INSERT INTO organizations VALUES ($1,1)', [organization]);
    assert.equal((await db.query("SELECT has_function_privilege('anon','add_organization_teacher_atomic(uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed, true);
    await db.exec(repair);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT add_organization_teacher_atomic($1,$2)', [organization, teacher]), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    assert.equal((await db.query('SELECT add_organization_teacher_atomic($1,$2) AS existing', [organization, teacher])).rows[0].existing, false);
    assert.equal((await db.query('SELECT add_organization_teacher_atomic($1,$2) AS existing', [organization, teacher])).rows[0].existing, true);
    await db.exec('RESET ROLE');
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM organization_members')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('repeat application preserves the function body and existing memberships', async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO organization_members VALUES ($1,$2,'teacher')", [organization, teacher]);
    const before = (await db.query("SELECT prosrc FROM pg_proc WHERE oid='add_organization_teacher_atomic(uuid,uuid)'::regprocedure")).rows;
    await db.exec(repair);
    await db.exec(repair);
    assert.deepEqual((await db.query("SELECT prosrc FROM pg_proc WHERE oid='add_organization_teacher_atomic(uuid,uuid)'::regprocedure")).rows, before);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM organization_members')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('inherited execution causes rollback instead of rewriting unrelated role memberships', async () => {
  const db = await fixture();
  try {
    await db.exec(`CREATE ROLE legacy_browser_rpc; GRANT legacy_browser_rpc TO anon;
      GRANT EXECUTE ON FUNCTION add_organization_teacher_atomic(uuid,uuid) TO legacy_browser_rpc;`);
    await assert.rejects(db.exec(repair), /Inherited browser execution requires review/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT pg_has_role('anon','legacy_browser_rpc','MEMBER') AS retained")).rows[0].retained, true);
    assert.equal((await db.query("SELECT has_function_privilege('anon','add_organization_teacher_atomic(uuid,uuid)','EXECUTE') AS retained")).rows[0].retained, true);
  } finally { await db.close(); }
});
