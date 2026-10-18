import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromTranscript, normalizeExtraction, SAMPLE_TEXT, renderHtml, renderText, hash, editTask, confirmTask } from '../dist/domain.js';
import { inputSchema, reviewSchema, editSchema } from '../dist/contracts.js';
import { createTaskService, validateImage } from '../dist/service.js';
import { createProvider } from '../dist/provider.js';

const input = { mode: 'sample', permission: true, sourceNote: '原创合成样例' };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('缺失报名方式保持未知；不以常识补全', () => {
  const e = fromTranscript(SAMPLE_TEXT);
  assert.equal(e.facts.registration.value, null);
  assert.ok(e.uncertainties.some(v => v.includes('报名方式未知')));
});
test('无转录依据的模型字段归为未知', () => {
  const e = fromTranscript(SAMPLE_TEXT); e.facts.registration = { value: '扫码报名', evidence: '自行补全' };
  assert.equal(normalizeExtraction(e).facts.registration.value, null);
});
test('未逐项确认和无授权输入拒绝', () => {
  assert.equal(inputSchema.safeParse({ ...input, permission: false }).success, false);
  assert.equal(reviewSchema.safeParse({ revision: 1, confirmed: {}, contentConfirmed: true }).success, false);
});
test('文件签名和大小受服务端约束', () => {
  assert.throws(() => validateImage({ name: 'fake.png', mime: 'image/png', data: Buffer.from('<script>').toString('base64') }), /签名/);
  assert.throws(() => validateImage({ name: 'big.png', mime: 'image/png', data: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }), /上限/);
});
test('无模型配置不以样例响应任意图片；手工路径请求数为零', async () => {
  const p = createProvider({});
  await assert.rejects(() => p.extract({ ...input, mode: 'live' }, new AbortController().signal), /尚未配置/);
  assert.equal((await p.extract(input, new AbortController().signal)).provider.requests, 0);
  assert.equal(p.info().requests, 0);
});
test('模拟上游验证请求硬上限、无自动重试、鉴权失败停止；不作真实模型质量证据', async () => {
  const originalFetch = globalThis.fetch;
  const env = { STEPFUN_API_KEY: 'dummy-test-only', STEPFUN_BASE_URL: 'https://api.stepfun.com/v1', STEPFUN_MODEL: 'test-model', MODEL_REQUEST_LIMIT: '1' };
  const liveInput = { ...input, mode: 'live', image: { name: 'synthetic.png', mime: 'image/png', data: 'fake-unit-input' } };
  let requests = 0;
  try {
    globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fromTranscript(SAMPLE_TEXT)) } }], usage: { total_tokens: 123 } })); };
    const provider = createProvider(env);
    const result = await provider.extract(liveInput, new AbortController().signal);
    assert.equal(result.provider.usage.total_tokens, 123);
    await assert.rejects(() => provider.extract(liveInput, new AbortController().signal), /预算/);
    assert.equal(requests, 1);
    globalThis.fetch = async () => { requests++; return new Response('denied', { status: 401 }); };
    const denied = createProvider({ ...env, MODEL_REQUEST_LIMIT: '10' });
    await assert.rejects(() => denied.extract(liveInput, new AbortController().signal), /调用失败/);
    await assert.rejects(() => denied.extract(liveInput, new AbortController().signal), /预算/);
    assert.equal(requests, 2);
  } finally { globalThis.fetch = originalFetch; }
});
test('确认要求当前检测；人工改动使旧报告失效；输出转义 HTML', async () => {
  const service = createTaskService(); const t = service.create(input, 'one', 'request-1'); await tick();
  assert.throws(() => confirmTask(t, 1), /先检测/);
  t.audit = { revision: 1, htmlHash: hash(renderHtml(t)), at: 'test', engine: 'test stub', violations: [], incomplete: [], passes: 0 };
  editTask(t, 1, { ...t.values, location: '<script>alert(1)</script>' }, '测试恶意文字');
  assert.equal(t.audit, undefined); assert.equal(t.changes.length, 1);
  const html = renderHtml(t); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.throws(() => confirmTask(t, 1), /版本已变化/);
  t.audit = { revision: 2, htmlHash: hash(html), at: 'test', engine: 'test stub', violations: [{ impact: 'critical' }], incomplete: [], passes: 0 };
  assert.throws(() => confirmTask(t, 2), /严重问题/);
  t.audit.violations = []; confirmTask(t, 2); assert.equal(t.status, 'completed');
  assert.equal(renderHtml(t), html); service.close();
});
test('幂等请求复用；不同载荷冲突；跨会话不可访问；删除撤回访问', async () => {
  const service = createTaskService(); const t = service.create(input, 'one', 'request-2'); await tick();
  assert.equal(service.create(input, 'one', 'request-2').id, t.id);
  assert.throws(() => service.create({ ...input, sourceNote: '另一张' }, 'one', 'request-2'), /不同资料/);
  assert.throws(() => service.get(t.id, 'two'), /不存在/);
  service.remove(t.id, 'one'); service.remove(t.id, 'one'); assert.throws(() => service.get(t.id, 'one'), /不存在/); service.close();
});
test('全文修订保留提取原文和修改依据，失效旧检测，导出使用修订正文', async () => {
  const service = createTaskService();
  try {
    const t = service.create(input, 'one', 'content-correction'); await tick();
    const original = structuredClone(t.extraction);
    t.audit = { revision: 1, htmlHash: hash(renderHtml(t)), at: 'test', engine: 'test stub', violations: [], incomplete: [], passes: 0 };
    const content = { original: '核对后的合成完整文字：免费，无需携带书籍。', summary: '合成说明：请以这份更正为准。', description: '<script>合成图像说明</script>' };
    editTask(t, 1, t.values, '对照合成答案修正正文', content);
    assert.equal(t.revision, 2); assert.equal(t.audit, undefined);
    assert.deepEqual(t.extraction, original);
    assert.deepEqual(t.reviewedContent, content);
    assert.equal(t.contentChanges.length, 3);
    assert.equal(t.contentChanges[0].before, original.original);
    assert.ok(t.contentChanges.every(change => change.reason === '对照合成答案修正正文'));
    assert.ok(renderText(t).includes(content.original));
    assert.ok(!renderText(t).includes(original.original));
    assert.ok(renderHtml(t).includes('&lt;script&gt;合成图像说明&lt;/script&gt;'));
    assert.throws(() => confirmTask(t, 2), /先检测/);
    const html = renderHtml(t);
    t.audit = { revision: 2, htmlHash: hash(html), at: 'test', engine: 'test stub', violations: [], incomplete: [], passes: 0 };
    confirmTask(t, 2); assert.equal(hash(renderHtml(t)), t.audit.htmlHash);
  } finally { service.close(); }
});
test('正文为空或超长时拒绝整个修订；不留下部分字段变化', async () => {
  const service = createTaskService();
  try {
    const t = service.create(input, 'one', 'invalid-content'); await tick();
    const content = { original: '  ', summary: '', description: '' };
    assert.equal(editSchema.safeParse({ revision: 1, values: t.values, reason: '合成测试', content }).success, false);
    assert.throws(() => editTask(t, 1, { ...t.values, title: '不应写入' }, '合成测试', content));
    assert.equal(t.revision, 1); assert.equal(t.changes.length, 0);
    assert.notEqual(t.values.title, '不应写入');
    assert.equal(editSchema.safeParse({ revision: 1, values: t.values, reason: '合成测试', content: { ...content, original: '合成正文', summary: '长'.repeat(1501) } }).success, false);
  } finally { service.close(); }
});
test('取消或删除后，迟到的 Provider 响应不能复活任务', async () => {
  for (const kind of ['cancel', 'remove']) {
    let finish;
    const fake = { info: () => ({ live: true }), extract: () => new Promise(resolve => { finish = resolve; }) };
    const service = createTaskService(fake); const t = service.create(input, 'one', kind);
    service[kind](t.id, 'one'); finish({ extraction: fromTranscript(SAMPLE_TEXT), provider: {} }); await tick();
    if (kind === 'cancel') { assert.equal(service.get(t.id, 'one').status, 'cancelled'); assert.equal(t.extraction, undefined); }
    else assert.throws(() => service.get(t.id, 'one'), /不存在/);
    service.close();
  }
});
test('过期即不可访问；检测期间修改不能写回过时报告', async () => {
  const expired = createTaskService(undefined, -1); const gone = expired.create(input, 'one', 'expiry');
  assert.throws(() => expired.get(gone.id, 'one'), /不存在/); expired.close();
  const service = createTaskService(); const t = service.create(input, 'one', 'audit-race'); await tick();
  let finish; const pending = service.audit(t.id, 'one', 1, renderHtml(t), () => new Promise(resolve => { finish = resolve; }));
  editTask(t, 1, t.values, '重新保存'); finish({ revision: 1 }); await assert.rejects(pending, /已变化/); assert.equal(t.audit, undefined); service.close();
});
