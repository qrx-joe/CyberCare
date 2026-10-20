import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../dist/domain.js';
import {createTaskService} from '../dist/service.js';
import {createProvider} from '../dist/provider.js';

const original='活动名称：合成正文核对\n活动时间：2026年10月24日14:00\n活动地点：示例活动室二楼';
async function fixture(work,text=original){
 const service=createTaskService(createProvider({MODEL_REQUEST_LIMIT:'0'}));
 try{const task=service.create({mode:'manual',permission:true,sourceNote:'开发者原创合成字段与正文对照，非真实活动',text},'one','one');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(task.status,'needs_review');await work(task,service);
 }finally{service.close();}
}

test('地点已改为一楼而正文仍保留二楼时，API与实际阅读稿带具体对照及依据',()=>fixture((task,service)=>{
 assert.equal(typeof domain.fieldBodyReview,'function');
 const before=domain.renderHtml(task);
 domain.editTask(task,1,{...task.values,location:'示例活动室一楼'},'对照合成答案更正地点');
 const expected=[{field:'location',kind:'not-located',current:'示例活动室一楼',previous:'示例活动室二楼',reason:'对照合成答案更正地点'}];
 assert.deepEqual(domain.fieldBodyReview(task),expected);assert.deepEqual(service.public(task).bodyReview,expected);
 assert.equal(Object.hasOwn(task,'bodyReview'),false);assert.equal(task.extraction.original,original);assert.equal(task.reviewedContent,undefined);
 const html=domain.renderHtml(task),text=domain.renderText(task);
 for(const contents of [html,text])for(const value of ['字段修订与正文对照','示例活动室一楼','示例活动室二楼','对照合成答案更正地点'])assert.ok(contents.includes(value));
 assert.notEqual(html,before);task.audit={revision:2,htmlHash:domain.hash(html),at:'synthetic',engine:'test fixture',violations:[],incomplete:[],passes:0};
 domain.confirmTask(task,2);assert.equal(domain.hash(domain.renderHtml(task)),task.audit.htmlHash);
}));

test('修正正文后提示消失，旧检测失效且原始提取与修订记录保持完整',()=>fixture((task,service)=>{
 domain.editTask(task,1,{...task.values,location:'示例活动室一楼'},'合成地点更正');
 task.audit={revision:2,htmlHash:domain.hash(domain.renderHtml(task)),at:'synthetic',engine:'test fixture',violations:[],incomplete:[],passes:0};
 domain.editTask(task,2,task.values,'同步合成正文',{...task.extraction,original:original.replace('二楼','一楼')});
 assert.deepEqual(domain.fieldBodyReview(task),[]);assert.equal(Object.hasOwn(service.public(task),'bodyReview'),false);assert.equal(task.audit,undefined);
 assert.equal(task.extraction.original,original);assert.equal(task.contentChanges[0].before,original);assert.equal(task.changes[0].before,'示例活动室二楼');
 assert.equal(domain.renderHtml(task).includes('字段修订与正文对照'),false);
}));

test('清空为未知且正文仍含此前值时说明保留，不擅自恢复字段或删除文字',()=>fixture(task=>{
 domain.editTask(task,1,{...task.values,location:''},'场地无法核实，合成边界检查');
 assert.deepEqual(domain.fieldBodyReview(task),[{field:'location',kind:'unknown-retained',current:'',previous:'示例活动室二楼',reason:'场地无法核实，合成边界检查'}]);
 assert.equal(task.values.location,'');assert.equal(task.extraction.original,original);assert.ok(domain.renderText(task).includes('未知，请向活动方核实'));
 domain.editTask(task,2,task.values,'删除已知不适用的合成旧地点',{...task.extraction,original:original.replace('\n活动地点：示例活动室二楼','')});
 assert.deepEqual(domain.fieldBodyReview(task),[]);
}));

test('仅修改正文也会提示失去定位的已知字段，未改任务保持原输出',()=>fixture((task,service)=>{
 assert.deepEqual(domain.fieldBodyReview(task),[]);assert.equal(Object.hasOwn(service.public(task),'bodyReview'),false);
 domain.editTask(task,1,task.values,'合成正文改写，保留差异供核对',{...task.extraction,original:original.replace('示例活动室二楼','场地另行通知')});
 assert.deepEqual(domain.fieldBodyReview(task),[{field:'location',kind:'not-located',current:'示例活动室二楼',reason:'合成正文改写，保留差异供核对'}]);
}));

test('NFC与布局空白及显式分散时间条目可定位，不把定位当作用途或年份确认',()=>fixture(task=>{
 domain.editTask(task,1,{...task.values,title:'Café',time:'活动日期/时段：10月24日\n提交截止：2026年10月20日 23:59'},'合成排版与用途检查');
 assert.deepEqual(domain.fieldBodyReview(task),[]);assert.ok(domain.renderText(task).includes('年份待核实'));
 domain.editTask(task,2,{...task.values,time:'活动日期/时段：10月25日\n提交截止：2026年10月20日 23:59'},'合成日期文字不一致');
 assert.equal(domain.fieldBodyReview(task)[0].field,'time');
},'活动名称：Café\n活动时间：10月24日\n说明：另一个时间用途待核实\n提交截止：2026年10月20日\n23:59'));

test('字面比较不吞标点、不执行正则或HTML；差异与依据按纯文本导出',()=>fixture(task=>{
 domain.editTask(task,1,{...task.values,location:'<script>新地点</script>'},'<img src=x onerror=alert(1)>合成依据');
 assert.equal(domain.fieldBodyReview(task).length,1);
 const html=domain.renderHtml(task);assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
 assert.equal(html.includes('<script>'),false);assert.equal(html.includes('<img src=x'),false);
 domain.editTask(task,2,{...task.values,location:'活动室.*'},'合成字面正则边界');assert.equal(domain.fieldBodyReview(task).length,1);
}));
