import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExtraction,fromTranscript,SAMPLE_TEXT,renderHtml,renderText} from '../dist/domain.js';
const empty=()=>({value:null,evidence:''});
const base=original=>({original,summary:'合成时间角色检查',description:'开发者原创文字，非模型结果',facts:{title:empty(),time:empty(),location:empty(),registration:empty()},uncertainties:[]});

test('分散的活动日期与提交截止独立定位，主字段不接受拼接且旧输入保持旧形状',()=>{
 const original='活动日期：2026年10月24日\n独立说明段落\n提交截止：2026年10月20日 23:59';
 const input={...base(original),timeReferences:[
  {kind:'event',value:'2026年10月24日',evidence:'活动日期：2026年10月24日'},
  {kind:'submission-deadline',value:'2026年10月20日 23:59',evidence:'提交截止：2026年10月20日 23:59'},
 ]};
 input.facts.time={value:'2026年10月24日\n2026年10月20日 23:59',evidence:'活动日期：2026年10月24日\n提交截止：2026年10月20日 23:59'};
 const result=normalizeExtraction(input);assert.deepEqual(result.timeReferences,input.timeReferences);assert.equal(result.facts.time.value,null);
 assert.equal(input.facts.time.value,'2026年10月24日\n2026年10月20日 23:59');
 assert.equal(Object.hasOwn(fromTranscript(SAMPLE_TEXT),'timeReferences'),false);
});

test('候选条目不接受伪造、跨段拼接、改字或过长的实际原文跨度，合法条目仍保留',()=>{
 const original='日期 A\n独立内容\n日期 B\nNo'+' '.repeat(710)+'Year';
 const result=normalizeExtraction({...base(original),timeReferences:[
  {kind:'event',value:'日期 A',evidence:'日期 A'},
  {kind:'submission-deadline',value:'日期 A\n日期 B',evidence:'日期 A\n日期 B'},
  {kind:'event',value:'日期 C',evidence:'日期 C'},
  {kind:'event',value:'日期 a',evidence:'日期 A'},
  {kind:'unknown',value:'No Year',evidence:'No Year'},
 ]});
 assert.deepEqual(result.timeReferences,[{kind:'event',value:'日期 A',evidence:'日期 A'}]);
 assert.equal(result.uncertainties.filter(text=>text.includes('时间条目')).length,4);
});

test('只归一布局空白并保留原文跨度，待核实用途不自动升级',()=>{
 const original='Label [1]+\nMay 1\t14:00';
 const result=normalizeExtraction({...base(original),timeReferences:[{kind:'unknown',value:'May 1 14:00',evidence:'Label [1]+ May 1 14:00'}]});
 assert.deepEqual(result.timeReferences,[{kind:'unknown',value:'May 1\t14:00',evidence:original}]);
 assert.ok(result.original.includes(result.timeReferences[0].evidence));assert.ok(result.timeReferences[0].evidence.includes(result.timeReferences[0].value));
});

test('条数、用途、空值及字段长度不合法时拒绝结构而不悄悄吞掉',()=>{
 const reference={kind:'event',value:'May 1',evidence:'May 1'};
 for(const timeReferences of [Array(9).fill(reference),[{...reference,kind:'guessed-year'}],[{...reference,value:''}],[{...reference,value:'x'.repeat(501)}],[{...reference,evidence:'x'.repeat(701)}],null]){
  assert.throws(()=>normalizeExtraction({...base('May 1'),timeReferences}));
 }
});

test('一条截止有年份不能掩盖另一用途缺年份，输出保留待核实且不补写',()=>{
 const extraction=fromTranscript(SAMPLE_TEXT),time='活动日期/时段：10月24日\n提交截止：2026年10月20日 23:59';
 const task={extraction,values:{title:'合成用途日期',time,location:'',registration:''},source:{mode:'manual',note:'开发者原创合成材料'}};
 for(const output of [renderHtml(task),renderText(task)]){assert.ok(output.includes('年份待核实'));assert.ok(output.includes(time));assert.equal(output.includes('活动日期/时段：2026年10月24日'),false);}
 const complete={...task,values:{...task.values,time:time.replace('10月24日','2026年10月24日')}};
 assert.equal(renderHtml(complete).includes('年份待核实'),false);
});
