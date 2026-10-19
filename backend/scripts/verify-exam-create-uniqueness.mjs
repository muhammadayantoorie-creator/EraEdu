// Disposable PostgreSQL only; never connects to the application database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
const trialMigration = await readFile(new URL('../migrations/018_share_free_trials_by_institution.sql', import.meta.url), 'utf8');
const trialTrigger = trialMigration.slice(trialMigration.indexOf('CREATE OR REPLACE FUNCTION enforce_free_assessment_trial_limit()'));
const teacher = '00000000-0000-4000-8000-000000000001';
const institution = '00000000-0000-4000-8000-000000000002';
const exam = '00000000-0000-8000-8000-000000000003';
async function fixture(member) {
  const db = await PGlite.create();
  await db.exec(`
    CREATE TABLE users (id uuid PRIMARY KEY, subscription_status text, free_assessment_trials_used integer NOT NULL DEFAULT 0);
    CREATE TABLE organizations (id uuid PRIMARY KEY, subscription_status text, free_assessment_trials_used integer NOT NULL DEFAULT 0);
    CREATE TABLE organization_members (user_id uuid, organization_id uuid, created_at timestamptz DEFAULT now());
    CREATE TABLE teacher_quizzes (id uuid PRIMARY KEY, teacher_id text NOT NULL, title text);
    INSERT INTO users (id, subscription_status) VALUES ('${teacher}','free');
    INSERT INTO organizations (id, subscription_status) VALUES ('${institution}','free');
    ${member ? `INSERT INTO organization_members (user_id, organization_id) VALUES ('${teacher}', '${institution}');` : ''}
  `);
  await db.exec(trialTrigger);
  return db;
}
for (const member of [false, true]) {
  test(`duplicate exam primary key rolls back the ${member ? 'institution' : 'independent teacher'} trial counter`, async () => {
    const db = await fixture(member);
    try {
      const insert = `INSERT INTO teacher_quizzes VALUES ('${exam}','${teacher}','NLP')`;
      await db.exec(insert);
      await assert.rejects(db.exec(insert), /duplicate key/);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM teacher_quizzes')).rows[0].n, 1);
      const owner = member ? 'organizations' : 'users';
      assert.equal((await db.query(`SELECT free_assessment_trials_used AS used FROM ${owner}`)).rows[0].used, 1);
      // At the last free slot, a competing retry may fail in the BEFORE
      // trigger rather than at the PK. The service must replay the saved row.
      await db.exec(`UPDATE ${owner} SET free_assessment_trials_used=5`);
      await assert.rejects(db.exec(insert), /FREE_ASSESSMENT_TRIAL_LIMIT_REACHED/);
      assert.equal((await db.query(`SELECT free_assessment_trials_used AS used FROM ${owner}`)).rows[0].used, 5);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM teacher_quizzes')).rows[0].n, 1);
    } finally { await db.close(); }
  });
}
