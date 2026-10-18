import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluationPlan } from '../scripts/evaluation-plan.mjs';
import { posterCases } from './fixtures/poster-cases.mjs';

test('评估默认范围保持兼容，指定样本按声明顺序执行', () => {
  const ids = plan => plan.samples.map(sample => sample.id);
  assert.deepEqual(ids(evaluationPlan([], posterCases)), posterCases.map(sample => sample.id));
  assert.deepEqual(ids(evaluationPlan(['--live','--limit=1'], posterCases)), ['complete']);
  const selected = evaluationPlan(['--live','--limit=3','--cases=qr-unknown,relative-date,instruction-in-image'], posterCases);
  assert.equal(selected.limit, 3);
  assert.deepEqual(ids(selected), ['qr-unknown','relative-date','instruction-in-image']);
  assert.deepEqual(ids(evaluationPlan(['--cases=relative-date,qr-unknown'], posterCases)), ['relative-date','qr-unknown']);
});

test('未知、空白或重复样本与重复参数在调用前拒绝，不能悄悄截断或扩大预算', () => {
  for (const args of [
    ['--live','--limit=1','--cases=qr-unknown,relative-date'],
    ['--live','--cases=complete,missing-registration,missing-year,qr-unknown'],
    ['--cases=qr-unknown,qr-unknown'], ['--cases='], ['--cases=qr-unknown,'], ['--cases=not-a-case'],
    ['--live','--live'], ['--limit=1','--limit=3'], ['--cases=complete','--cases=qr-unknown'],
    ['--limit=0'], ['--limit=4'], ['--limit=NaN'], ['--unknown'],
  ]) assert.throws(() => evaluationPlan(args, posterCases), Error, JSON.stringify(args));
});
