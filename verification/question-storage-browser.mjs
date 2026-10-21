// Actual frontend form with all API calls intercepted. No live questions added.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright-core');
const targets = process.argv.includes('--live')
  ? [['vercel', 'https://era-edu-mtoc.vercel.app'], ['pages', 'https://muhammadayantoorie-creator.github.io/EraEdu']]
  : [['local', 'http://127.0.0.1:4173']];
const output = path.resolve('backend/coverage/question-storage-browser');
await mkdir(output, { recursive: true });
const teacher = { _id: 'teacher-fixture', name: 'Teacher', email: 'teacher@example.invalid', role: 'teacher' };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const results = [];
try {
  for (const [host, base] of targets) {
    for (const answer of [0, 2, 'shortAnswer']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const writes = [], unknown = [], errors = [];
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (!url.pathname.startsWith('/api/') && url.hostname !== 'era-edu.vercel.app') return route.continue();
        const endpoint = url.pathname.replace(/^\/api/, '');
        const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
        if (req.method() === 'GET' && endpoint === '/auth/me') return reply(200, { success: true, data: teacher });
        if (req.method() === 'POST' && endpoint === '/questions') {
          writes.push(req.postDataJSON());
          return reply(201, { success: true, data: { id: 'fixture-question' } });
        }
        unknown.push(`${req.method()} ${endpoint}`);
        return reply(500, { success: false, message: 'Unexpected fixture request' });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(base + '/fixture-previous', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.goto(base + '/dashboard/teacher/courses/course-fixture/topics/topic-fixture/create-question', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.getByPlaceholder('Enter your question here...').fill('Fixture question');
        await page.getByPlaceholder('Explain why this is the correct answer...').fill('Fixture explanation');
        if (answer === 'shortAnswer') {
          await page.getByRole('radio', { name: 'Short Answer', exact: true }).check();
          await page.getByPlaceholder('e.g., photosynthesis, cellular respiration, ATP').fill('Alpha, Beta');
        } else {
          for (let index = 0; index < 4; index++) await page.getByPlaceholder(`Option ${String.fromCharCode(65 + index)}`, { exact: true }).fill(`Answer ${index + 1}`);
          await page.locator('input[name="correctAnswer"]').nth(answer).check();
        }
        await Promise.all([
          page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/questions')),
          page.getByRole('button', { name: 'Save Question', exact: true }).click(),
        ]);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].topicId, 'topic-fixture');
        assert.equal(writes[0].explanation, 'Fixture explanation');
        if (answer === 'shortAnswer') assert.deepEqual(writes[0].correctAnswers, ['Alpha', 'Beta']);
        else { assert.equal(writes[0].correctAnswer, answer); assert.equal(typeof writes[0].correctAnswer, 'number'); }
        assert.deepEqual(unknown, []);
        assert.deepEqual(errors, []);
        results.push({ host, answer, status: 'PASS' });
      } catch (error) {
        results.push({ host, answer, status: 'FAIL', error: error.message.slice(0, 800) });
        await page.screenshot({ path: path.join(output, `${host}-${answer}.png`) }).catch(() => {});
      } finally { await context.close(); }
      console.log(JSON.stringify(results.at(-1)));
    }
  }
} finally { await browser.close(); }
const summary = { scope: 'intercepted UI fixtures; no live database writes', results,
  passed: results.filter(result => result.status === 'PASS').length, failed: results.filter(result => result.status === 'FAIL').length };
await writeFile(path.join(output, process.argv.includes('--live') ? 'hosted.json' : 'local.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed }));
if (summary.failed) process.exitCode = 1;
