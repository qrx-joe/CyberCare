import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAudio, createAssistanceService } from '../dist/assistance.js';
import { createAssistanceProvider, parseTranscription, validateSummary, validateGuidance, parseAssistanceJson } from '../dist/assistance-provider.js';
import { createProvider } from '../dist/provider.js';
import { fromTranscript, SAMPLE_TEXT } from '../dist/domain.js';
import { audioReviewHints } from '../dist/audio-review.js';

const signal = () => new AbortController().signal;
const env = { STEPFUN_API_KEY: 'synthetic-test-key', STEPFUN_BASE_URL: 'https://api.stepfun.com/v1', STEPFUN_MODEL: 'synthetic-model', MODEL_REQUEST_LIMIT: '3' };
const manual = { kind: 'audio', mode: 'manual', permission: true, sourceNote: '开发者合成材料', text: '明天下午在示例活动室开会。' };
const image = { name: 'synthetic.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=' };
function wav(seconds = 1) {
  const b = Buffer.alloc(44 + 32000 * seconds); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40); return b;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('复现真实响应的完整 JSON 围栏，只移除单层外壳，拒绝前后正文及截断', () => {
  assert.deepEqual(parseAssistanceJson('```json\n{"screen":"设置"}\n```'), { screen: '设置' });
  assert.deepEqual(parseAssistanceJson('{"screen":"设置"}'), { screen: '设置' });
  for (const text of ['说明\n```json\n{}\n```', '```json\n{}', '{}\n其他文字', '```json\n{}\n```\n```json\n{}\n```']) assert.throws(() => parseAssistanceJson(text));
});

test('服务端校验 PCM WAV 的真实大小、时长、声道及完整结构', () => {
  assert.equal(validateAudio(wav().toString('base64')), 1);
  assert.equal(validateAudio(wav(60).toString('base64')), 60);
  for (const b of [wav(61), wav().subarray(0, 42), Buffer.from('not audio')]) assert.throws(() => validateAudio(b.toString('base64')), e => e.code === 'AUDIO_INVALID');
  const stereo = wav(); stereo.writeUInt16LE(2, 22); assert.throws(() => validateAudio(stereo.toString('base64')));
  const truncated = wav(); truncated.writeUInt32LE(999999, 40); assert.throws(() => validateAudio(truncated.toString('base64')));
  assert.throws(() => validateAudio(Buffer.alloc(2200000).toString('base64')), e => e.code === 'AUDIO_TOO_LARGE');
  assert.throws(() => validateAudio('%%%%'), e => e.code === 'AUDIO_INVALID');
});

test('SSE 只接受最终完整转写，丢弃任意 usage 字段，不把 delta 当成成功', () => {
  const body = 'data: {"type":"transcript.text.delta","delta":"部分"}\r\n\r\ndata: {"type":"transcript.text.done","text":"完整文字","usage":{"total_tokens":3,"private":"secret"}}\r\n\r\ndata: [DONE]\n\n';
  assert.deepEqual(parseTranscription(body), { text: '完整文字', usage: { total_tokens: 3 } });
  for (const body of ['data: {"type":"transcript.text.delta","delta":"不完整"}\n\n', 'data: {"type":"error","message":"private"}\n\n', 'data: {"type":"transcript.text.done","text":""}\n\n']) assert.throws(() => parseTranscription(body));
});

test('摘要必须可定位于转写，截图只能给一个可见控件；敏感或未知结果停止', () => {
  const original = '明天在示例活动室开会。';
  assert.throws(() => validateSummary(original, { summary: [{ text: '虚构', evidence: '不存在' }], facts: [], uncertainties: [] }));
  assert.throws(() => validateSummary(original, { summary: [], facts: [{ kind: 'time', text: '下午三点', evidence: original }], uncertainties: [] }));
  const g = { screen: '合成设置页', visibleText: ['显示设置'], next: { action: '点击显示设置', target: '显示设置', position: '中部', evidence: '显示设置' }, check: '核对下一页', risk: 'normal', warnings: [] };
  assert.ok(validateGuidance(g).next);
  assert.equal(validateGuidance({ ...g, visibleText: ['显示设置 >'], next: { ...g.next, evidence: '显示设置 >' } }).next.target, '显示设置');
  assert.throws(() => validateGuidance({ ...g, next: { ...g.next, target: '设置' } }));
  assert.throws(() => validateGuidance({ ...g, visibleText: ['显示设置 >', '显示设置 ›'] }));
  assert.equal(validateGuidance({ ...g, risk: 'uncertain' }).next, null);
  assert.equal(validateGuidance({ ...g, next: { ...g.next, action: '输入验证码' } }).next, null);
  assert.throws(() => validateGuidance({ ...g, visibleText: ['其他按钮'] }));
});

