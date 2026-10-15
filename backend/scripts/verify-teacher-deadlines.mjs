// Isolated SQL regression check, never a Supabase/production connection.
// Install @electric-sql/pglite@0.5.10 in a disposable tools directory, set
// PGLITE_MODULE_PATH to its dist/index.js, then run `node --test` on this file.
// Minimal prerequisite tables test migration 027, NOT the entire schema/RLS.
// PGlite is single-connection: real lock contention still requires staging.
import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
let db;
const student = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const teacher = '20000000-0000-4000-8000-000000000001';
const quiz = '30000000-0000-4000-8000-000000000001';
const course = '40000000-0000-4000-8000-000000000001';
const qid = index => `${quiz}-q${index}`;
const epoch = Date.parse('2030-01-01T00:00:00.000Z');
const clock = seconds => db.query('UPDATE test_clock SET value=$1', [new Date(epoch + seconds * 1000).toISOString()]);
const result = async (sql, params) => (await db.query(sql, params)).rows[0].result;
const start = (owner = student) => result('SELECT start_teacher_attempt($1::uuid,$2::uuid) AS result', [owner, quiz]);
const action = (id, name, question = null, answers = [], owner = student) => result(
  'SELECT teacher_attempt_action($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) AS result',
  [owner, id, name, question, JSON.stringify(answers)],
);
const canonical = (index, selectedAnswer) => ({
  questionId: qid(index), selectedAnswer, isCorrect: selectedAnswer === 0,
  questionType: 'multipleChoice', answerVersion: 2,
});
const report = (id, eventId, owner = student) => result(
  'SELECT report_teacher_violation($1::uuid,$2::uuid,$3::jsonb) AS result',
  [owner, id, JSON.stringify({ eventId, violationType: 'tab_change', detectionMethod: 'browser_event', severity: 'low', details: {} })],
);

