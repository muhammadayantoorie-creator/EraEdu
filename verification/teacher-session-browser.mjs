// Fixture-driven UI checks only: every API request is intercepted. These do not
// establish that a real signed-in account can write to the deployed database.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright-core');
const targets = process.argv.includes('--live')
  ? [['vercel', 'https://era-edu-mtoc.vercel.app'], ['pages', 'https://muhammadayantoorie-creator.github.io/EraEdu']]
  : [['local', 'http://127.0.0.1:4173']];
const output = path.resolve('backend/coverage/teacher-session-browser');
await mkdir(output, { recursive: true });
const teacher = { _id: 'teacher-one', name: 'Fixture Teacher', email: 'teacher@example.invalid', role: 'teacher' };
const course = { _id: 'course-one', title: 'Fixture Course', description: 'Fixture course', category: 'Testing',
  difficulty: 'Beginner', createdBy: teacher._id, topics: [], enrollmentCount: 0, isPublished: false };
const exam = { _id: 'exam-one', title: 'Fixture Exam', description: 'Fixture exam', courseId: course._id,
  courseTitle: course.title, accessCode: '0000', timeLimit: 3, cameraMonitoring: false, createdAt: '2026-10-20T00:00:00Z',
  questions: [{ text: 'Fixture question', options: ['A', 'B', 'C', 'D'], correctAnswer: 0, difficulty: 'Medium', timeLimit: 60 },
    { text: 'Fixture short answer', options: [], correctAnswer: -1, questionType: 'shortAnswer', answerText: 'Fixture answer', difficulty: 'Medium', timeLimit: 120 }] };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const results = [];
