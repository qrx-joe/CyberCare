import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFacts, requiresReview } from '../scripts/evaluation-score.mjs';

test('评估分别记录已知错误、遗漏与未知虚构，不以整体通过率掩盖问题', () => {
  const result = scoreFacts(
    { title:'正确名称', time:'明天 14:00', location:'示例地址', registration:null },
    { title:{value:'错误名称'}, time:{value:'明天14:00'}, location:{value:null}, registration:{value:'编造报名地址'} },
  );
  assert.deepEqual(result.counts, { 'known-match':1, 'known-mismatch':1, 'omitted-known':1, 'unknown-preserved':0, 'invented-known':1 });
  assert.equal(result.results.length, 4);
});

test('已知遗漏、错配或未知填值均立即进入复核；匹配和未知保留不停止本批', () => {
  const expected = { title:'合成名称', time:'明天 14:00', location:'示例活动室', registration:null };
  const facts = { title:{value:'合成名称'}, time:{value:'明天14:00'}, location:{value:'示例活动室'}, registration:{value:null} };
  assert.equal(requiresReview(scoreFacts(expected, facts)), false);
  for (const [field,value] of [['title',null],['time','2026年10月20日14:00'],['registration','编造入口']]) {
    assert.equal(requiresReview(scoreFacts(expected, { ...facts, [field]:{value} })), true);
  }
});
