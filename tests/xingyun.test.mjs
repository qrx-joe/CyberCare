import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createXingyunGateway, narrationForTask, signXingyun } from '../dist/xingyun.js';
import { createTaskService } from '../dist/service.js';
import { createProvider } from '../dist/provider.js';
import { confirmTask, editTask, renderHtml, hash } from '../dist/domain.js';

const env = { XINGYUN_APP_ID:'synthetic-app', XINGYUN_APP_SECRET:'synthetic-secret', XINGYUN_SESSION_LIMIT:'3' };
const session = () => new Response(JSON.stringify({error_code:0,data:{session_id:'synthetic-session',token:'temporary-token',socket_io_url:'wss://gateway.xingyun3d.com',resource_pack:{}}}));
const ok = () => new Response('{"error_code":0}');
const input = {request_id:'a'.repeat(32),config:{raw_audio:false,untrusted:'ignored'}};

test('星云签名匹配官方排序、空格移除和非 ASCII 转义，密钥不进入请求正文', () => {
  const result=signXingyun('demo','fake-secret','POST',{z:'中 文😀',a:{b:2,a:1}},1700000000000);
  const canonical='{"a":{"a":1,"b":2},"z":"\\u4e2d\\u6587\\ud83d\\ude00"}';
  const expected=createHash('md5').update('/user/v1/ttsa_v2/sessionpost'+canonical+'fake-secret1700000000').digest('hex');
  assert.equal(result.headers['X-TOKEN'],expected);assert.equal(result.headers['X-TIMESTAMP'],'1700000000');
  assert.equal(result.headers['X-APP-ID'],'demo');assert.ok(!JSON.stringify(result).includes('fake-secret'));
});

test('未配置、无 SDK 或零额度不建立会话，返回信息不泄露凭据', async () => {
  for(const options of [{env:{}},{env,sdkAvailable:()=>false},{env:{...env,XINGYUN_SESSION_LIMIT:'0'}}]) {
    let calls=0;
    const gateway=createXingyunGateway({sdkAvailable:()=>true,...options,fetcher:async()=>{calls++;return session();}});
    assert.equal(gateway.info().configured,false);
    await assert.rejects(gateway.open('owner',randomUUID(),input),{code:'AVATAR_UNAVAILABLE'});
    assert.equal(calls,0);assert.ok(!JSON.stringify(gateway.info()).includes('synthetic-secret'));await gateway.dispose();
  }
});

test('服务端固定网关签名；单会话、归属校验、三次进程上限与关闭幂等', async () => {
  const calls=[];
  const gateway=createXingyunGateway({env,sdkAvailable:()=>true,fetcher:async(url,request)=>{calls.push({url,...request});return request.method==='POST'?session():ok();}});
  try {
    for(let i=0;i<3;i++) {
      const id=randomUUID();await gateway.open('owner',id,input);
      if(i===0){await assert.rejects(gateway.open('other',randomUUID(),input),{code:'AVATAR_BUSY'});await gateway.stop('other',id);assert.equal(calls.length,1);}
      await gateway.stop('owner',id);await gateway.stop('owner',id);
    }
    await assert.rejects(gateway.open('owner',randomUUID(),input),{code:'AVATAR_UNAVAILABLE'});
    assert.equal(gateway.info().requests,3);assert.equal(calls.length,6);
    for(const call of calls){assert.equal(call.url,'https://nebula-agent.xingyun3d.com/user/v1/ttsa_v2/session');assert.equal(call.headers['X-APP-ID'],env.XINGYUN_APP_ID);assert.ok(!call.body.includes('synthetic-secret'));}
    assert.deepEqual(JSON.parse(calls[0].body).config,{framedata_proto_version:2,raw_audio:false,walk_version:3});
  }finally{await gateway.dispose();}
});

