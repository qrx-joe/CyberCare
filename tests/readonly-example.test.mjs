import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { loadReadonlyExample } from '../scripts/readonly-example.mjs';

// A one-pixel canvas PNG used only to test packaging, not image recognition.
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==','base64');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sample=()=>({imageFile:'fixture.png',imageSha256:hash(pixel),original:'合成示例\n2026-10-24 14:00\n示例场地\n现场登记',
  facts:{title:'合成示例',time:'2026-10-24 14:00',location:'示例场地',registration:'现场登记'},notes:['开发者合成构建检查，不是真实材料。'],recordedAt:'2026-01-01T00:00:00.000Z',
  source:{author:'Synthetic fixture',title:'Synthetic_test.png',url:'https://commons.wikimedia.org/wiki/File:Synthetic_test.png',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'}});
async function fixture(work){
  const parent=resolve('.local/validation');await mkdir(parent,{recursive:true});const root=await mkdtemp(resolve(parent,'readonly-build-'));
  try{
    const directory=resolve(root,'.local/examples');await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,'fixture.png'),pixel);
    await work(root,directory);
  }finally{assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true,force:true});}
}
test('可选示例缺失时不造数据，已有合法包只输出允许的展示字段',async()=>fixture(async(root,directory)=>{
  assert.equal(await loadReadonlyExample(root),null);
  const input=sample();await writeFile(resolve(directory,'poster-comparison.json'),JSON.stringify(input));
  const result=await loadReadonlyExample(root);
  assert.deepEqual(result.facts,input.facts);assert.equal(result.original,input.original);
  assert.equal(result.imageDataUrl,`data:image/png;base64,${pixel.toString('base64')}`);
  assert.equal(result.imageFile,undefined);assert.equal(result.imageSha256,undefined);
  assert.deepEqual(Object.keys(result).sort(),['facts','imageDataUrl','notes','original','recordedAt','source']);
}));
test('可选模型来源原样输出，格式不合法时拒绝',async()=>fixture(async(root,directory)=>{
  const provider={model:'synthetic-model',promptVersion:'synthetic-v1',manualFieldEdits:0};
  await writeFile(resolve(directory,'poster-comparison.json'),JSON.stringify({...sample(),provider}));
  assert.deepEqual((await loadReadonlyExample(root)).provider,provider);
  for(const bad of [{...provider,manualFieldEdits:5},{...provider,usage:1},{...provider,model:''}]){
    await writeFile(resolve(directory,'poster-comparison.json'),JSON.stringify({...sample(),provider:bad}));
    await assert.rejects(()=>loadReadonlyExample(root),/只读示例数据或图片无效/);
  }
}));
test('未知字段、伪造正文值和不受信任的来源链接在构建前拒绝',async()=>fixture(async(root,directory)=>{
  const inputs=[
    {...sample(),usage:{total_tokens:1}},
    {...sample(),facts:{...sample().facts,time:'2026-10-25 14:00'}},
    {...sample(),source:{...sample().source,url:'javascript:alert(1)'}},
    {...sample(),source:{...sample().source,url:'https://untrusted.example/wiki/File:test.png'}},
    {...sample(),source:{...sample().source,url:'https://dummy-test-only@commons.wikimedia.org/wiki/File:test.png'}},
    {...sample(),source:{...sample().source,url:'https://commons.wikimedia.org/wiki/File:test.png?private=dummy-test-only'}},
  ];
  for(const input of inputs){
    await writeFile(resolve(directory,'poster-comparison.json'),JSON.stringify(input));
    await assert.rejects(()=>loadReadonlyExample(root),error=>error.message==='只读示例数据或图片无效，请检查本地示例包。');
  }
}));
test('越界文件名、图片缺失和哈希差异不能成为看似已核验的源图',async()=>fixture(async(root,directory)=>{
  for(const patch of [{imageFile:'../fixture.png'},{imageFile:'missing.png'},{imageSha256:'0'.repeat(64)}]){
    await writeFile(resolve(directory,'poster-comparison.json'),JSON.stringify({...sample(),...patch}));
    await assert.rejects(()=>loadReadonlyExample(root),/只读示例数据或图片无效/);
  }
}));
test('图片类型和包体积错误不回显本地内容',async()=>fixture(async(root,directory)=>{
  const invalid=Buffer.from('dummy-test-only local content');
  await writeFile(resolve(directory,'fixture.png'),invalid);
  await writeFile(resolve(directory,'poster-comparison.json'),JSON.stringify({...sample(),imageSha256:hash(invalid)}));
  await assert.rejects(()=>loadReadonlyExample(root),error=>!error.message.includes('dummy-test-only')&&error.message.includes('只读示例数据或图片无效'));
  await writeFile(resolve(directory,'poster-comparison.json'),' '.repeat(256*1024+1));
  await assert.rejects(()=>loadReadonlyExample(root),/只读示例数据或图片无效/);
}));
