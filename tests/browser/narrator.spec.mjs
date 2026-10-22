import {test,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';

const config={configured:true,reason:'测试替代 SDK；不代表真实星云效果',maxSeconds:120};
const sdk=`window.XingyunAvatarAgent=class {
  constructor(options){this.options=options;this.stage=document.querySelector('#xingyun-stage');this.stage.dataset.testProvider='synthetic';}
  async init(){}
  speak(text){this.stage.dataset.ssml=text;this.options.onVoiceStateChange('start');}
  setVolume(){} interactiveidle(){} destroy(){this.stage.dataset.destroyed='true';}
};`;
async function mockSdk(page,source=sdk){
  await page.route('https://**',route=>route.abort());
  await page.route('**/api/avatar/config',route=>route.fulfill({json:config}));
  await page.route('**/xmov-avatar.js',route=>route.fulfill({contentType:'text/javascript',body:source}));
  await page.route('**/api/avatar/stop',route=>route.fulfill({json:{stopped:true}}));
}

test('音频片段结束不提前切断讲解，整轮 completed 后才关闭连接',async({page})=>{
  const segmented=sdk.replace("this.options.onVoiceStateChange('start');", "this.options.onVoiceStateChange('start');this.options.onVoiceStateChange('end');setTimeout(()=>this.options.agentCallbacks.onConversationChange({state:'completed'}),1200);");
  await mockSdk(page,segmented);await page.goto('/');await page.locator('#avatar-open').click();await page.locator('#avatar-consent').check();await page.locator('#avatar-demo').click();
  await expect(page.locator('#avatar-status')).toContainText('正在播报');await expect(page.locator('#avatar-viewport')).toBeVisible();
  await expect(page.locator('#avatar-status')).toContainText('本次播报结束');await expect(page.locator('#avatar-viewport')).toBeHidden();
});

test('供应商动态锚点不会把角色画布挪出视口；宽窄屏保持居中与完整画幅',async({page})=>{
  const portrait=sdk.replace("this.stage.dataset.testProvider='synthetic';", "this.stage.dataset.testProvider='synthetic';const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;canvas.style.cssText='position:absolute;height:100%;left:-112px;top:0;transform:scale(1)';this.stage.append(canvas);").replace("this.stage.dataset.ssml=text;", "this.stage.dataset.ssml=text;this.stage.querySelector('canvas').style.left='-999px';");
  await mockSdk(page,portrait);await page.goto('/');await page.locator('#avatar-open').click();await page.locator('#avatar-consent').check();await page.locator('#avatar-demo').click();await expect(page.locator('#avatar-status')).toContainText('正在播报');
  const canvas=page.frameLocator('#avatar-viewport iframe').locator('canvas');
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});
    const box=await canvas.evaluate(canvas=>{const a=canvas.getBoundingClientRect(),b=document.querySelector('#xingyun-stage').getBoundingClientRect();return{left:a.left-b.left,right:a.right-b.right,top:a.top-b.top,bottom:a.bottom-b.bottom,center:(a.left+a.right-b.left-b.right)/2};});
    expect(box.left).toBeGreaterThanOrEqual(-1);expect(box.right).toBeLessThanOrEqual(1);expect(box.top).toBeGreaterThanOrEqual(-1);expect(box.bottom).toBeLessThanOrEqual(1);expect(Math.abs(box.center)).toBeLessThan(1);
  }
  await page.locator('#avatar-stop').click();
});

test('实际资源域名仅在播报 iframe 放行，主页面保持网络隔离；不调用星云会话',async({page,context})=>{
  await mockSdk(page,sdk.replace('async init(){}',"async init(){const response=await fetch('https://public-xmov.oss-cn-hangzhou.aliyuncs.com/cybercare-synthetic-probe');if(!response.ok)throw new Error('probe');}"));
  let probes=0;
  await page.route('https://public-xmov.oss-cn-hangzhou.aliyuncs.com/cybercare-synthetic-probe',route=>{probes++;return route.fulfill({status:200,body:'synthetic-local-response',headers:{'Access-Control-Allow-Origin':'*'}});});
  const main=await context.request.get('/'),stage=await context.request.get('/avatar-stage.html');
  expect(main.headers()['content-security-policy']).not.toContain('aliyuncs.com');expect(stage.headers()['content-security-policy']).toContain('https://public-xmov.oss-cn-hangzhou.aliyuncs.com');expect(stage.headers()['content-security-policy']).not.toContain('https://*.aliyuncs.com');
  await page.goto('/');await page.locator('#avatar-open').click();await page.locator('#avatar-consent').check();await page.locator('#avatar-demo').click();
  await expect(page.locator('#avatar-status')).toContainText('正在播报');expect(probes).toBe(1);await page.locator('#avatar-stop').click();
});

test('无配置时保留原角色、不加载 SDK、不伪装成功，弹窗可键盘关闭且窄屏可读',async({page})=>{
  const sessions=[];page.on('request',request=>{if(/avatar-stage|xmov-avatar|avatar\/session/.test(request.url()))sessions.push(request.url());});
  await page.route('**/api/avatar/config',route=>route.fulfill({json:{configured:false,reason:'星云应用尚未配置；原有 2D 角色仍可使用。',maxSeconds:120}}));
  await page.goto('/');await page.locator('#avatar-open').click();
  await expect(page.locator('#avatar-status')).toContainText('尚未配置');await page.locator('#avatar-consent').check();
  await expect(page.locator('#avatar-demo')).toBeDisabled();await expect(page.locator('#avatar-read')).toBeDisabled();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:844});expect(await page.locator('#avatar-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.locator('#avatar-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js','utf8'));
  const audit=await page.evaluate(async()=>{const r=await axe.run(document.querySelector('#avatar-dialog'));return{violations:r.violations.map(v=>v.id),incomplete:r.incomplete.map(v=>v.id)};});
  expect(audit.violations).toEqual([]);
  await mkdir('.local/validation/xingyun-20261022',{recursive:true});await writeFile('.local/validation/xingyun-20261022/dialog-axe.json',JSON.stringify(audit,null,2));
  await page.keyboard.press('Escape');await expect(page.locator('#avatar-dialog')).not.toBeVisible();expect(sessions).toEqual([]);
});