test('海报、语音和截图实际共享请求预算；失败没有自动重试', async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fromTranscript(SAMPLE_TEXT)) } }] })); };
    const p = createProvider({ ...env, MODEL_REQUEST_LIMIT: '1' });
    await p.extract({ mode: 'live', permission: true, sourceNote: '合成', image }, signal());
    await assert.rejects(() => p.requestAssistance('audio/asr/sse', {}, signal(), JSON.parse), e => e.code === 'MODEL_LIMIT');
    assert.equal(p.assistanceInfo().requests, 1); assert.equal(calls, 1);
    const failed = createProvider(env); globalThis.fetch = async () => { calls++; return new Response('private-upstream', { status: 401 }); };
    await assert.rejects(() => failed.requestAssistance('chat/completions', {}, signal(), JSON.parse), e => e.code === 'ASSIST_MODEL_FAILED' && !e.message.includes('private'));
    await assert.rejects(() => failed.requestAssistance('chat/completions', {}, signal(), JSON.parse), e => e.code === 'MODEL_LIMIT');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = oldFetch; }
});

test('真实路径协议替代测试覆盖两次调用、usage，以及摘要失败保留全文', async () => {
  const oldFetch = globalThis.fetch; const payloads = [];
  const audio = { kind: 'audio', mode: 'live', permission: true, sourceNote: '合成声音', audio: { name: 'synthetic.wav', data: wav().toString('base64') } };
  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body); payloads.push({ url, body });
      return String(url).endsWith('/audio/asr/sse') ? new Response('data: {"type":"transcript.text.done","text":"明天下午开会。","usage":{"total_tokens":2}}\n\n') : new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: [{ text: '明天下午开会', evidence: '明天下午开会。' }], facts: [], uncertainties: [] }) } }], usage: { total_tokens: 5 } }));
    };
    const provider = createProvider(env), adapter = createAssistanceProvider(provider, env);
    const result = await adapter.run(audio, signal());
    assert.equal(result.audio.original, '明天下午开会。'); assert.equal(result.audio.summary.length, 1);
    assert.deepEqual(result.providers.map(p => p.usage.total_tokens), [2, 5]);
    assert.equal(provider.info().requests, 2); assert.equal(payloads[0].body.audio.input.format.rate, 16000);
    const p = createProvider({ ...env, MODEL_REQUEST_LIMIT: '1' });
    const fallback = await createAssistanceProvider(p, env).run(audio, signal());
    assert.equal(fallback.audio.original, '明天下午开会。'); assert.ok(fallback.audio.summaryError); assert.equal(fallback.providers[1].requests, 0);
    globalThis.fetch = async () => new Response('data: {"type":"transcript.text.delta","delta":"不完整"}\n\n');
    await assert.rejects(() => createAssistanceProvider(createProvider(env), env).run(audio, signal()));
  } finally { globalThis.fetch = oldFetch; }
});

test('独立任务的会话、幂等、修改失效、版本和确认导出门禁', async () => {
  const service = createAssistanceService(createAssistanceProvider(createProvider({}), {}));
  try {
    const task = service.create(manual, 'owner', 'same-key'); await tick();
    assert.equal(service.create(manual, 'owner', 'same-key'), task);
    assert.throws(() => service.create({ ...manual, text: 'changed' }, 'owner', 'same-key'), e => e.code === 'IDEMPOTENCY_CONFLICT');
    assert.throws(() => service.get(task.id, 'stranger'), e => e.status === 404);
    assert.throws(() => service.exportText(task.id, 'owner'), e => e.code === 'REVIEW_REQUIRED');
    service.review(task.id, 'owner', 1); assert.match(service.exportText(task.id, 'owner'), /人工输入/);
    service.edit(task.id, 'owner', { revision: 1, text: '核对后的文本', summary: '人工摘要', reason: '回听核实' });
    assert.equal(task.status, 'needs_review'); assert.equal(task.confirmedAt, undefined);
    assert.throws(() => service.review(task.id, 'owner', 1), e => e.code === 'REVISION_CONFLICT');
    service.review(task.id, 'owner', 2); assert.match(service.exportText(task.id, 'owner'), /核对后的文本/);
    assert.equal(task.audio.original, manual.text); assert.equal('session' in service.public(task), false);
  } finally { service.close(); }
});