before(async () => {
  db = await PGlite.create(); // in-memory, no data directory and no remote URL
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE users (id uuid PRIMARY KEY, role text, is_suspended boolean DEFAULT false);
    CREATE TABLE courses (id uuid PRIMARY KEY, is_published boolean);
    CREATE TABLE enrollments (user_id uuid, course_id uuid);
    CREATE TABLE teacher_quizzes (id uuid PRIMARY KEY, teacher_id text, title text,
      is_active boolean, scheduled_start timestamptz, questions jsonb, course_id uuid,
      time_limit integer, violation_limit integer);
    CREATE TABLE quiz_attempts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
      quiz_id uuid, topic_id uuid, started_at timestamptz, completed_at timestamptz,
      status text, answers jsonb, score integer, max_score integer,
      auto_submitted boolean DEFAULT false, submission_reason text, violation_count integer DEFAULT 0);
    CREATE TABLE cheating_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      quiz_attempt_id uuid, student_id uuid, quiz_id uuid, teacher_id uuid,
      violation_type text, detection_method text, severity text, details jsonb,
      timestamp timestamptz, event_id text);
    CREATE UNIQUE INDEX event_retry_identity ON cheating_violations (quiz_attempt_id,event_id) WHERE event_id IS NOT NULL;
    CREATE TABLE test_clock (value timestamptz);
    INSERT INTO test_clock VALUES ('2030-01-01T00:00:00Z');
    CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT value FROM test_clock';
  `);
  const sql = await readFile(new URL('../migrations/027_teacher_attempt_deadlines.sql', import.meta.url), 'utf8');
  // Inject only the clock for deterministic elapsed-time assertions; execute
  // the shipped SQL body, indexes, transactions and grants without mocks.
  await db.exec(sql.replaceAll('clock_timestamp()', 'public.test_now()'));
});
after(async () => { if (db) await db.close(); });
beforeEach(async () => {
  await db.exec('TRUNCATE users, courses, enrollments, teacher_quizzes, quiz_attempts, cheating_violations');
  await clock(0);
  await db.query('INSERT INTO users(id,role) VALUES ($1,\'student\'),($2,\'student\'),($3,\'teacher\')', [student, other, teacher]);
  await db.query('INSERT INTO courses VALUES ($1,true)', [course]);
  await db.query('INSERT INTO enrollments VALUES ($1,$2)', [student, course]);
  const questions = Array.from({ length: 3 }, (_, i) => ({ text: `Q${i + 1}`, options: ['right', 'wrong'], correctAnswer: 0, timeLimit: 60 }));
  await db.query(`INSERT INTO teacher_quizzes(id,teacher_id,title,is_active,questions,course_id,time_limit,violation_limit)
    VALUES ($1,$2,'Isolated exam',true,$3,$4,10,2)`, [quiz, teacher, JSON.stringify(questions), course]);
});

test('repeated starts resume one immutable attempt; live edits do not change its questions', async () => {
  const first = await start();
  await db.query(`UPDATE teacher_quizzes SET questions='[]' WHERE id=$1`, [quiz]);
  // Existing immutable variant is still recoverable through the active API.
  const restored = await action(first.id, 'read');
  assert.equal(restored.teacher_quiz_snapshot.questions.length, 3);
  await db.query('UPDATE teacher_quizzes SET questions=$1 WHERE id=$2', [JSON.stringify(first.teacher_quiz_snapshot.questions), quiz]);
  const second = await start();
  assert.equal(second.id, first.id);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM quiz_attempts')).rows[0].n, 1);
});

test('20 seconds on a 60-second question leaves 40 across switch, read and reactivation; late edits are denied', async () => {
  const { id } = await start();
  const initial = await action(id, 'activate', qid(0));
  await action(id, 'answer', null, [canonical(0, 1)]);
  await clock(20);
  await action(id, 'activate', qid(1));
  const restored = await action(id, 'read');
  const revisited = await action(id, 'activate', qid(0));
  const deadline = initial.teacher_question_state[qid(0)].deadlineAt;
  assert.equal(restored.teacher_question_state[qid(0)].deadlineAt, deadline);
  assert.equal(revisited.teacher_question_state[qid(0)].deadlineAt, deadline);
  assert.equal((Date.parse(deadline) - Date.parse(revisited.serverNow)) / 1000, 40);
  await clock(61);
  await assert.rejects(action(id, 'answer', null, [canonical(0, 0)]), /deadline has passed/);
  await action(id, 'answer', null, [canonical(0, 1)]); // identical retry, not extra time
  const expired = await action(id, 'activate', qid(0));
  assert.equal(Math.max(0, Date.parse(deadline) - Date.parse(expired.serverNow)), 0);
});

test('only Q3 correct finalizes at 1/3 with one correct row, independent of caller correctness flags', async () => {
  const { id } = await start();
  for (let i = 0; i < 3; i++) await action(id, 'activate', qid(i));
  await action(id, 'answer', null, [canonical(0, 1), canonical(1, 1), { ...canonical(2, 0), isCorrect: false }]);
  const completed = await action(id, 'submit');
  assert.equal(completed.score, 1);
  assert.equal(completed.max_score, 3);
  assert.equal(Math.round(completed.score / completed.max_score * 100), 33);
  assert.equal(completed.answers.filter(answer => answer.isCorrect).length, 1);
  assert.equal((await action(id, 'submit')).newlyCompleted, false);
  await assert.rejects(action(id, 'answer', null, [canonical(0, 0)]), /already submitted/);
  await assert.rejects(start(), /already submitted/);
});

test('unanswered questions contribute zero and keep maxScore; unactivated, invalid and duplicate answers fail', async () => {
  const { id } = await start();
  await assert.rejects(action(id, 'answer', null, [canonical(0, 0)]), /not been activated/);
  await action(id, 'activate', qid(0));
  await assert.rejects(action(id, 'answer', null, [canonical(0, 0), canonical(0, 1)]), /only be answered once/);
  await assert.rejects(action(id, 'answer', null, [canonical(0, 20)]), /out of range/);
  await assert.rejects(action(id, 'answer', null, [canonical(9, 0)]), /does not belong/);
  const completed = await action(id, 'submit');
  assert.equal(completed.score, 0);
  assert.equal(completed.max_score, 3);
  assert.equal(completed.answers.length, 3);
  assert.ok(completed.answers.every(answer => answer.selectedAnswer === null && answer.isCorrect === false));
});

test('duplicate events count once, threshold finalizes saved answers, late distinct reports never regrade', async () => {
  const { id } = await start();
  await action(id, 'activate', qid(0));
  await action(id, 'answer', null, [canonical(0, 0)]);
  const first = await report(id, 'event-one');
  const retry = await report(id, 'event-one');
  assert.equal(first.violationId, retry.violationId);
  assert.equal(retry.violationCount, 1);
  assert.equal((await report(id, 'event-two')).autoSubmitted, true);
  const completed = await action(id, 'read');
  assert.equal(completed.score, 1);
  assert.equal(completed.submission_reason, 'excessive_violations');
  const late = await report(id, 'event-three');
  assert.equal(late.violationCount, 3);
  assert.equal(late.autoSubmitted, false);
  assert.equal(late.alreadySubmitted, true);
  const final = await action(id, 'read');
  assert.equal(final.score, completed.score);
  assert.equal(final.completed_at, completed.completed_at);
  assert.deepEqual(final.answers, completed.answers);
});

test('overall deadline finalizes saved answers before a direct late answer can change them', async () => {
  const { id } = await start();
  await action(id, 'activate', qid(0));
  await action(id, 'answer', null, [canonical(0, 0)]);
  await clock(601);
  const late = await action(id, 'answer', null, [canonical(0, 1)]);
  assert.equal(late.expired, true);
  assert.equal(late.status, 'completed');
  assert.equal(late.score, 1);
  assert.equal(late.submission_reason, 'time_expired');
});

test('foreign students cannot read, activate, submit or report against the attempt', async () => {
  const { id } = await start();
  for (const name of ['read', 'activate', 'submit']) {
    await assert.rejects(action(id, name, qid(0), [], other), /not found/);
  }
  await assert.rejects(report(id, 'foreign-event', other), /not found/);
  await assert.rejects(start(other), /Course access is unavailable/);
});

test('unpublished/missing courses, inactive exams and suspended students cannot start', async () => {
  await db.query('UPDATE courses SET is_published=false WHERE id=$1', [course]);
  await assert.rejects(start(), /Course access is unavailable/);
  await db.query('DELETE FROM courses WHERE id=$1', [course]); // isolated fixture only
  await assert.rejects(start(), /Course access is unavailable/);
  await db.query('INSERT INTO courses VALUES ($1,true)', [course]);
  await db.query('UPDATE teacher_quizzes SET is_active=false WHERE id=$1', [quiz]);
  await assert.rejects(start(), /Exam is unavailable/);
  await db.query('UPDATE teacher_quizzes SET is_active=true WHERE id=$1', [quiz]);
  await db.query('UPDATE users SET is_suspended=true WHERE id=$1', [student]);
  await assert.rejects(start(), /Student account is unavailable/);
});

test('short-answer clearing persists as a deliberate edit before expiry without inventing a manual grade', async () => {
  await db.query('UPDATE teacher_quizzes SET questions=$1 WHERE id=$2', [JSON.stringify([{ text: 'Explain', questionType: 'shortAnswer', options: [], timeLimit: 60 }]), quiz]);
  const { id } = await start();
  await action(id, 'activate', qid(0));
  const answer = { questionId: qid(0), selectedAnswer: 'Draft', questionType: 'shortAnswer', isCorrect: false, answerVersion: 2 };
  await action(id, 'answer', null, [answer]);
  await action(id, 'answer', null, [{ ...answer, selectedAnswer: '' }]);
  const completed = await action(id, 'submit');
  assert.equal(completed.answers[0].selectedAnswer, '');
  assert.equal(completed.score, 0);
});

test('empty or null question collections fail without creating a broken attempt', async () => {
  for (const questions of [[], null]) {
    await db.query('UPDATE teacher_quizzes SET questions=$1 WHERE id=$2', [questions === null ? null : JSON.stringify(questions), quiz]);
    await assert.rejects(start(), /Exam has no questions/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM quiz_attempts')).rows[0].n, 0);
  }
});

test('browser roles have neither RPC execution nor direct attempt/snapshot access', async () => {
  for (const role of ['anon', 'authenticated']) {
    const privileges = (await db.query(`SELECT
      has_function_privilege($1, 'public.start_teacher_attempt(uuid,uuid)', 'EXECUTE') AS start,
      has_function_privilege($1, 'public.teacher_attempt_action(uuid,uuid,text,text,jsonb)', 'EXECUTE') AS action,
      has_function_privilege($1, 'public.report_teacher_violation(uuid,uuid,jsonb)', 'EXECUTE') AS report,
      has_table_privilege($1, 'public.quiz_attempts', 'SELECT') AS read`, [role])).rows[0];
    assert.deepEqual(privileges, { start: false, action: false, report: false, read: false });
  }
});
