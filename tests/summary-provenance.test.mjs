import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTaskService} from '../dist/service.js';
import {createProvider} from '../dist/provider.js';
import {fromTranscript,SAMPLE_TEXT,renderHtml,renderText,editTask,hash} from '../dist/domain.js';
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==';
const invented='虚构协会主办、另一机构赞助本次活动。';
const summary=task=>renderText(task).split('\n\n内容概述\n')[1].split('\n\n图像说明\n')[0];
async function fixture(work){
 const original=fromTranscript(SAMPLE_TEXT);original.summary=invented;
 const disabled=createProvider({MODEL_REQUEST_LIMIT:'0'});
 const service=createTaskService({...disabled,info:()=>({...disabled.info(),live:true}),async extract(){return{extraction:structuredClone(original),provider:{name:'合成 Provider 夹具',model:null,promptVersion:'synthetic',requests:0,elapsedMs:0,usage:null}};}});
 try{const task=service.create({mode:'live',permission:true,sourceNote:'开发者原创合成概述检查，不是真实模型',image:{name:'fixture.png',mime:'image/png',data:pixel}},'one','fixture');await new Promise(resolve=>setImmediate(resolve));await work(task,service,original);}finally{service.close();}
}

test('真实识别路径默认导出字段概述，模型归因原文保留但不进入阅读稿',()=>fixture(async(task,service,original)=>{
 assert.equal(task.summaryMode,'fields');assert.equal(task.extraction.summary,invented);assert.equal(service.public(task).extraction.summary,invented);
 assert.equal(renderHtml(task).includes(invented),false);assert.equal(renderText(task).includes(invented),false);
 assert.ok(summary(task).includes(task.values.title));assert.ok(summary(task).includes('报名方式：未知'));assert.ok(summary(task).includes('四项'));
 assert.deepEqual(task.extraction,original);
}));

test('字段修订后模板随同版本变化并使旧检测失效，不改写模型原概述',()=>fixture(async(task,_service,original)=>{
 const before=renderHtml(task);task.audit={revision:1,htmlHash:hash(before),at:'test',engine:'synthetic',violations:[],incomplete:[],passes:0};
 editTask(task,1,{...task.values,location:'合成新场地'},'对照合成答案核实场地');
 assert.equal(task.revision,2);assert.equal(task.audit,undefined);assert.ok(summary(task).includes('合成新场地'));assert.equal(summary(task).includes('示例社区活动室二楼'),false);
 assert.notEqual(hash(renderHtml(task)),hash(before));assert.deepEqual(task.extraction,original);
}));

test('人工概述须明确选用，切回字段模式不会丢失已保存人工文字，来源变更可追溯',()=>fixture(async(task)=>{
 const content={...task.extraction,summary:'人工核对：合成阅读会免费。'};
 editTask(task,1,task.values,'对照合成材料明确保留人工概述',content,'custom');assert.equal(task.summaryMode,'custom');assert.equal(summary(task),content.summary);
 editTask(task,2,task.values,'改回字段概述，不删除人工草稿',undefined,'fields');assert.equal(task.summaryMode,'fields');assert.equal(task.reviewedContent.summary,content.summary);assert.notEqual(summary(task),content.summary);
 editTask(task,3,task.values,'重新采用已保存的人工概述',undefined,'custom');assert.equal(summary(task),content.summary);
 assert.deepEqual(task.summarySourceChanges.map(change=>[change.before,change.after]),[['fields','custom'],['custom','fields'],['fields','custom']]);
 assert.ok(task.summarySourceChanges.every(change=>change.reason));assert.equal(task.extraction.summary,invented);
}));

test('旧编辑请求和人工路径保持可用，旧客户端明确改动概述时不吞掉文字',()=>fixture(async(task)=>{
 editTask(task,1,task.values,'旧客户端只修改字段',{...task.extraction});assert.equal(task.summaryMode,'fields');
 editTask(task,2,task.values,'旧客户端明确修订概述',{...task.extraction,summary:'旧客户端人工核对文字'});assert.equal(task.summaryMode,'custom');assert.equal(summary(task),'旧客户端人工核对文字');
 const service=createTaskService();try{const old=service.create({mode:'sample',permission:true,sourceNote:'合成旧路径'},'one','sample');await new Promise(resolve=>setImmediate(resolve));assert.equal(Object.hasOwn(old,'summaryMode'),false);assert.equal(summary(old),old.extraction.summary);}finally{service.close();}
}));

test('字段模板不套用人工1500字限制或静默截断，仍按文本转义',()=>fixture(async(task)=>{
 const value='<script>'+ 'x'.repeat(480);
 editTask(task,1,{title:value,time:value,location:value,registration:value},'合成长字段与纯文本边界');
 assert.ok(summary(task).length>1500);for(const line of summary(task).split('\n').filter(line=>line.includes('：')))assert.ok(line.includes(value));
 assert.equal(renderHtml(task).includes('<script>'),false);assert.ok(renderHtml(task).includes('&lt;script&gt;'));assert.equal(task.extraction.summary,invented);
}));

test('不合法概述来源在修改任务前拒绝',()=>fixture(async(task)=>{
 const before=structuredClone({revision:task.revision,values:task.values,changes:task.changes});
 assert.throws(()=>editTask(task,1,{...task.values,title:'不应写入'},'合成非法来源',undefined,'unsupported'));
 assert.deepEqual({revision:task.revision,values:task.values,changes:task.changes},before);
}));
