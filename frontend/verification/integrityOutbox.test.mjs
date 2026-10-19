import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IntegrityOutbox } from '../src/services/integrityOutbox.ts';
function storage() {
  const entries = new Map();
  return { get length() { return entries.size; }, key: i => [...entries.keys()][i] ?? null,
    getItem: k => entries.get(k) ?? null, setItem: (k,v) => entries.set(k,v), removeItem: k => entries.delete(k) };
}
const event = id => ({ attemptId: 'attempt-one', body: { event_id: id, violation_type: 'tab_change' } });
test('offline beyond three failures survives reload and retries the original ID once acknowledged', async () => {
  const disk = storage(); const first = new IntegrityOutbox(disk,'student'); first.enqueue(event('one'));
  for (let i = 0; i < 5; i++) await first.flush(async () => { throw new Error('offline'); }, () => true, true);
  assert.equal(first.pending().length,1);
  const refreshed = new IntegrityOutbox(disk,'student'); const sent = [];
  await refreshed.flush(async item => { sent.push(item); });
  assert.deepEqual(sent,[event('one')]); assert.equal(refreshed.pending().length,0);
});
test('two tabs enqueue distinct events without overwriting; duplicate enqueue preserves identity', async () => {
  const disk = storage(); const a = new IntegrityOutbox(disk,'student'); const b = new IntegrityOutbox(disk,'student');
  a.enqueue(event('one')); b.enqueue(event('two')); b.enqueue(event('one'));
  assert.equal(a.pending().length,2);
  const ids = new Set(); await Promise.all([a.flush(async item => { ids.add(item.body.event_id); }), b.flush(async item => { ids.add(item.body.event_id); })]);
  assert.deepEqual([...ids].sort(),['one','two']); assert.equal(a.pending().length,0);
});
test('other accounts never enumerate or send queued reports and logout stops subsequent writes', async () => {
  const disk = storage(); const a = new IntegrityOutbox(disk,'student-a'); const b = new IntegrityOutbox(disk,'student-b');
  a.enqueue(event('one')); a.enqueue(event('two')); assert.deepEqual(b.pending(),[]);
  let active = true; let sent = 0;
  await a.flush(async () => { sent++; active = false; }, () => active);
  assert.equal(sent,1); assert.equal(a.pending().length,1);
});
test('backoff prevents tight retries; a failed or unauthorized write is never acknowledged locally', async () => {
  const box = new IntegrityOutbox(storage(),'student'); box.enqueue(event('one')); let calls = 0;
  const send = async () => { calls++; throw new Error('network'); };
  await box.flush(send,()=>true,false,1000); await box.flush(send,()=>true,false,1001);
  assert.equal(calls,1); assert.equal(box.pending().length,1);
  await box.flush(async () => { throw { response: { status: 403 } }; },()=>true,true,2000);
  await box.flush(send,()=>true,false,9999999); assert.equal(calls,1);
});
test('completion/route changes do not delete an unacknowledged report; late delivery retains its ID', async () => {
  const disk = storage(); const page = new IntegrityOutbox(disk,'student'); page.enqueue(event('one'));
  const results = new IntegrityOutbox(disk,'student');
  await results.flush(async item => assert.equal(item.body.event_id,'one'));
  assert.equal(results.pending().length,0);
});
test('unavailable local storage fails explicitly instead of pretending a report was queued', () => {
  const disk = storage(); disk.setItem = () => { throw new Error('quota'); };
  const box = new IntegrityOutbox(disk,'student'); assert.throws(()=>box.enqueue(event('one')),/quota/);
});
