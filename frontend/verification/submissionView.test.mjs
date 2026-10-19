import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasTeacherGrade, submissionErrorMessage } from '../src/services/submissionView.ts';

test('SQL null and absent grades are pending while a reviewed zero is graded', () => {
  const rows = [{ grade: null }, {}, { grade: 0 }, { grade: 33 }];
  assert.deepEqual(rows.filter(row => !hasTeacherGrade(row.grade)), [{ grade: null }, {}]);
  assert.deepEqual(rows.filter(row => hasTeacherGrade(row.grade)), [{ grade: 0 }, { grade: 33 }]);
});
test('malformed and nonfinite grades do not masquerade as completed reviews', () => {
  for (const grade of ['0', '', false, NaN, Infinity, {}, []]) assert.equal(hasTeacherGrade(grade), false);
});
test('the actual operational response is shown when loading fails', () => {
  const message = 'Submission monitoring records could not be loaded. Please retry or contact an administrator.';
  assert.equal(submissionErrorMessage({ response: { data: { error: { message } } } }, 'Fallback'), message);
  assert.equal(submissionErrorMessage({ response: { data: { message: 'Request unavailable' } } }, 'Fallback'), 'Request unavailable');
});
test('unknown network/internal failures and malformed responses use the safe fallback', () => {
  for (const error of [new Error('private internals'), undefined, null, {}, { response: { data: '<html>error</html>' } },
    { response: { data: { error: { message: {} } } } }, { response: { data: { message: 'x'.repeat(1001) } } }]) {
    assert.equal(submissionErrorMessage(error, 'Please retry'), 'Please retry');
  }
});
