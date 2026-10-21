// Tests the diagnostic itself in disposable in-memory PostgreSQL, never Supabase.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const audit = await readFile(new URL('./audit_database_readonly.sql', import.meta.url), 'utf8');
const dataAudit = await readFile(new URL('./audit_database_data_readonly.sql', import.meta.url), 'utf8');
const inventory = await readFile(new URL('./inventory_database_readonly.sql', import.meta.url), 'utf8');
const run = async db => (await db.exec(audit)).find(result => result.rows?.[0]?.check_name)?.rows;
const row = (rows, section, check) => {
  const found = rows.find(r => r.section===section && r.check_name===check);
  assert.ok(found, `Missing report row ${section}/${check}`); return found;
};
const roles = 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;';

test('empty database produces explicit blockers, including missing roles, instead of aborting or passing', async () => {
  const db = await PGlite.create();
  try {
    const rows = await run(db);
    assert.equal(row(rows,'table','users').status,'BLOCKED');
    assert.equal(row(rows,'server_table_access','users / service_role').status,'BLOCKED');
    assert.equal(row(rows,'role','service_role').status,'BLOCKED');
    assert.equal(row(rows,'function','public.enroll_course_with_capacity(uuid,uuid)').status,'BLOCKED');
    assert.equal(row(rows,'release_gate','live API / data / concurrency / restore').status,'NOT_TESTED');
  } finally { await db.close(); }
});

test('real account-status migration changes diagnosis without the report changing records', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`${roles} CREATE TABLE users (id uuid PRIMARY KEY); INSERT INTO users VALUES (gen_random_uuid());`);
    let rows = await run(db);
    assert.equal(row(rows,'contract','users.is_suspended').status,'BLOCKED');
    assert.equal(row(rows,'server_table_access','users / service_role').status,'BLOCKED');
    await db.exec('GRANT SELECT ON users TO service_role; ALTER ROLE service_role BYPASSRLS;');
    rows = await run(db);
    assert.equal(row(rows,'server_table_access','users / service_role').status,'PASS');
    await db.exec(await readFile(new URL('../migrations/029_reconcile_account_status.sql', import.meta.url),'utf8'));
    assert.equal(row(await run(db),'contract','users.is_suspended').status,'PASS');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n,1);
    await db.exec('ALTER TABLE users ALTER COLUMN is_suspended DROP DEFAULT;');
    assert.equal(row(await run(db),'contract','users.is_suspended').status,'BLOCKED');
  } finally { await db.close(); }
});

test('real capacity migration is recognized; PUBLIC RPC grants and wrong unique keys are caught', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`${roles} CREATE TABLE courses (id uuid PRIMARY KEY); CREATE TABLE enrollments (user_id uuid,course_id uuid,enrolled_at timestamptz);`);
    await db.exec(await readFile(new URL('../migrations/023_enforce_course_capacity_atomically.sql', import.meta.url),'utf8'));
    let rows = await run(db);
    assert.equal(row(rows,'unique_index','enrollments_one_seat_per_student_course').status,'PASS');
    assert.equal(row(rows,'function_permission','public.enroll_course_with_capacity(uuid,uuid) / anon').status,'PASS');
    await db.exec('GRANT EXECUTE ON FUNCTION enroll_course_with_capacity(uuid,uuid) TO PUBLIC; DROP INDEX enrollments_one_seat_per_student_course; CREATE UNIQUE INDEX enrollments_one_seat_per_student_course ON enrollments (user_id);');
    rows = await run(db);
    assert.equal(row(rows,'function_permission','public.enroll_course_with_capacity(uuid,uuid) / anon').status,'BLOCKED');
    assert.equal(row(rows,'unique_index','enrollments_one_seat_per_student_course').status,'BLOCKED');
  } finally { await db.close(); }
});

test('column-level answer-key grants are detected even with RLS enabled and no table SELECT grant', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`${roles} CREATE TABLE quiz_attempts (id uuid, teacher_quiz_snapshot jsonb); ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY; GRANT SELECT (teacher_quiz_snapshot) ON quiz_attempts TO authenticated;`);
    assert.equal(row(await run(db),'browser_table_access','quiz_attempts / authenticated').status,'BLOCKED');
    await db.exec('REVOKE SELECT (teacher_quiz_snapshot) ON quiz_attempts FROM authenticated;');
    assert.equal(row(await run(db),'browser_table_access','quiz_attempts / authenticated').status,'PASS');
  } finally { await db.close(); }
});

