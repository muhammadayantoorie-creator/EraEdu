import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExamSaveSession } from '../src/services/examSaveSession.ts';

const draft = { title: 'NLP', questions: [{ text: 'Explain', options: [] }] };
function session() { let sequence = 0; return new ExamSaveSession(() => `request-${++sequence}`); }

test('rapid clicks and Enter submit the pending draft once', async () => {
  const form = session(); let release; let writes = 0;
  const first = form.submit(draft, true, async () => { writes++; await new Promise(resolve => { release = resolve; }); });
  assert.equal(form.isSaving, true);
  for (let click = 0; click < 3; click++) assert.deepEqual(await form.submit(draft, true, async () => { writes++; }), { started: false });
  release(); await first;
  assert.equal(writes, 1); assert.equal(form.isSaving, false);
});

test('a lost response leaves the draft retryable with the same operation key', async () => {
  const form = session(); const keys = [];
  await assert.rejects(form.submit(draft, true, async key => { keys.push(key); throw new Error('response lost'); }));
  assert.equal(form.isSaving, false);
  await form.submit(draft, true, async key => keys.push(key));
  assert.deepEqual(keys, ['request-1', 'request-1']);
});

test('an edited draft and an explicitly reopened form each get a new key', async () => {
  const form = session(); const keys = [];
  await form.submit(draft, true, async key => keys.push(key));
  await form.submit({ ...draft, title: 'Changed' }, true, async key => keys.push(key));
  form.reset();
  await form.submit(draft, true, async key => keys.push(key));
  assert.deepEqual(keys, ['request-1', 'request-2', 'request-3']);
});

test('short-answer and MCQ payloads retain separate create operations', async () => {
  const form = session(); const keys = [];
  await form.submit(draft, true, async key => keys.push(key));
  await form.submit({ ...draft, questions: [{ text: 'Pick', options: ['A', 'B'] }] }, true, async key => keys.push(key));
  assert.deepEqual(keys, ['request-1', 'request-2']);
});

test('editing also prevents simultaneous writes and never issues a create key', async () => {
  const form = session(); let release; const keys = [];
  const edit = form.submit(draft, false, async key => { keys.push(key); await new Promise(resolve => { release = resolve; }); });
  assert.equal((await form.submit(draft, false, async key => keys.push(key))).started, false);
  release(); await edit;
  assert.deepEqual(keys, [undefined]);
});
