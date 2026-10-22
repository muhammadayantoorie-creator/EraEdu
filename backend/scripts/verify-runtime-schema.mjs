// Full migration replay in disposable memory only. No remote database URL or
// live credentials are accepted. Auth functions below are fixtures, not Supabase.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { collectRuntimeContracts, splitSelection } from './lib/runtime-database-contracts.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const migrationDirectory = new URL('../migrations/', import.meta.url);
const sql = name => readFile(new URL(name, migrationDirectory), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(through = '999') {
  const db = await PGlite.create();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT NULL::text';`);
  // Use only CREATE TABLE definitions from the development baseline. Never
  // execute its permissive grants/RLS-reset statements or use it on production.
  const base = await readFile(new URL('../src/scripts/create-all-tables.sql', import.meta.url), 'utf8');
  await db.exec(base.split('-- Create indexes for better performance')[0]);
  for (const name of (await readdir(migrationDirectory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    if (name.slice(0, 3) <= through) {
      try { await db.exec(await sql(name)); }
      catch (error) { await db.close(); throw new Error(`${name}: ${error.message}`); }
    }
  }
  return db;
}

test('backend literal columns, writes and embedded relationships match the complete migrated schema', async () => {
  const db = await fixture();
  try {
    const columns = (await db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'")).rows;
    const known = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
    const fks = (await db.query(`SELECT conrelid::regclass::text AS source, confrelid::regclass::text AS target, conname,
      ARRAY(SELECT a.attname::text FROM unnest(conkey) k JOIN pg_attribute a ON a.attrelid=conrelid AND a.attnum=k) AS keys
      FROM pg_constraint WHERE contype='f'`)).rows;
    const contracts = await collectRuntimeContracts(root);
    const failures = [], columnUses = [...contracts.columns];
    let wildcards = 0, relationships = 0;
    function select(table, expression, location) {
      for (const part of splitSelection(expression)) {
        const start = part.indexOf('(');
        if (start !== -1) {
          const reference = part.slice(0, start).trim().split(':').at(-1).split('!')[0];
          const candidates = fks.filter(fk => (fk.source === table && (fk.target === reference || fk.conname === reference || fk.keys.includes(reference)))
            || (fk.target === table && fk.source === reference));
          if (candidates.length !== 1) { failures.push({ ...location, relationship: `${table}.${reference}`, matches: candidates.length }); continue; }
          const fk = candidates[0], target = fk.source === table ? fk.target : fk.source;
          relationships++;
          select(target, part.slice(start + 1, part.lastIndexOf(')')), location);
        } else if (part === '*') wildcards++;
        else {
          const column = part.split(':').at(-1).split('::')[0].trim();
          if (/^[a-z_][a-z_0-9]*$/.test(column)) columnUses.push({ ...location, table, column });
        }
      }
    }
    for (const query of contracts.selects) select(query.table, query.expression, query);
    for (const use of columnUses) if (!known.has(`${use.table}.${use.column}`)) failures.push(use);
    assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
    assert.ok(contracts.files >= 50 && columnUses.length >= 600, 'Unexpected loss of query coverage');
    console.log(JSON.stringify({ runtimeFiles: contracts.files, checkedColumnUses: columnUses.length, checkedRelationships: relationships,
      wildcardSelects: wildcards, dynamicCallsRequiringReview: contracts.unresolved.length }));
  } finally { await db.close(); }
});

test('complete migration chain has no structural/security blockers and all read-only diagnostics execute', async () => {
  const db = await fixture();
  try {
    const audit = await db.exec(await readFile(new URL('./audit_database_readonly.sql', import.meta.url), 'utf8'));
    const rows = audit.find(result => result.rows?.[0]?.check_name)?.rows;
    assert.ok(rows?.length > 300);
    assert.deepEqual(rows.filter(row => row.status === 'BLOCKED'), []);
    assert.ok(rows.some(row => row.status === 'NOT_TESTED'), 'Keep explicit live-verification limits');
    for (const name of ['inventory_database_readonly.sql', 'audit_database_data_readonly.sql', 'verify-course-assignment.sql', 'verify-monitoring-schema.sql', 'verify-teacher-deadlines.sql', 'preflight-runtime-reconciliation.sql']) {
      const result = await db.exec(await readFile(new URL(name, import.meta.url), 'utf8'));
      const statuses = result.flatMap(item => item.rows || []).filter(row => row.status);
      assert.ok(statuses.every(row => row.status === 'PASS'), `${name}: ${JSON.stringify(statuses.filter(row => row.status !== 'PASS'))}`);
    }
  } finally { await db.close(); }
});

test('assigned course, enrollment, unpublished code exam, immutable attempt and reassignment work together as service_role', async () => {
  const db = await fixture();
  try {
    await db.query(`INSERT INTO users(id,name,email,password,role) VALUES
      ($1,'Admin','admin@example.invalid','fixture','admin'),($2,'Teacher','teacher@example.invalid','fixture','teacher'),
      ($3,'Replacement','replacement@example.invalid','fixture','teacher'),($4,'Student','student@example.invalid','fixture','student')`,
    [id(1), id(2), id(3), id(4)]);
    await db.query("INSERT INTO organizations(id,name,owner_id) VALUES ($1,'Fixture institution',$2)", [id(10), id(2)]);
    await db.query('INSERT INTO organization_members(organization_id,user_id) VALUES ($1,$2),($1,$3)', [id(10), id(2), id(3)]);
    await db.exec('SET ROLE service_role');
    const course = (await db.query("SELECT admin_create_assigned_course($1,$2,$3,'Fixture course','','Other','Beginner','TST123',2) AS result", [id(1), id(2), id(10)])).rows[0].result;
    await db.query('UPDATE courses SET is_published=true WHERE id=$1', [course.id]);
    await db.query('SELECT enroll_course_with_capacity($1,$2)', [course.id, id(4)]);
    await db.query('SELECT enroll_course_with_capacity($1,$2)', [course.id, id(4)]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM enrollments')).rows[0].n, 1);
    // Course publication controls the catalog, not a private code exam for
    // students who are already enrolled. Exercise the complete migrated schema.
    await db.query('UPDATE courses SET is_published=false WHERE id=$1', [course.id]);
    const questions = [{ text: 'Fixture MCQ', options: ['right','wrong'], correctAnswer: 0, timeLimit: 60 }];
    await db.query(`INSERT INTO teacher_quizzes(id,teacher_id,course_id,title,questions,access_code,time_limit)
      VALUES ($1,$2,$3,'Original exam',$4,'1234',3)`, [id(20), id(2), course.id, JSON.stringify(questions)]);
    await db.query("INSERT INTO quiz_codes(quiz_id,course_id,created_by,code) VALUES ($1,$2,$3,'5678')", [id(20), course.id, id(2)]);
    const attempt = (await db.query('SELECT start_teacher_attempt($1,$2) AS result', [id(4), id(20)])).rows[0].result;
    assert.equal((await db.query('SELECT is_published FROM courses WHERE id=$1', [course.id])).rows[0].is_published, false);
    await db.query("UPDATE teacher_quizzes SET title='Edited exam',questions=$1 WHERE id=$2", [JSON.stringify([{ ...questions[0], correctAnswer: 1 }]), id(20)]);
    const questionId = `${id(20)}-q0`;
    await db.query("SELECT teacher_attempt_action($1,$2,'activate',$3)", [id(4), attempt.id, questionId]);
    await db.query("SELECT teacher_attempt_action($1,$2,'answer',NULL,$3)", [id(4), attempt.id, JSON.stringify([{ questionId, selectedAnswer: 0 }])]);
    const completed = (await db.query("SELECT teacher_attempt_action($1,$2,'submit') AS result", [id(4), attempt.id])).rows[0].result;
    assert.equal(completed.score, 1);
    assert.equal(completed.teacher_quiz_snapshot.title, 'Original exam');
    await db.query('SELECT admin_reassign_course($1,$2,$3,$4)', [id(1), course.id, id(3), id(10)]);
    assert.equal((await db.query('SELECT created_by FROM quiz_codes')).rows[0].created_by, id(3));
    assert.equal((await db.query('SELECT score FROM quiz_attempts')).rows[0].score, 1);
    await assert.rejects(db.query('DELETE FROM courses WHERE id=$1', [course.id]), /foreign key/);
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});

test('030 refuses legacy topic codes atomically without deleting or relinking them', async () => {
  const db = await fixture('029');
  try {
    await db.query("INSERT INTO quizzes(id,title) VALUES ($1,'Legacy topic quiz')", [id(50)]);
    await db.query("INSERT INTO quiz_codes(quiz_id,code) VALUES ($1,'9876')", [id(50)]);
    const before = (await db.query('SELECT * FROM quiz_codes')).rows;
    await assert.rejects(db.exec(await sql('030_reconcile_quiz_code_reference.sql')), /requires review/);
    await db.exec('ROLLBACK');
    assert.deepEqual((await db.query('SELECT * FROM quiz_codes')).rows, before);
    assert.equal((await db.query("SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid='quiz_codes'::regclass AND conname='quiz_codes_quiz_id_fkey'")).rows[0].target, 'quizzes');
  } finally { await db.close(); }
});

test('030 can be repeated with valid teacher codes without changing their records or trial counters', async () => {
  const db = await fixture('030');
  try {
    await db.query("INSERT INTO users(id,name,email,password,role) VALUES ($1,'Teacher','teacher@example.invalid','fixture','teacher')", [id(2)]);
    await db.query("INSERT INTO teacher_quizzes(id,teacher_id,title) VALUES ($1,$2,'Teacher exam')", [id(20), id(2)]);
    await db.query("INSERT INTO quiz_codes(quiz_id,created_by,code) VALUES ($1,$2,'2468')", [id(20), id(2)]);
    const codes = (await db.query('SELECT * FROM quiz_codes')).rows;
    const users = (await db.query('SELECT * FROM users')).rows;
    await db.exec(await sql('030_reconcile_quiz_code_reference.sql'));
    await db.exec(await sql('030_reconcile_quiz_code_reference.sql'));
    assert.deepEqual((await db.query('SELECT * FROM quiz_codes')).rows, codes);
    assert.deepEqual((await db.query('SELECT * FROM users')).rows, users);
  } finally { await db.close(); }
});

test('031 removes legacy table and column grants, keeps service CRUD, records and unrelated objects', async () => {
  const db = await fixture('030');
  try {
    await db.exec(`GRANT SELECT(password) ON users TO anon; GRANT SELECT ON courses TO PUBLIC;
      CREATE TABLE auth.provider_fixture(id integer); INSERT INTO auth.provider_fixture VALUES (1);
      CREATE TABLE public.custom_fixture(id integer); GRANT SELECT ON custom_fixture TO anon;
      INSERT INTO users(name,email,password) VALUES ('Fixture','fixture@example.invalid','keep-this-value');`);
    const before = (await db.query('SELECT * FROM users')).rows;
    await db.exec(await sql('031_enforce_api_database_boundary.sql'));
    await db.exec(await sql('031_enforce_api_database_boundary.sql'));
    assert.equal((await db.query("SELECT has_any_column_privilege('anon','users','SELECT') AS access")).rows[0].access, false);
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','courses','SELECT') AS access")).rows[0].access, false);
    assert.equal((await db.query("SELECT has_table_privilege('service_role','users','SELECT') AND has_table_privilege('service_role','users','INSERT') AND has_table_privilege('service_role','users','UPDATE') AND has_table_privilege('service_role','users','DELETE') AS access")).rows[0].access, true);
    assert.equal((await db.query("SELECT has_table_privilege('anon','custom_fixture','SELECT') AS access")).rows[0].access, true);
    assert.deepEqual((await db.query('SELECT * FROM users')).rows, before);
    assert.deepEqual((await db.query('SELECT * FROM auth.provider_fixture')).rows, [{ id: 1 }]);
  } finally { await db.close(); }
});

test('031 refuses inherited browser grants and rolls back rather than changing unrelated roles', async () => {
  const db = await fixture('030');
  try {
    await db.exec('CREATE ROLE inherited_reader; GRANT SELECT ON users TO inherited_reader; GRANT inherited_reader TO anon;');
    await assert.rejects(db.exec(await sql('031_enforce_api_database_boundary.sql')), /inherited role grants/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT has_table_privilege('anon','users','SELECT') AS access")).rows[0].access, true);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='users'::regclass")).rows[0].relrowsecurity, false);
  } finally { await db.close(); }
});
