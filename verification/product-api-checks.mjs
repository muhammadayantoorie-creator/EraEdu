// Bounded public/read-only requests; the only POSTs contain invalid bodies
// rejected before account lookup, email delivery, payment or data mutation.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
if (!process.argv.includes('--live')) throw new Error('Pass --live to check the public EraEdu deployment.');
const backend = 'https://era-edu.vercel.app';
const origins = ['https://era-edu-mtoc.vercel.app', 'https://muhammadayantoorie-creator.github.io'];
const output = path.resolve('backend/coverage/product-api');
await mkdir(output, { recursive: true });
const results = [];
const fetchUrl = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
async function check(name, action) {
  try { const details = await action(); results.push({ name, status: 'PASS', ...details }); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.message.slice(0, 500) }); }
  console.log(JSON.stringify(results.at(-1)));
}
async function catalog() {
  await check('public catalog contains only published public fields', async () => {
    const response = await fetchUrl(backend + '/api/courses'); assert.equal(response.status, 200);
    const body = await response.json(); assert.ok(Array.isArray(body.data));
    assert.ok(body.data.every(row => row.is_published === true), 'Unpublished courses are exposed anonymously');
    assert.ok(body.data.every(row => ['course_code', 'created_by', 'organization_id'].every(key => !Object.hasOwn(row, key))),
      'Management-only course fields are exposed anonymously');
    return { publishedCourseCount: body.data.length };
  });
}
if (process.argv.includes('--catalog-only')) await catalog();
else {
  await check('API readiness', async () => {
    const response = await fetchUrl(backend + '/health'); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.checks.database, 'ok');
    return { databaseReadiness: body.checks.database, aiConfiguration: body.checks.ai };
  });
  await catalog();
  const id = '00000000-0000-4000-8000-000000000001';
  const protectedPaths = [
    '/api/auth/me', '/api/courses/my/enrolled', '/api/courses/teacher/my-courses', '/api/courses/teacher/topics',
    '/api/courses/teacher/questions', `/api/courses/${id}`, `/api/courses/${id}/topics`,
    '/api/quizzes/history', '/api/quizzes/teacher/my-quizzes', '/api/quizzes/teacher/submissions',
    `/api/quizzes/teacher/quiz/${id}`, '/api/quizzes/teacher/analytics', '/api/quizzes/student/analytics',
    `/api/quizzes/attempt/${id}/active`, `/api/quizzes/attempt/${id}/results`, `/api/quizzes/${id}/codes`,
    `/api/quizzes/attempts/${id}/violations`, '/api/quizzes/violations/summary',
    `/api/quizzes/topic-attempt/${id}/current`, '/api/quizzes/access-by-code/000000',
    '/api/analytics/dashboard', '/api/analytics/weak-topics', '/api/analytics/progress-over-time',
    '/api/analytics/teacher/stats', '/api/analytics/teacher/recent-activity', '/api/analytics/teacher/course-performance',
    '/api/analytics/teacher/course-analytics', '/api/analytics/teacher/time-series', '/api/analytics/teacher/courses',
    '/api/analytics/teacher/topics', '/api/analytics/teacher/questions', '/api/analytics/teacher/export-marks',
    '/api/admin/overview', '/api/admin/users', '/api/admin/courses', '/api/admin/course-options',
    '/api/admin/attempts', '/api/admin/feedback', '/api/admin/integrity-events',
    `/api/questions/${id}`, `/api/questions/topic/${id}`, '/api/notifications', '/api/organizations',
    `/api/organizations/${id}/members`, '/api/safepay/subscription', '/api/safepay/status/nonexistent-test-tracker',
    '/api/ai/recommendations', '/api/ai/insights',
  ];
  for (const endpoint of protectedPaths) await check(`unauthenticated ${endpoint}`, async () => {
    const response = await fetchUrl(backend + endpoint); const body = await response.json();
    assert.equal(response.status, 401); assert.equal(body.error?.code, 'AUTH_REQUIRED');
    return { httpStatus: response.status };
  });
  await check('invalid session is rejected', async () => {
    const response = await fetchUrl(backend + '/api/auth/me', { headers: { Authorization: 'Bearer invalid-test-token' } });
    const body = await response.json(); assert.equal(response.status, 401); assert.equal(body.error?.code, 'SESSION_INVALID');
  });
  for (const [origin, allowed] of [...origins.map(origin => [origin, true]),
    ['https://unrelated-owner.github.io', false], [origins[1] + '.evil.test', false], ['null', false]]) {
    await check(`credentialed origin ${origin}`, async () => {
      const response = await fetchUrl(backend + '/api/auth/me', { method: 'OPTIONS', headers: {
        Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'content-type',
      } });
      assert.equal(response.status, allowed ? 204 : 403);
      assert.equal(response.headers.get('access-control-allow-origin'), allowed ? origin : null);
      if (allowed) assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    });
  }
  for (const endpoint of ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-student-otp']) {
    await check(`invalid body ${endpoint}`, async () => {
      const response = await fetchUrl(backend + endpoint, { method: 'POST', headers: {
        Origin: origins[0], 'Content-Type': 'application/json',
      }, body: '{}' });
      const body = await response.json(); assert.equal(response.status, 400); assert.ok(body.error?.fields?.length);
      assert.equal(Object.hasOwn(body, 'stack'), false);
    });
  }
  await check('unknown API route has a safe JSON 404', async () => {
    const response = await fetchUrl(backend + '/api/product-test-route-does-not-exist'); const body = await response.json();
    assert.equal(response.status, 404); assert.equal(body.success, false); assert.equal(Object.hasOwn(body, 'stack'), false);
  });
  for (const [host, frontend] of [['vercel', origins[0]], ['pages', origins[1] + '/EraEdu']]) {
    await check(`${host} homepage, entry assets and API URL`, async () => {
      const response = await fetchUrl(frontend + '/'); const html = await response.text(); assert.equal(response.status, 200);
      const prefix = host === 'pages' ? '/EraEdu/' : '/';
      const entry = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]).find(value => value.includes('/assets/'));
      assert.ok(entry?.startsWith(prefix + 'assets/')); const bundle = await fetchUrl(new URL(entry, frontend));
      assert.equal(bundle.status, 200); assert.ok((await bundle.text()).includes(backend));
      const icon = await fetchUrl(frontend + '/eraedu-mark.svg'); assert.equal(icon.status, 200);
    });
    for (const manifest of ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model']) {
      await check(`${host} ${manifest} assets`, async () => {
        const response = await fetchUrl(frontend + '/models/' + manifest + '-weights_manifest.json');
        assert.equal(response.status, 200); const groups = await response.json(); assert.ok(Array.isArray(groups));
        const shards = [...new Set(groups.flatMap(group => group.paths))]; assert.ok(shards.length);
        for (const shard of shards) {
          assert.ok(!shard.includes('..') && !shard.includes('://'));
          const weight = await fetchUrl(frontend + '/models/' + shard, { method: 'HEAD' });
          assert.equal(weight.status, 200); assert.ok(!weight.headers.get('content-type')?.includes('text/html'));
        }
        return { shardCount: shards.length };
      });
    }
  }
}
const summary = { testedAt: new Date().toISOString(), scope: 'public HTTP contracts and signed-out boundaries; no authenticated business workflows',
  passed: results.filter(result => result.status === 'PASS').length, failed: results.filter(result => result.status === 'FAIL').length, results };
const filename = process.argv.includes('--catalog-only') ? 'catalog-retest.json' : 'results.json';
await writeFile(path.join(output, filename), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, evidenceDirectory: output }));
if (summary.failed) process.exitCode = 1;
