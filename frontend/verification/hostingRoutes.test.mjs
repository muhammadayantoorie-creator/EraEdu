import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const fallback = await readFile(new URL('../public/404.html', import.meta.url), 'utf8');
const script = html => html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];

for (const path of [
  '/EraEdu/dashboard/student',
  '/EraEdu/login?returnTo=%2Fdashboard%2Fstudent&notice=expired#sign-in',
  '/EraEdu/quiz/results/attempt-id?view=details&filter=tab%26focus',
]) {
  test(`Pages fallback restores ${path} without duplicating the repository path or losing query/hash`, () => {
    const initial = new URL(path, 'https://owner.github.io');
    let redirect;
    runInNewContext(script(fallback), { window: { location: {
      pathname: initial.pathname, search: initial.search, hash: initial.hash,
      replace: value => { redirect = value; },
    } } });
    const redirected = new URL(redirect, initial);
    assert.equal(redirected.pathname, '/EraEdu/');
    let restored;
    const location = { pathname: redirected.pathname, search: redirected.search, hash: redirected.hash };
    runInNewContext(script(page), { window: { location, history: {
      replaceState: (_state, _title, value) => { restored = value; },
    } } });
    assert.equal(restored, path);
  });
}
test('ordinary Vercel and Pages URLs do not trigger fallback restoration', () => {
  for (const path of ['/login', '/EraEdu/login?notice=expired', '/?plan=teacher']) {
    const location = new URL(path, 'https://school.test');
    runInNewContext(script(page), { window: { location, history: {
      replaceState: () => assert.fail('Unexpected route rewrite'),
    } } });
  }
});
