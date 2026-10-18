import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFacts } from '../scripts/evaluation-score.mjs';

test('评估分别记录已知错误、遗漏与未知虚构，不以整体通过率掩盖问题', () => {
  const result = scoreFacts(
    { title:'正确名称', time:'明天 14:00', location:'示例地址', registration:null },
    { title:{value:'错误名称'}, time:{value:'明天14:00'}, location:{value:null}, registration:{value:'编造报名地址'} },
  );
  assert.deepEqual(result.counts, { 'known-match':1, 'known-mismatch':1, 'omitted-known':1, 'unknown-preserved':0, 'invented-known':1 });
  assert.equal(result.results.length, 4);
});