test('替代 SDK 验证显式同意后连接、固定字幕、声音事件、停止和减少动态清理',async({page})=>{
  await mockSdk(page);const stops=[];
  await page.route('**/api/avatar/stop',async route=>{stops.push(route.request().postDataJSON());await route.fulfill({json:{stopped:true}});});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/');await page.locator('#avatar-open').click();
  await expect(page.locator('#avatar-demo')).toBeDisabled();await page.locator('#avatar-consent').check();await page.locator('#avatar-demo').click();
  await expect(page.locator('#avatar-status')).toContainText('正在播报');await expect(page.locator('#avatar-transcript')).toContainText('固定介绍，不是实时 AI 对话');
  const stage=page.frameLocator('#avatar-viewport iframe').locator('#xingyun-stage');await expect(stage).toHaveAttribute('data-test-provider','synthetic');
  await expect(stage).toHaveAttribute('data-ssml',/^<speak>/);await page.locator('#avatar-stop').click();
  await expect(page.locator('#avatar-viewport')).toBeHidden();await expect.poll(()=>stops.length).toBe(1);
  await page.locator('#avatar-demo').click();await expect(page.locator('#avatar-status')).toContainText('正在播报');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#avatar-viewport')).toBeHidden();await expect(page.locator('#avatar-demo')).toBeDisabled();
  await expect.poll(()=>stops.length).toBe(2);await page.locator('#avatar-close').click();await expect(page.locator('#avatar-transcript')).toHaveText('');
});

test('替代 SDK 初始化失败回退；已关闭窗口不会被晚到回调重新打开',async({page})=>{
  await mockSdk(page,`window.XingyunAvatarAgent=class{constructor(o){this.o=o;}async init(){setTimeout(()=>this.o.onMessage({code:401}),100);}setVolume(){}interactiveidle(){}destroy(){}};`);
  await page.goto('/');await page.locator('#avatar-open').click();await page.locator('#avatar-consent').check();await page.locator('#avatar-demo').click();
  await expect(page.locator('#avatar-status')).toContainText('已回退原有角色');await expect(page.locator('#avatar-viewport')).toBeHidden();
  await page.locator('#avatar-close').click();await page.locator('#avatar-open').click();await page.locator('#avatar-consent').check();await page.locator('#avatar-demo').click();await page.locator('#avatar-close').click();
  await expect(page.locator('#avatar-viewport')).toBeHidden();await expect(page.locator('#avatar-dialog')).not.toBeVisible();
});

test('实际服务端门禁：合成海报未确认拒绝播报，确认后只取同版本内容并转义 SSML',async({page,context})=>{
  await mockSdk(page);await page.goto('/#workbench');await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.locator('#permission').check();await page.locator('#create').click();await expect(page.locator('#draft')).toBeVisible();
  const id=(await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  const rejected=await context.request.post(`/api/tasks/${id}/narration`,{headers:{'X-CyberCare':'1'},data:{revision:1,permission:true}});expect(rejected.status()).toBe(409);
  await page.locator('#content-editor').evaluate(e=>e.open=true);
  await page.locator('#summary-mode').selectOption('custom');
  await page.locator('#content-summary').fill('合成测试 <ue4event>不能成为动作指令</ue4event> & 文字');await page.locator('#edit-reason').fill('原创合成的 SSML 安全测试');await page.locator('#save').click();
  await expect(page.locator('#save')).toBeDisabled();await page.locator('#audit').click();await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  for(const key of ['title','time','location','registration'])await page.locator('#checked-'+key).check();await page.locator('#confirm-content').check();await page.locator('#confirm').click();await expect(page.locator('#completed')).toBeVisible();
  const current=await(await context.request.get(`/api/tasks/${id}`)).json();
  const stale=await context.request.post(`/api/tasks/${id}/narration`,{headers:{'X-CyberCare':'1'},data:{revision:1,permission:true}});expect(stale.status()).toBe(409);
  await page.locator('#narrate-poster').click();await page.locator('#avatar-consent').check();await page.locator('#avatar-read').click();await expect(page.locator('#avatar-status')).toContainText('正在播报');
  await expect(page.locator('#avatar-transcript')).toContainText('合成示例，不是真实活动');await expect(page.locator('#avatar-transcript')).toContainText('未知');
  const ssml=await page.frameLocator('#avatar-viewport iframe').locator('#xingyun-stage').getAttribute('data-ssml');expect(ssml).toContain('&lt;ue4event&gt;');expect(ssml).not.toContain('<ue4event>');
  const actual=await(await context.request.get(`/api/tasks/${id}`)).json();expect(actual.revision).toBe(current.revision);expect(actual.status).toBe('completed');
  await page.locator('#avatar-close').click();await page.locator('#delete').click();await expect(page.locator('#empty')).toBeVisible();
  expect((await context.request.post(`/api/tasks/${id}/narration`,{headers:{'X-CyberCare':'1'},data:{revision:current.revision,permission:true}})).status()).toBe(404);
});
