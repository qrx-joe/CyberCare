import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExtraction } from '../dist/domain.js';

function extraction(original, value, evidence = value) {
  const empty = () => ({ value:null, evidence:'' });
  return { original,summary:'合成引用定位回归',description:'开发者原创文本，不是真实模型输出',
    facts:{ title:empty(),time:empty(),location:{value,evidence},registration:empty() },uncertainties:[] };
}

test('空白布局差异定位回原文，值与依据仍为逐字子串且不丢双行地点', () => {
  for (const [span,flat] of [
    ['示例共享空間 | 南館\r\n示例市北路 1 號 4 樓','示例共享空間 | 南館 示例市北路 1 號 4 樓'],
    ['Synthetic A+B [1] | Hall\nRoad (4)\tFloor 1','Synthetic A+B [1] | Hall Road (4) Floor 1'],
  ]) {
    const original = `合成材料\n${span}\n技术检查结束`, raw = extraction(original,flat);
    const result = normalizeExtraction(raw);
    assert.equal(result.facts.location.value,span);
    assert.equal(result.facts.location.evidence,span);
    assert.equal(result.original,original);
    assert.equal(raw.facts.location.value,flat);
    assert.ok(result.original.includes(result.facts.location.evidence));
    assert.ok(result.facts.location.evidence.includes(result.facts.location.value));
    assert.ok(!result.uncertainties.some(text => text.includes('活动地点')));
  }
});

test('引用定位不容忍改数字、字词、标点或删词间空白，正则字符没有通配意义', () => {
  const original = 'North Hall | South Wing\nRoad 1 Floor 4', flat = 'North Hall | South Wing Road 1 Floor 4';
  for (const [value,evidence] of [
    [flat.replace('Road 1','Road 2'),flat.replace('Road 1','Road 2')],
    [flat.replace('North','north'),flat.replace('North','north')],
    [flat.replace('|','｜'),flat.replace('|','｜')],
    [flat.replace('North Hall','NorthHall'),flat.replace('North Hall','NorthHall')],
    ['North.*','North.*'],
    [flat.replace('Floor 4','Floor 9'),flat],
    ['North Hall','   '],
  ]) {
    const result = normalizeExtraction(extraction(original,value,evidence));
    assert.equal(result.facts.location.value,null);
    assert.equal(result.original,original);
    assert.ok(result.uncertainties.some(text => text.includes('活动地点')));
  }
});

test('原文空白跨度过长时仍遵守字段边界，不生成超过契约长度的引用和值', () => {
  for (const gap of [510,800]) {
    for (const [original,evidence] of [
      [`North${' '.repeat(gap)}Hall`,'North Hall'],
      [`North${' '.repeat(gap)}Hall\nDate: 2026-10-24\nOther Venue`,'North Hall\nOther Venue'],
    ]) {
      const result = normalizeExtraction(extraction(original,'North Hall',evidence));
      assert.equal(result.facts.location.value,null);
      assert.ok(result.facts.location.evidence.length <= 700);
      assert.ok(result.uncertainties.some(text => text.includes('长度范围')));
    }
  }
});

test('引文含多个按序出现的原文片段时，仅保留完整包含提取值的一段并说明缩窄', () => {
  for (const [original,value,evidence] of [
    ['North Hall\nDate: 2026-10-24\nNorthern Venue\nOther text','North Hall','North Hall\nNorthern Venue'],
    ['Alias\nDate: 2026-10-24\nC++ [馆]\nFooter','C++ [馆]','Alias\r\nC++ [馆]'],
  ]) {
    const raw=extraction(original,value,evidence), before=structuredClone(raw);
    const result=normalizeExtraction(raw);
    assert.equal(result.facts.location.value,value);
    assert.equal(result.facts.location.evidence,value);
    assert.equal(result.original,original);
    assert.deepEqual(raw,before);
    assert.ok(result.original.includes(result.facts.location.evidence));
    assert.ok(result.facts.location.evidence.includes(result.facts.location.value));
    assert.ok(result.uncertainties.some(text=>text.includes('不连续')));
  }
});

test('缩窄引文不能容忍伪造片段、乱序、歧义、单行改写或拼接提取值', () => {
  const original='North Hall\nDate: 2026-10-24\nSouth Hall\nNorthern Venue';
  for(const [value,evidence] of [
    ['North Hall','North Hall\nImaginary Venue'],
    ['North Hall','Northern Venue\nNorth Hall'],
    ['North Hall','North Hall\nNorth Hall'],
    ['North Hall','North Hall\nNorthern venue'],
    ['North Hall','North Hall\nNorthern Venue.'],
    ['North Hall','North Hall Northern Venue'],
    ['North Hall South Hall','North Hall\nSouth Hall'],
    ['Date: 2026-10-24','North Hall\nNorthern Venue'],
    ['North Hall','North Hall\nDate: 2026-10-25'],
  ]){
    const result=normalizeExtraction(extraction(original,value,evidence));
    assert.equal(result.facts.location.value,null);
    assert.equal(result.original,original);
  }
  assert.equal(normalizeExtraction(extraction('North Hall\nOther\nNorth Hall','North Hall','North Hall\nNorth Hall')).facts.location.value,null);
});