test('取消、删除或到期获胜，晚到的成功和失败都不能复活任务', async () => {
  for (const action of ['cancel', 'remove', 'expire']) for (const rejected of [false, true]) {
    let finish, fail; const adapter = { run: () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }) };
    const service = createAssistanceService(adapter, action === 'expire' ? 1 : 10000);
    try {
      const task = service.create(manual, 'owner', 'key');
      if (action === 'expire') { await new Promise(resolve => setTimeout(resolve, 5)); service.prune(); } else service[action](task.id, 'owner');
      if (rejected) fail(new Error('late upstream failure')); else finish({ audio: { original: '晚到文字', summary: [], facts: [], uncertainties: [] }, providers: [] }); await tick();
      assert.equal(task.audio, undefined);
      if (action === 'cancel') assert.equal(service.get(task.id, 'owner').status, 'cancelled');
      else assert.throws(() => service.get(task.id, 'owner'), e => e.status === 404);
    } finally { service.close(); }
  }
});

test('截图继续必须确认前一步、同目标、同会话和新截图', async () => {
  const guide = { kind: 'guide', mode: 'live', permission: true, sourceNote: '合成界面', goal: '调整文字', image };
  const adapter = { run: async () => ({ guidance: { screen: '设置', visibleText: [], next: null, check: '补图', risk: 'uncertain', warnings: [] }, providers: [] }) };
  const service = createAssistanceService(adapter);
  try {
    const task = service.create(guide, 'owner', 'first'); await tick();
    assert.throws(() => service.create({ ...guide, previousId: task.id }, 'owner', 'next'), e => e.code === 'STEP_NOT_CONFIRMED');
    service.review(task.id, 'owner', 1);
    assert.throws(() => service.create({ ...guide, previousId: task.id }, 'owner', 'next'), e => e.code === 'NEW_SCREEN_REQUIRED');
    assert.throws(() => service.create({ ...guide, previousId: task.id, goal: '其他目标' }, 'owner', 'next'), e => e.code === 'STEP_NOT_CONFIRMED');
    assert.throws(() => service.create({ ...guide, previousId: task.id }, 'other', 'next'), e => e.status === 404);
    task.guidance.risk = 'sensitive';
    assert.throws(() => service.create({ ...guide, previousId: task.id }, 'owner', 'sensitive-next'), e => e.code === 'SENSITIVE_STEP');
  } finally { service.close(); }
});

test('更正误识别地点后，API 和导出指出摘要仍引用旧地点；同步修正后提示消失', async () => {
  const original = '地点是市立活动室。', summary = '活动地点是市立活动室。';
  const service = createAssistanceService({ run: async () => ({ audio: { original, summary: [{ text: summary, evidence: original }], facts: [{ kind: 'location', text: '市立活动室', evidence: original }], uncertainties: [] }, providers: [] }) });
  try {
    const task = service.create(manual, 'owner', 'correction'); await tick();
    service.edit(task.id, 'owner', { revision: 1, text: '地点是示例活动室。', summary, reason: '合成回听答案：原音是示例活动室' });
    assert.deepEqual(service.public(task).audioReviewHints?.map(hint => hint.text), ['市立活动室']);
    service.review(task.id, 'owner', 2);
    assert.match(service.exportText(task.id, 'owner'), /摘要.*市立活动室.*全文/);
    service.edit(task.id, 'owner', { revision: 2, text: '地点是示例活动室。', summary: '活动地点是示例活动室。', reason: '同步更正摘要' });
    assert.equal(service.public(task).audioReviewHints?.length ?? 0, 0);
    assert.equal(task.audio.original, original);
  } finally { service.close(); }
});

test('语音文字对照只处理已有原文事项，兼容布局空白与 NFC，不把字符串当正则或自动判真', () => {
  const audio = { original: '地点：Café A+B[2] 活动室', summary: [], facts: [{ kind: 'location', text: 'Café A+B[2] 活动室', evidence: '地点：Café A+B[2] 活动室' }], uncertainties: [] };
  assert.deepEqual(audioReviewHints(audio, '地点：Cafe\u0301 A+B[2]\n活动室', 'Café A+B[2] 活动室'), []);
  assert.deepEqual(audioReviewHints(audio, '地点待核实', '地点待核实'), []);
  assert.equal(audioReviewHints(audio, '地点：Cafe AAB2 活动室', '地点：Café A+B[2] 活动室').length, 1);
  assert.deepEqual(audioReviewHints({ ...audio, facts: [{ kind: 'location', text: '不在原文的场地', evidence: audio.original }] }, '', '不在原文的场地'), []);
  assert.equal(audioReviewHints({ ...audio, facts: [...audio.facts, ...audio.facts] }, '已修订', audio.original).length, 1);
});
