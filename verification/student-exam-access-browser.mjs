// UI fixtures only: every API request is intercepted; no live enrollments,
// publication settings, exam attempts or camera permissions are changed.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright-core');
const targets = process.argv.includes('--live')
  ? [['vercel', 'https://era-edu-mtoc.vercel.app'], ['pages', 'https://muhammadayantoorie-creator.github.io/EraEdu']]
  : [['local', 'http://127.0.0.1:4173']];
const output = path.resolve('backend/coverage/student-exam-access-browser');
await mkdir(output, { recursive: true });
const student = { _id: 'fixture-student', name: 'Fixture Student', email: 'student@example.invalid', role: 'student', isEmailVerified: true };
const notEnrolled = 'Join this exam\'s course from My Courses using the 6-character course code, then try the 4-digit exam code again.';
const startDenied = 'Ask your teacher to confirm the course linked to this exam and your enrollment. Join it from My Courses using its 6-character course code, then retry the 4-digit exam code.';
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const results = [];
try {
  for (const [host, base] of targets) {
    for (const scenario of ['unpublished', 'not-enrolled', 'published', 'completed', 'start-access-changed']) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 1000 }, serviceWorkers: 'block' });
      const unknown = [], starts = [], errors = [];
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (!url.pathname.startsWith('/api/') && url.hostname !== 'era-edu.vercel.app') return route.continue();
        const endpoint = url.pathname.replace(/^\/api/, '');
        const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
        if (req.method() === 'GET' && endpoint === '/auth/me') return reply(200, { success: true, data: student });
        if (req.method() === 'GET' && endpoint === '/notifications') return reply(200, { success: true, data: [] });
        if (req.method() === 'GET' && endpoint === '/quizzes/access-by-code/1234') {
          if (scenario === 'not-enrolled') return reply(403, {
            success: false, error: { message: notEnrolled },
          });
          return reply(200, { success: true, data: { code: '1234', quiz: {
            _id: 'fixture-exam', title: 'Fixture exam', courseId: 'fixture-course', courseTitle: 'Fixture course',
            timeLimit: 3, questionCount: 2, cameraMonitoring: false, alreadySubmitted: scenario === 'completed',
            completedAttemptId: scenario === 'completed' ? 'fixture-attempt' : null,
          } } });
        }
        if (req.method() === 'POST' && endpoint === '/quizzes/start-by-code/1234') {
          starts.push({ account: req.headers()['x-eraedu-account'] });
          return reply(403, { success: false, error: { message: startDenied } });
        }
        unknown.push(`${req.method()} ${endpoint}`);
        return reply(500, { success: false, message: 'Unexpected fixture request' });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(base + '/dashboard/student/join-quiz', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.getByPlaceholder('1234', { exact: true }).fill('1234');
        await page.getByRole('button', { name: 'Access Exam', exact: true }).click();
        if (scenario === 'not-enrolled') {
          await page.getByRole('alert').filter({ hasText: notEnrolled }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Start Exam', exact: true }).count(), 0);
        } else if (scenario === 'completed') {
          await page.getByText('Exam already submitted', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'View submission', exact: true }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Start Exam', exact: true }).count(), 0);
        } else {
          const startButton = page.getByRole('button', { name: 'Start Exam', exact: true });
          await startButton.waitFor();
          assert.ok(await startButton.isEnabled());
          if (scenario === 'start-access-changed') {
            await startButton.click();
            await page.getByRole('checkbox', { name: 'I understand the exam rules and want to continue.' }).check();
            await page.getByRole('button', { name: 'I understand, continue', exact: true }).click();
            await page.getByRole('alert').filter({ hasText: startDenied }).waitFor();
            assert.equal(new URL(page.url()).pathname.endsWith('/dashboard/student/join-quiz'), true);
          }
        }
        assert.equal(starts.length, scenario === 'start-access-changed' ? 1 : 0);
        if (starts.length) assert.equal(starts[0].account, student._id);
        assert.deepEqual(unknown, []);
        assert.deepEqual(errors, []);
        results.push({ host, scenario, status: 'PASS' });
      } catch (error) {
        results.push({ host, scenario, status: 'FAIL', error: error.message.slice(0, 800) });
        await page.screenshot({ path: path.join(output, `${host}-${scenario}.png`) }).catch(() => {});
      } finally { await context.close(); }
      console.log(JSON.stringify(results.at(-1)));
    }
  }
} finally { await browser.close(); }
const summary = { testedAt: new Date().toISOString(), scope: 'intercepted UI fixtures; no live data changes',
  passed: results.filter(result => result.status === 'PASS').length, failed: results.filter(result => result.status === 'FAIL').length, results };
await writeFile(path.join(output, process.argv.includes('--live') ? 'hosted.json' : 'local.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }));
if (summary.failed) process.exitCode = 1;
