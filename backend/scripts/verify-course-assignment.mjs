// Disposable PostgreSQL only. Never connects to Supabase or changes live data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/024_assign_courses_to_teachers.sql', import.meta.url), 'utf8');
const verification = await readFile(new URL('./verify-course-assignment.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE users (id uuid PRIMARY KEY, name text, role text, is_suspended boolean NOT NULL DEFAULT false);
    CREATE TABLE organizations (id uuid PRIMARY KEY, name text);
    CREATE TABLE organization_members (organization_id uuid REFERENCES organizations, user_id uuid REFERENCES users, PRIMARY KEY (organization_id,user_id));
    CREATE TABLE courses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, description text, category text,
      difficulty text, course_code text, max_students integer, created_by uuid REFERENCES users);
    CREATE TABLE teacher_quizzes (id uuid PRIMARY KEY, teacher_id varchar(255), course_id uuid REFERENCES courses);
    CREATE TABLE quiz_codes (id uuid PRIMARY KEY, quiz_id uuid REFERENCES teacher_quizzes, course_id uuid REFERENCES courses, created_by uuid REFERENCES users);
    CREATE TABLE quiz_attempts (id uuid PRIMARY KEY, quiz_id uuid REFERENCES teacher_quizzes, score integer);
    INSERT INTO users (id,name,role) VALUES ('${id(1)}','Admin','admin'), ('${id(2)}','Original','teacher'),
      ('${id(3)}','Replacement','teacher'), ('${id(4)}','Other institution','teacher');
    INSERT INTO organizations VALUES ('${id(10)}','Institution'), ('${id(11)}','Other institution');
    INSERT INTO organization_members VALUES ('${id(10)}','${id(2)}'), ('${id(10)}','${id(3)}'), ('${id(11)}','${id(4)}');
    INSERT INTO courses (id,title,created_by,max_students) VALUES ('${id(20)}','Existing course','${id(2)}',30);
    INSERT INTO teacher_quizzes VALUES ('${id(30)}','${id(2)}','${id(20)}');
    INSERT INTO quiz_codes VALUES ('${id(40)}','${id(30)}','${id(20)}','${id(2)}');
    INSERT INTO quiz_attempts VALUES ('${id(50)}','${id(30)}',1);
  `);
  return db;
}
const reassign = (db, teacher = 3, org = 10) => db.query(
  'SELECT admin_reassign_course($1,$2,$3,$4) AS changed', [id(1), id(20), id(teacher), id(org)]);

test('editing an exam can select another assigned course, while the database rejects another teacher\'s course', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.query('INSERT INTO courses (id,title,created_by) VALUES ($1,$2,$3),($4,$5,$6)',
      [id(21), 'Another assigned course', id(2), id(22), 'Other teacher course', id(3)]);
    const originalAttempts = (await db.query('SELECT * FROM quiz_attempts')).rows;
    await db.query('UPDATE teacher_quizzes SET course_id = $1 WHERE id = $2 AND teacher_id = $3', [id(21), id(30), id(2)]);
    await assert.rejects(db.query('UPDATE teacher_quizzes SET course_id = $1 WHERE id = $2', [id(22), id(30)]),
      /Only the assigned course teacher can manage this exam/);
    assert.deepEqual((await db.query('SELECT course_id,teacher_id,original_teacher_id FROM teacher_quizzes')).rows,
      [{ course_id: id(21), teacher_id: id(2), original_teacher_id: id(2) }]);
    assert.deepEqual((await db.query('SELECT * FROM quiz_attempts')).rows, originalAttempts);
  } finally { await db.close(); }
});

test('reproduces the missing field, repairs it repeatably, and passes the read-only checks', async () => {
  const db = await fixture();
  try {
    assert.equal(Object.hasOwn((await db.query('SELECT * FROM courses')).rows[0], 'organization_id'), false);
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await db.query('SELECT organization_id FROM courses')).rows[0].organization_id, null);
    assert.equal((await db.query('SELECT original_teacher_id FROM teacher_quizzes')).rows[0].original_teacher_id, id(2));
    const rows = (await db.exec(verification)).find(result => result.rows?.[0]?.check_type)?.rows;
    assert.equal(rows.length, 12);
    assert.ok(rows.every(row => row.status === 'PASS'), JSON.stringify(rows));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM course_assignment_audit')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('assignment preserves course, exam and attempt history, and retry does not duplicate audit', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    assert.equal((await reassign(db)).rows[0].changed, true);
    assert.equal((await reassign(db)).rows[0].changed, false);
    assert.deepEqual((await db.query('SELECT created_by,organization_id FROM courses')).rows,
      [{ created_by: id(3), organization_id: id(10) }]);
    assert.deepEqual((await db.query('SELECT teacher_id,original_teacher_id FROM teacher_quizzes')).rows,
      [{ teacher_id: id(3), original_teacher_id: id(2) }]);
    assert.equal((await db.query('SELECT created_by FROM quiz_codes')).rows[0].created_by, id(3));
    assert.deepEqual((await db.query('SELECT id,score FROM quiz_attempts')).rows, [{ id: id(50), score: 1 }]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM course_assignment_audit')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('cross-institution assignment is denied without changing the course or its audit', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await assert.rejects(reassign(db, 4, 11), /Current teacher is not in the selected institution/);
    assert.equal((await db.query('SELECT created_by FROM courses')).rows[0].created_by, id(2));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM course_assignment_audit')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('audit failure rolls back manager, exam and access-code changes together', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec(`CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated audit failure'; END; $$;
      CREATE TRIGGER reject_audit BEFORE INSERT ON course_assignment_audit FOR EACH ROW EXECUTE FUNCTION reject_audit();`);
    await assert.rejects(reassign(db), /isolated audit failure/);
    assert.equal((await db.query('SELECT created_by FROM courses')).rows[0].created_by, id(2));
    assert.equal((await db.query('SELECT teacher_id FROM teacher_quizzes')).rows[0].teacher_id, id(2));
    assert.equal((await db.query('SELECT created_by FROM quiz_codes')).rows[0].created_by, id(2));
  } finally { await db.close(); }
});

test('a missing prerequisite rolls the migration back without leaving a partially repaired schema', async () => {
  const db = await fixture();
  try {
    await db.exec('DROP TABLE quiz_codes');
    await assert.rejects(db.exec(migration), /quiz_codes/);
    await db.exec('ROLLBACK');
    assert.equal(Object.hasOwn((await db.query('SELECT * FROM courses')).rows[0], 'organization_id'), false);
    assert.equal((await db.query("SELECT to_regclass('public.course_assignment_audit') AS value")).rows[0].value, null);
  } finally { await db.close(); }
});