try {
  for (const [host, base] of targets) {
    for (const action of ['create-course', 'edit-course', 'create-exam', 'edit-exam']) {
      for (const outcome of ['success', 'account-changed']) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
        const writes = [], unknown = [], errors = [];
        let savedExam = structuredClone(exam);
        const otherCourse = { ...course, _id: 'course-two', title: 'Second Fixture Course' };
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url());
          if (!url.pathname.startsWith('/api/') && url.hostname !== 'era-edu.vercel.app') return route.continue();
          const endpoint = url.pathname.replace(/^\/api/, '');
          const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
          if (request.method() === 'GET') {
            const reads = { '/auth/me': teacher, '/notifications': [], '/courses/teacher/my-courses': action.endsWith('exam') ? [course, otherCourse] : [course],
              '/quizzes/teacher/my-quizzes': [savedExam], '/courses/teacher/questions': [] };
            if (endpoint in reads) return reply(200, { success: true, data: reads[endpoint] });
          } else if (['/courses', '/courses/course-one', '/quizzes', '/quizzes/exam-one'].includes(endpoint)) {
            writes.push({ method: request.method(), endpoint, account: request.headers()['x-eraedu-account'],
              idempotency: request.headers()['idempotency-key'], payload: request.postDataJSON() });
            if (outcome === 'success' && endpoint === '/quizzes/exam-one') {
              savedExam = { ...savedExam, ...request.postDataJSON(), courseTitle: otherCourse.title };
            }
            return outcome === 'success'
              ? reply(request.method() === 'POST' ? 201 : 200, { success: true, data: endpoint.startsWith('/courses') ? course : savedExam })
              : reply(401, { success: false, message: 'Your browser session changed to another account. Please sign in again before continuing.',
                error: { code: 'SESSION_ACCOUNT_CHANGED', message: 'Your browser session changed to another account. Please sign in again before continuing.' } });
          }
          unknown.push(`${request.method()} ${endpoint}`);
          return reply(500, { success: false, message: 'Unexpected fixture request' });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        page.on('pageerror', error => errors.push(error.message));
        try {
          const isCourse = action.endsWith('course'), isCreate = action.startsWith('create');
          const route = isCourse ? `/dashboard/teacher/courses${isCreate ? '/new' : ''}` : '/dashboard/teacher/quizzes';
          await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
          if (isCourse && isCreate) {
            await page.getByPlaceholder('Enter your course title').fill('Fixture New Course');
            await page.getByPlaceholder('Enter a category or choose a suggestion').fill('Testing');
          } else if (isCourse) {
            await page.getByTitle('Edit', { exact: true }).click();
            await page.getByRole('heading', { name: 'Edit Course', exact: true }).waitFor();
          } else if (isCreate) {
            await page.getByRole('button', { name: 'Create Exam', exact: true }).click();
            await page.getByPlaceholder('Enter exam title').fill('Fixture New Exam');
            await page.locator('select').filter({ has: page.locator('option[value="course-one"]') }).selectOption('course-one');
            await page.getByPlaceholder('Enter question text').fill('Fixture question');
            for (let option = 1; option <= 4; option++) await page.getByPlaceholder(`Option ${option}`, { exact: true }).fill(`Answer ${option}`);
          } else {
            await page.getByTitle('Edit', { exact: true }).click();
            await page.getByRole('button', { name: 'Edit Exam', exact: true }).click();
            await page.getByRole('heading', { name: 'Edit Exam', exact: true }).waitFor();
            await page.locator('select').filter({ has: page.locator('option[value="course-two"]') }).selectOption('course-two');
            await page.getByPlaceholder('Enter exam title').fill('Updated Fixture Exam');
            await page.getByLabel('Scheduled start date').fill('2026-10-25');
            await page.getByLabel('Scheduled start hour', { exact: true }).selectOption('9');
            await page.getByLabel('Scheduled start minute', { exact: true }).selectOption('14');
            await page.getByLabel('Scheduled start AM or PM', { exact: true }).selectOption('PM');
          }
          const submit = isCourse ? (isCreate ? 'Create Course' : 'Save Changes') : (isCreate ? 'Create Exam' : 'Update Exam');
          await page.locator('form').getByRole('button', { name: submit, exact: true }).click();
          if (outcome === 'account-changed') {
            await page.getByRole('heading', { name: 'Sign in to your account' }).waitFor();
            await page.getByText('Another tab changed your signed-in account. Please sign in again before continuing.', { exact: true }).waitFor();
          } else {
            const message = isCourse ? (isCreate ? 'Course created successfully!' : 'Course updated')
              : (isCreate ? 'Exam created successfully' : 'Exam updated successfully');
            await page.getByText(message, { exact: true }).waitFor();
            if (action === 'edit-exam') {
              await page.getByText('Updated Fixture Exam', { exact: true }).waitFor();
              await page.getByTitle('Edit', { exact: true }).click();
              await page.getByRole('button', { name: 'Edit Exam', exact: true }).click();
              await page.getByRole('heading', { name: 'Edit Exam', exact: true }).waitFor();
              assert.equal(await page.getByPlaceholder('Enter exam title').inputValue(), 'Updated Fixture Exam');
              assert.equal(await page.locator('select').filter({ has: page.locator('option[value="course-two"]') }).inputValue(), 'course-two');
              assert.equal(await page.getByLabel('Scheduled start date').inputValue(), '2026-10-25');
              assert.equal(await page.getByLabel('Scheduled start hour', { exact: true }).inputValue(), '9');
              assert.equal(await page.getByLabel('Scheduled start minute', { exact: true }).inputValue(), '14');
              assert.equal(await page.getByLabel('Scheduled start AM or PM', { exact: true }).inputValue(), 'PM');
            }
          }
          assert.equal(writes.length, 1, 'One submit must issue exactly one write');
          assert.equal(writes[0].method, isCreate ? 'POST' : 'PUT');
          assert.equal(writes[0].endpoint, `/${isCourse ? 'courses' : 'quizzes'}${isCreate ? '' : isCourse ? '/course-one' : '/exam-one'}`);
          assert.equal(writes[0].account, teacher._id);
          if (!isCourse && isCreate) assert.ok(writes[0].idempotency, 'Exam creation must retain its retry key');
          if (action === 'edit-exam') {
            assert.equal(writes[0].payload.courseId, 'course-two');
            assert.equal(writes[0].payload.title, 'Updated Fixture Exam');
            assert.deepEqual(writes[0].payload.questions, exam.questions.map(question => ({ ...question, answerText: question.answerText || '' })));
          }
          assert.deepEqual(unknown, []);
          assert.deepEqual(errors, []);
          results.push({ host, action, outcome, status: 'PASS' });
        } catch (error) {
          results.push({ host, action, outcome, status: 'FAIL', error: error.message.slice(0, 800) });
          await page.screenshot({ path: path.join(output, `${host}-${action}-${outcome}.png`) }).catch(() => {});
        } finally { await context.close(); }
        console.log(JSON.stringify(results.at(-1)));
      }
    }
  }
} finally { await browser.close(); }
const summary = { testedAt: new Date().toISOString(), scope: 'fixture-driven UI; every API request intercepted; no real signed-in account or database writes',
  passed: results.filter(result => result.status === 'PASS').length, failed: results.filter(result => result.status === 'FAIL').length, results };
await writeFile(path.join(output, process.argv.includes('--live') ? 'live-fixtures.json' : 'local-fixtures.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }));
if (summary.failed) process.exitCode = 1;
