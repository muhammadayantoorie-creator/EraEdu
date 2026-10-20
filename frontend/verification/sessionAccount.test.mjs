import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

// Exercise the actual Axios interceptors and Zustand store with an in-memory
// adapter. No cookies, accounts, HTTP requests or database writes are involved.
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => server.close());
const { default: api, SESSION_EXPIRED_EVENT } = await server.ssrLoadModule('/src/services/api.ts');
const { useAuthStore } = await server.ssrLoadModule('/src/store/authStore.ts');
globalThis.window = new EventTarget();
window.addEventListener(SESSION_EXPIRED_EVENT, event => useAuthStore.getState().expireSession(event.detail.code));
const teacher = { _id: 'teacher-one', role: 'teacher', name: 'Fixture Teacher' };
const success = config => Promise.resolve({ status: 200, data: { data: teacher }, headers: {}, config });
beforeEach(async () => {
  api.defaults.adapter = success;
  await api.get('/auth/me'); // A successful session lookup re-arms expiry notices.
  useAuthStore.setState({ user: teacher, isAuthenticated: true, sessionNotice: null });
});

test('course and exam creates/edits carry the displayed account identity', async () => {
  const requests = [];
  api.defaults.adapter = config => { requests.push(config); return success(config); };
  for (const [method, url] of [['post', '/courses'], ['put', '/courses/course-one'],
    ['post', '/quizzes'], ['put', '/quizzes/exam-one']]) await api[method](url, { title: 'Fixture draft' });
  assert.equal(requests.length, 4);
  assert.ok(requests.every(config => config.headers.get('X-EraEdu-Account') === teacher._id));
});

test('new sign-in and sign-out requests are not tied to the old account', async () => {
  const requests = [];
  api.defaults.adapter = config => { requests.push(config); return success(config); };
  await api.post('/auth/login', {});
  await api.post('/auth/logout');
  assert.ok(requests.every(config => !config.headers.has('X-EraEdu-Account')));
});

test('a replaced session clears the stale teacher view with an explicit notice and never retries the write', async () => {
  let writes = 0;
  api.defaults.adapter = async config => {
    writes++;
    throw { config, response: { status: 401, data: { error: { code: 'SESSION_ACCOUNT_CHANGED' } } } };
  };
  await assert.rejects(api.post('/courses', { title: 'Stale teacher draft' }));
  assert.equal(writes, 1);
  assert.equal(useAuthStore.getState().user, null);
  assert.equal(useAuthStore.getState().isAuthenticated, false);
  assert.match(useAuthStore.getState().sessionNotice, /Another tab changed/);
});

test('a genuine role denial preserves the session and its specific error for display', async () => {
  api.defaults.adapter = async config => {
    throw { config, response: { status: 403, data: { error: { code: 'ROLE_FORBIDDEN' } } } };
  };
  await assert.rejects(api.post('/admin/courses', {}));
  assert.equal(useAuthStore.getState().isAuthenticated, true);
  assert.equal(useAuthStore.getState().user._id, teacher._id);
});

test('temporary authorization lookup failures do not discard the teacher session', async () => {
  api.defaults.adapter = async config => {
    throw { config, response: { status: 503, data: { error: { code: 'ACCOUNT_STATE_UNAVAILABLE' } } } };
  };
  await assert.rejects(api.put('/quizzes/exam-one', {}));
  assert.equal(useAuthStore.getState().isAuthenticated, true);
});
