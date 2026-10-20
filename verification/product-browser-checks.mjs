// Public, signed-out checks only. Uses a fresh browser profile and never submits
// registration, password-reset, payment or authenticated mutation requests.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
if (!process.argv.includes('--live')) throw new Error('Pass --live to check the two public EraEdu sites.');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright-core');
const output = path.resolve('backend/coverage/product-browser');
await mkdir(output, { recursive: true });
const results = [];
const filter = process.argv.find(value => value.startsWith('--only='))?.slice(7);
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  for (const [host, base] of [['vercel', 'https://era-edu-mtoc.vercel.app'],
    ['pages', 'https://muhammadayantoorie-creator.github.io/EraEdu']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    async function check(name, action) {
      if (filter && !name.includes(filter)) return;
      try { await action(); results.push({ host, name, status: 'PASS' }); }
      catch (error) {
        results.push({ host, name, status: 'FAIL', error: error.message.slice(0, 500) });
        await page.screenshot({ path: path.join(output, `${host}-${name.replace(/[^a-z0-9]/gi, '-')}.png`) }).catch(() => {});
      }
      console.log(JSON.stringify(results.at(-1)));
    }
    async function navigate(route) { await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
    await check('desktop homepage renders', async () => {
      await navigate('/'); await page.locator('h1').first().waitFor({ state: 'visible' });
      assert.ok((await page.locator('h1').first().innerText()).trim());
      await page.screenshot({ path: path.join(output, `${host}-desktop.png`) });
    });
    await check('login renders and empty submit validates locally', async () => {
      await navigate('/login'); await page.getByRole('heading', { name: 'Sign in to your account' }).waitFor();
      await page.getByLabel('Email address').waitFor(); await page.getByLabel('Password', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByText('Email is required', { exact: true }).waitFor();
      await page.getByText('Password is required', { exact: true }).waitFor();
    });
    await check('registration switches student and teacher fields', async () => {
      await navigate('/register'); await page.getByRole('heading', { name: 'Create your account' }).waitFor();
      await page.getByText('Upload Profile Picture', { exact: true }).waitFor();
      await page.locator('select[name="role"]').selectOption('teacher');
      assert.equal(await page.getByText('Upload Profile Picture', { exact: true }).count(), 0);
      await page.locator('select[name="role"]').selectOption('student');
      await page.getByText('Upload Profile Picture', { exact: true }).waitFor();
    });
    await check('forgot password and missing reset token render', async () => {
      await navigate('/forgot-password'); await page.getByRole('heading', { name: 'Forgot your password?' }).waitFor();
      await navigate('/reset-password'); await page.getByRole('heading', { name: 'Invalid reset link' }).waitFor();
    });
    for (const [route, heading] of [['/privacy', /Privacy/], ['/terms', /Terms/], ['/contact', 'Contact']]) {
      await check(`${route} page renders`, async () => { await navigate(route); await page.getByRole('heading', { level: 1, name: heading }).waitFor(); });
    }
    for (const route of ['/dashboard/student', '/dashboard/teacher/submissions', '/dashboard/admin', '/quiz/access-by-code']) {
      await check(`signed-out ${route} redirects to login`, async () => {
        await navigate(route); await page.getByRole('heading', { name: 'Sign in to your account' }).waitFor();
        assert.equal(new URL(page.url()).pathname, new URL(base).pathname.replace(/\/$/, '') + '/login');
      });
    }
    await check('unknown route shows the product not-found page', async () => {
      await navigate('/product-test-route-does-not-exist'); await page.getByRole('heading', { name: 'Page not found' }).waitFor();
    });
    await check('mobile navigation opens and reaches login', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await navigate('/');
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.locator('#mobile-navigation').getByRole('link', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Sign in to your account' }).waitFor();
      const width = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(width.content <= width.viewport + 1, JSON.stringify(width));
      await page.screenshot({ path: path.join(output, `${host}-mobile-login.png`) });
    });
    await check('tablet menu remains visible below the desktop breakpoint', async () => {
      await page.setViewportSize({ width: 900, height: 1000 }); await navigate('/');
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.locator('#mobile-navigation').getByRole('link', { name: 'Features', exact: true }).waitFor({ state: 'visible' });
    });
    await check('no uncaught application exceptions', async () => { assert.deepEqual(errors, []); });
    await context.close();
  }
} finally { await browser.close(); }
const summary = { testedAt: new Date().toISOString(), scope: 'public signed-out browser checks; no authenticated workflows',
  passed: results.filter(result => result.status === 'PASS').length, failed: results.filter(result => result.status === 'FAIL').length, results };
await writeFile(path.join(output, filter ? `results-${filter.replace(/[^a-z0-9]/gi, '-')}.json` : 'results.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: summary.passed, failed: summary.failed, evidenceDirectory: output }));
if (summary.failed) process.exitCode = 1;
