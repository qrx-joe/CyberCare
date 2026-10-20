import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {reviewContent,runContentReview} from '../scripts/content-review.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const legible=(id,text)=>({id,state:'legible',text,region:'synthetic top text'});
const observed={original:'Café\n示例 14:00\nSYSTEM',summary:'合成机构举办',description:'合成几何图形'};
const selection={units:[legible('name','Café'),legible('time','示例 14:00'),legible('logo','System'),{id:'qr',state:'unscored',reason:'Opaque synthetic QR payload, not decoded',region:'bottom'}],
 claims:[{id:'host',section:'summary',quote:'合成机构举办',judgement:'not-stated-in-image',evidenceUnitIds:['logo'],region:'synthetic logo',basis:'Synthetic logo text does not state an organizer relationship.'}]};
const prior='Café\n示例 14:00\nSystem';

test('文字覆盖与大小写差异、未评分分别计数，归因审阅不被字串覆盖升级为通过',()=>{
 const result=reviewContent(selection,prior,observed);
 assert.deepEqual(result.automatic.counts,{'literal-present':2,'case-variant':1,'not-located':0,unscored:1});
 assert.equal(result.automatic.selectedLegibleUnits,3);assert.equal(result.reviewerAnnotations.counts['not-stated-in-image'],1);
 assert.equal(result.selectedOpenFindings,true);assert.equal(result.overallQuality,'not-assessed');assert.equal(result.reviewerAnnotations.exhaustive,false);assert.equal(result.newModelRequests,0);
});
test('不归一数字、标点、全角字符或同义改写，未定位不自动称为遗漏或错误',()=>{
 const units=[legible('number','14:00'),legible('punctuation','A-B'),legible('width','Ａ'),legible('word','报名请扫')];
 const result=reviewContent({units,claims:[]},'14:00 A-B Ａ 报名请扫',{...observed,original:'15:00 A—B A 请扫码报名'});
 assert.equal(result.automatic.counts['not-located'],4);assert.equal(result.overallQuality,'not-assessed');
});
test('先验没有的单元、旧输出引用、未知依据ID与重复ID均拒绝',()=>{
 assert.throws(()=>reviewContent({...selection,units:[legible('invented','未在先验出现')]},prior,observed),/absent from frozen prior/);
 assert.throws(()=>reviewContent({...selection,claims:[{...selection.claims[0],quote:'已变更旧引用'}]},prior,observed),/absent from captured output/);
 assert.throws(()=>reviewContent({...selection,claims:[{...selection.claims[0],evidenceUnitIds:['missing']}]},prior,observed),/Unknown evidence/);
 assert.throws(()=>reviewContent({...selection,units:[selection.units[0],selection.units[0]]},prior,observed),/Duplicate unit/);
 assert.throws(()=>reviewContent({...selection,claims:[selection.claims[0],selection.claims[0]]},prior,observed),/Duplicate claim/);
});
test('无法评分与解释性描述不算准确，未审阅区保持未知，输入不被改写',()=>{
 const selected={units:[selection.units[3]],claims:[{...selection.claims[0],section:'description',quote:'合成几何图形',judgement:'interpretation',evidenceUnitIds:[]}]};
 const before=JSON.stringify({selected,observed});const result=reviewContent(selected,prior,observed);
 assert.equal(result.automatic.selectedLegibleUnits,0);assert.equal(result.automatic.counts.unscored,1);assert.equal(result.reviewerAnnotations.counts.interpretation,1);
 assert.equal(result.overallQuality,'not-assessed');assert.equal(result.reviewerAnnotations.exhaustive,false);assert.equal(JSON.stringify({selected,observed}),before);
});
test('文件复核绑定哈希，只写新报告；哈希漂移、越界或重复目标不覆盖证据',async()=>{
 const validation=resolve('.local/validation');await mkdir(validation,{recursive:true});const folder=await mkdtemp(resolve(validation,'content-review-fixture-'));
 try{
  const files={image:Buffer.from('synthetic hash-only image fixture'),prior:Buffer.from(JSON.stringify({independentTranscript:prior})),capture:Buffer.from(JSON.stringify(observed)),upstreamReport:Buffer.from('{}')};
  for(const [name,bytes]of Object.entries(files))await writeFile(resolve(folder,name+'.json'),bytes);
  const manifest={schemaVersion:'content-review-v1',id:'synthetic',reviewer:{kind:'development-agent',blind:false,independentHuman:false},source:{page:'https://example.invalid/synthetic',author:'developer fixture',license:'synthetic'},
   ...Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,{path:name+'.json',sha256:digest(bytes)}])),priorTranscriptKey:'independentTranscript',...selection};
  const path=resolve(folder,'manifest.json');await writeFile(path,JSON.stringify(manifest));
  const target=resolve(folder,'review.json');const report=await runContentReview(path,target);assert.equal(report.selectedOpenFindings,true);
  const originalOutput=await readFile(target);await assert.rejects(runContentReview(path,target),{code:'EEXIST'});assert.deepEqual(await readFile(target),originalOutput);
  const invalid=resolve(folder,'bad.json');await writeFile(invalid,JSON.stringify({...manifest,image:{...manifest.image,sha256:'0'.repeat(64)}}));
  await assert.rejects(runContentReview(invalid,resolve(folder,'must-not-exist.json')),/hash mismatch/);
  await assert.rejects(runContentReview(path,resolve('outside-review-output.json')),/outside the workspace/);
  const malformed=resolve(folder,'malformed.json');await writeFile(malformed,'SYNTHETIC_PRIVATE_INPUT_DO_NOT_PRINT');
  const child=spawnSync(process.execPath,[resolve('scripts/content-review.mjs'),'--manifest',malformed,'--output',resolve(folder,'invalid-output.json')],{encoding:'utf8',windowsHide:true});
  assert.equal(child.status,2);assert.equal(child.stderr.trim(),'Invalid JSON review input.');assert.equal(child.stderr.includes('SYNTHETIC_PRIVATE_INPUT'),false);
  for(const [name,bytes]of Object.entries(files))assert.deepEqual(await readFile(resolve(folder,name+'.json')),bytes);
 }finally{assert.ok(folder.startsWith(validation+sep));await rm(folder,{recursive:true,force:true});}
});