test('先停止再启动不会创建远程会话；初始化晚到会被补偿关闭', async () => {
  let resolveStart;const calls=[];
  const gateway=createXingyunGateway({env,sdkAvailable:()=>true,fetcher:async(_,request)=>{
    calls.push(request.method);if(request.method==='POST')return new Promise(resolve=>{resolveStart=resolve;});return ok();
  }});
  try {
    const cancelled=randomUUID();await gateway.stop('owner',cancelled);
    await assert.rejects(gateway.open('owner',cancelled,input),{code:'AVATAR_ATTEMPT_USED'});assert.deepEqual(calls,[]);
    const late=randomUUID();const result=gateway.open('owner',late,input);const rejected=assert.rejects(result,{code:'AVATAR_CANCELLED'});
    await gateway.stop('owner',late);resolveStart(session());await rejected;
    assert.deepEqual(calls,['POST','DELETE','DELETE']);assert.equal(gateway.info().requests,1);
  }finally{await gateway.dispose();}
});

test('鉴权或额度失败后停止新会话，供应商响应与密钥不透传', async () => {
  let calls=0;
  const gateway=createXingyunGateway({env,sdkAvailable:()=>true,fetcher:async(_,request)=>{calls++;return request.method==='POST'?new Response(JSON.stringify({error_code:401,error_reason:env.XINGYUN_APP_SECRET})):ok();}});
  await assert.rejects(gateway.open('owner',randomUUID(),input),error=>error.code==='AVATAR_CONNECT_FAILED'&&!error.message.includes(env.XINGYUN_APP_SECRET));
  assert.equal(gateway.info().configured,false);await assert.rejects(gateway.open('owner',randomUUID(),input),{code:'AVATAR_UNAVAILABLE'});
  assert.equal(calls,2);await gateway.dispose();
});

test('远端关闭未确认必须持续报错，但不整进程停用且可再开新会话', async () => {
  const gateway=createXingyunGateway({env,sdkAvailable:()=>true,fetcher:async(_,request)=>{return request.method==='POST'?session():new Response('{}',{status:503});}});
  const id=randomUUID();await gateway.open('owner',id,input);
  await assert.rejects(gateway.stop('owner',id),{code:'AVATAR_STOP_UNCONFIRMED'});
  await assert.rejects(gateway.stop('owner',id),{code:'AVATAR_STOP_UNCONFIRMED'});
  assert.equal(gateway.info().configured,true);assert.equal(gateway.info().lastFailure.httpStatus,503);
  const id2=randomUUID();await gateway.open('owner',id2,input);
  assert.equal(gateway.info().requests,2);assert.equal(gateway.info().configured,true);await gateway.dispose();
});

test('讲解仅接受已确认的同版本内容；草稿修订后仍需确认，完成后不可悄悄修改', async () => {
  const service=createTaskService(createProvider({MODEL_REQUEST_LIMIT:'0'}));
  try {
    const task=service.create({mode:'sample',sourceNote:'原创合成测试',permission:true},'owner',randomUUID());
    // Synthetic provider settles asynchronously; this is not a real model result.
    while(task.status==='processing') await new Promise(resolve=>setTimeout(resolve,5));
    assert.throws(()=>narrationForTask(task,task.revision),{code:'NARRATION_REVIEW_REQUIRED'});
    const old=task.revision;editTask(task,old,{...task.values,title:'已修订合成名称'},'合成测试更正');
    assert.throws(()=>narrationForTask(task,old),{code:'NARRATION_REVIEW_REQUIRED'});
    assert.throws(()=>narrationForTask(task,task.revision),{code:'NARRATION_REVIEW_REQUIRED'});
    task.audit={revision:task.revision,htmlHash:hash(renderHtml(task)),at:new Date().toISOString(),engine:'synthetic-test',violations:[],incomplete:[],passes:1};
    confirmTask(task,task.revision);
    const narration=narrationForTask(task,task.revision);
    assert.match(narration.text,/合成示例，不是真实活动/);assert.match(narration.text,/未知/);assert.equal(narration.revision,task.revision);
    assert.match(narration.text,/已修订合成名称/);
    assert.throws(()=>narrationForTask(task,old),{code:'NARRATION_REVIEW_REQUIRED'});
    assert.throws(()=>editTask(task,task.revision,{...task.values,title:'未经确认的新名称'},'合成更正'),{code:'NOT_REVIEWABLE'});
  }finally{service.close();}
});