test('aggregate data report flags planted inconsistencies and does not change data', async () => {
  const db = await PGlite.create();
  try {
    // Minimal fixture from the checked-in DEVELOPMENT schema, in memory only.
    // Stop before indexes/RLS/legacy grants; never run this bootstrap on Supabase.
    const bootstrap = await readFile(new URL('../src/scripts/create-all-tables.sql',import.meta.url),'utf8');
    await db.exec(bootstrap.split('-- Create indexes for better performance')[0]);
    await db.exec(`
      ALTER TABLE quiz_attempts ADD COLUMN teacher_quiz_snapshot jsonb, ADD COLUMN teacher_question_state jsonb, ADD COLUMN topic_question_snapshot jsonb;
      ALTER TABLE cheating_violations ADD COLUMN event_id text;
      INSERT INTO users (name,email,password,role) VALUES ('Fixture','private@example.test','not-a-real-password','unknown');
      INSERT INTO courses (title,max_students) VALUES ('Fixture',-1);
      INSERT INTO questions(content,options,correct_answer,question_type) VALUES
        ('Valid first answer','["Alpha","Beta"]',0,'multipleChoice'),
        ('Legacy missing index','["Alpha","Beta"]',NULL,'multipleChoice');
    `);
    await db.exec(await readFile(new URL('../migrations/012_add_organizations.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../migrations/013_add_safepay_payments.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../migrations/014_add_student_email_otp.sql',import.meta.url),'utf8'));
    await db.exec('ALTER TABLE safepay_payments ADD COLUMN organization_id uuid;');
    for (const [label, expiry] of [['Expired', "statement_timestamp() - interval '2 days'"],
      ['Active', "statement_timestamp() + interval '1 hour'"],
      ['RecentlyExpired', "statement_timestamp() - interval '1 hour'"], ['UnknownExpiry', 'NULL']]) {
      await db.exec(`INSERT INTO users(name,email,password,role,reset_password_token,reset_password_expires_at,
        student_otp_hash,student_otp_expires_at,student_otp_attempts)
        VALUES ('${label}','${label}@example.invalid','fixture-password','student','fixture-reset-${label}',${expiry},
        'fixture-otp-${label}',${expiry},3)`);
    }
    const usersBefore = (await db.query('SELECT * FROM users ORDER BY id')).rows;
    const questionsBefore = (await db.query('SELECT * FROM questions ORDER BY id')).rows;
    const results = await db.exec(dataAudit);
    const rows = results.find(r=>r.rows?.[0]?.check_name).rows;
    assert.equal(rows.find(r=>r.check_name==='unsupported account role').affected,1);
    assert.equal(rows.find(r=>r.check_name==='invalid course capacity').affected,1);
    assert.equal(rows.find(r=>r.check_name==='multiple-choice bank questions with invalid options or correct index').affected,1);
    assert.equal(rows.find(r=>r.check_name==='duplicate enrollments').status,'PASS');
    assert.equal(rows.find(r=>r.check_name==='password-reset challenge fields expired over 24 hours').affected,1);
    assert.equal(rows.find(r=>r.check_name==='student OTP challenge fields expired over 24 hours').affected,1);
    assert.ok(!JSON.stringify(rows).includes('private@example.test'));
    assert.ok(!JSON.stringify(rows).includes('not-a-real-password'));
    assert.ok(!JSON.stringify(rows).includes('fixture-reset-'));
    assert.ok(!JSON.stringify(rows).includes('fixture-otp-'));
    assert.deepEqual((await db.query('SELECT * FROM users ORDER BY id')).rows, usersBefore);
    assert.deepEqual((await db.query('SELECT * FROM questions ORDER BY id')).rows, questionsBefore);
    assert.equal((await db.query('SELECT max_students FROM courses')).rows[0].max_students,-1);
  } finally { await db.close(); }
});

test('inventory retains empty application/platform/extension tables and makes no deletion claim for unknown objects', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA custom_owner;
      CREATE TABLE public.users(id uuid PRIMARY KEY, email text, password text);
      CREATE TABLE public.quiz_attempts(id uuid);
      CREATE TABLE auth.users(id uuid, private_value text);
      CREATE TABLE storage.objects(id uuid, private_path text);
      CREATE TABLE public.unrecognized_empty(id uuid);
      CREATE TABLE custom_owner.custom_data(id uuid);
      CREATE TABLE public.extension_state(id uuid);
      ALTER EXTENSION plpgsql ADD TABLE public.extension_state;
      INSERT INTO public.users VALUES (gen_random_uuid(),'private-marker@example.invalid','private-password-marker');
      INSERT INTO auth.users VALUES (gen_random_uuid(),'private-auth-marker');
      INSERT INTO storage.objects VALUES (gen_random_uuid(),'private-storage-marker');`);
    const usersBefore = (await db.query('SELECT * FROM public.users')).rows;
    const objects = (await db.exec(inventory)).flatMap(result => result.rows || []);
    const find = (schema, name) => objects.find(row => row.schema_name === schema && row.object_name === name);
    assert.match(find('public','quiz_attempts').disposition, /^KEEP:/);
    assert.match(find('auth','users').disposition, /^KEEP: platform/);
    assert.match(find('storage','objects').disposition, /^KEEP: platform/);
    assert.match(find('public','extension_state').disposition, /^KEEP: extension/);
    assert.match(find('public','unrecognized_empty').disposition, /^REVIEW ONLY:/);
    assert.match(find('custom_owner','custom_data').disposition, /^REVIEW OWNER:/);
    assert.ok(Array.isArray(find('public','users').columns));
    assert.equal(JSON.stringify(objects).includes('private-marker@'), false);
    assert.equal(JSON.stringify(objects).includes('private-password-marker'), false);
    assert.equal(JSON.stringify(objects).includes('private-auth-marker'), false);
    assert.equal(JSON.stringify(objects).includes('private-storage-marker'), false);
    assert.deepEqual((await db.query('SELECT * FROM public.users')).rows, usersBefore);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.unrecognized_empty')).rows[0].n,0);
  } finally { await db.close(); }
});

test('catalog inventory executes without assuming any EraEdu tables are installed', async () => {
  const db = await PGlite.create();
  try {
    assert.ok(Array.isArray((await db.exec(inventory)).flatMap(result => result.rows || [])));
    assert.equal((await db.query("SELECT to_regclass('public.users') AS users")).rows[0].users,null);
  } finally { await db.close(); }
});
