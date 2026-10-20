import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../dist/provider.js';
import { fromTranscript, SAMPLE_TEXT, hash } from '../dist/domain.js';

const env = { STEPFUN_API_KEY: 'dummy-test-only', STEPFUN_BASE_URL: 'https://api.stepfun.com/v1', STEPFUN_MODEL: 'test-model', MODEL_REQUEST_LIMIT: '1' };
const input = { mode: 'live', permission: true, sourceNote: '原创合成单元测试', image: { name: 'synthetic.png', mime: 'image/png', data: 'fake-unit-input' } };

test('有界等待、输出与显式推理强度进入实际请求，保留原有默认值', async () => {
  const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  const waits = [], payloads = [];
  try {
    AbortSignal.timeout = ms => { waits.push(ms); return originalTimeout(ms); };
    globalThis.fetch = async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices:[{ message:{ content:JSON.stringify(fromTranscript(SAMPLE_TEXT)) } }] }));
    };
    const tuned = createProvider({ ...env, STEPFUN_MODEL:'step-5-preview', MODEL_TIMEOUT_MS:'90000', MODEL_MAX_TOKENS:'4096', STEPFUN_REASONING_EFFORT:'low' });
    assert.equal(tuned.info().timeoutMs, 90000);
    const result = await tuned.extract(input, new AbortController().signal);
    const baseline = await createProvider(env).extract(input, new AbortController().signal);
    assert.deepEqual(waits, [90000,30000]);
    assert.equal(payloads[0].model, 'step-5-preview');
    assert.equal(payloads[0].reasoning_effort, 'low');
    assert.equal(payloads[0].max_tokens, 4096);
    assert.equal(payloads[1].max_tokens, 2500);
    assert.equal('reasoning_effort' in payloads[1], false);
    assert.equal(result.provider.timeoutMs, 90000);
    assert.equal(result.provider.reasoningEffort, 'low');
    assert.equal(result.provider.maxTokens, 4096);
    assert.equal(result.provider.promptVersion, 'poster-extract-v6');
    assert.equal(result.provider.promptVersion, tuned.info().promptVersion);
    for (const payload of payloads) assert.equal(hash(payload.messages[0].content), '56c36ab39d598fd5c3465505c46c7009fb302a0ef13e72bfc2712fa2a0d127f5');
    assert.match(payloads[0].messages[0].content, /不因二维码目标未知而置空/);
    assert.match(payloads[0].messages[0].content, /在 uncertainties 另写二维码目标或报名入口未知/);
    assert.match(payloads[0].messages[0].content, /只有无标签的二维码、缺少报名关联或文字无法辨认时，registration 为 null/);
    assert.equal(baseline.provider.timeoutMs, 30000);
    assert.equal(baseline.provider.reasoningEffort, null);
    assert.equal(baseline.provider.maxTokens, 2500);
  } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
});

test('等待和推理配置错误在外部调用前拒绝，人工路径仍可用且不暴露任意输入', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  const settings = [
    ...['0','999','90001','1000.5','Infinity','dummy-private-option'].map(value => ({ MODEL_TIMEOUT_MS:value })),
    ...['0','255','8193','2500.5','Infinity','dummy-private-option'].map(value => ({ MODEL_MAX_TOKENS:value })),
    { STEPFUN_MODEL:'step-5-preview', STEPFUN_REASONING_EFFORT:'auto' },
    { STEPFUN_MODEL:'test-model', STEPFUN_REASONING_EFFORT:'low' },
  ];
  try {
    globalThis.fetch = async () => { requests++; throw new Error('External request must not start.'); };
    for (const override of settings) {
      const provider = createProvider({ ...env, ...override });
      assert.equal(provider.info().live, false);
      assert.ok(provider.info().configError);
      assert.ok(!JSON.stringify(provider.info()).includes('dummy-private-option'));
      await assert.rejects(() => provider.extract(input, new AbortController().signal), error => error.code === 'MODEL_CONFIG');
      const manual = await provider.extract({ mode:'manual', permission:true, sourceNote:'原创合成参数回归', text:SAMPLE_TEXT }, new AbortController().signal);
      assert.equal(manual.provider.requests, 0);
      assert.equal(provider.info().requests, 0);
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('finish_reason 为 length 时，即使 JSON 可解析也拒绝生成不完整草稿', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => {
      requests++;
      return new Response(JSON.stringify({ choices:[{ message:{ content:JSON.stringify(fromTranscript(SAMPLE_TEXT)) }, finish_reason:'length' }], usage:{ total_tokens:2501 } }));
    };
    const provider = createProvider(env);
    await assert.rejects(() => provider.extract(input, new AbortController().signal), error => {
      assert.equal(error.diagnostic.stage, 'output-truncated');
      assert.equal(error.diagnostic.finishReason, 'length');
      assert.equal(error.diagnostic.maxTokens, 2500);
      assert.equal(error.diagnostic.usage.total_tokens, 2501);
      assert.match(error.message, /结果不完整/);
      assert.match(error.message, /人工转录/); return true;
    });
    await assert.rejects(() => provider.extract(input, new AbortController().signal), /预算/);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('较长等待仍响应主动取消，失败记录包含本次等待与推理配置且无重试', async () => {
  const originalFetch = globalThis.fetch;
  const settings = { ...env, STEPFUN_MODEL:'step-5-preview', MODEL_TIMEOUT_MS:'90000', STEPFUN_REASONING_EFFORT:'low' };
  let requests = 0;
  try {
    globalThis.fetch = async (_url, { signal }) => {
      requests++;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once:true }));
    };
    const provider = createProvider(settings), controller = new AbortController();
    const pending = provider.extract(input, controller.signal); controller.abort();
    await assert.rejects(() => pending, error => error.code === 'CANCELLED');
    assert.equal(provider.info().requests, 1);
    globalThis.fetch = async () => { requests++; throw new DOMException('dummy-private-option', 'TimeoutError'); };
    await assert.rejects(() => createProvider(settings).extract(input, new AbortController().signal), error => {
      assert.equal(error.diagnostic.timeoutMs, 90000);
      assert.equal(error.diagnostic.reasoningEffort, 'low');
      assert.equal(error.diagnostic.timeout, true);
      assert.ok(!JSON.stringify(error).includes('dummy-private-option')); return true;
    });
    assert.equal(requests, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('Step Plan 使用显式套餐地址，拒绝后不回落到按请求计费接口', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  try {
    globalThis.fetch = async url => {
      urls.push(String(url));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fromTranscript(SAMPLE_TEXT)) } }], usage: { total_tokens: 12 } }));
    };
    const settings = { ...env, STEPFUN_BASE_URL: 'https://api.stepfun.com/step_plan/v1' };
    const result = await createProvider(settings).extract(input, new AbortController().signal);
    assert.equal(result.provider.requests, 1);
    globalThis.fetch = async url => { urls.push(String(url)); return new Response('denied', { status: 402 }); };
    const refused = createProvider({ ...settings, MODEL_REQUEST_LIMIT: '10' });
    await assert.rejects(() => refused.extract(input, new AbortController().signal), /HTTP 402/);
    await assert.rejects(() => refused.extract(input, new AbortController().signal), /预算/);
    assert.deepEqual(urls, ['https://api.stepfun.com/step_plan/v1/chat/completions', 'https://api.stepfun.com/step_plan/v1/chat/completions']);
    assert.equal(refused.info().requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('模型 HTTP 失败保留状态，不泄露上游正文或凭据，不自动重试', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => { requests++; return new Response('dummy-test-only private poster text', { status: 400 }); };
    const provider = createProvider(env);
    await assert.rejects(() => provider.extract(input, new AbortController().signal), error => {
      assert.equal(error.code, 'MODEL_FAILED');
      assert.equal(error.diagnostic.stage, 'http');
      assert.equal(error.diagnostic.httpStatus, 400);
      assert.equal(error.diagnostic.usage, null);
      assert.match(error.message, /HTTP 400/);
      assert.ok(!JSON.stringify(error).includes('dummy-test-only'));
      assert.ok(!JSON.stringify(error).includes('private poster text'));
      return true;
    });
    await assert.rejects(() => provider.extract(input, new AbortController().signal), /预算/);
    assert.equal(requests, 1);
    assert.equal(provider.info().stopped, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('输出截断单列并保留可得 Token，仅允许数字用量而不保存正文', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'private poster text {broken' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, private_data: 'dummy-test-only', completion_tokens_details: { reasoning_tokens: 5, private_data: 'private poster text' } },
    }));
    await assert.rejects(() => createProvider(env).extract(input, new AbortController().signal), error => {
      assert.equal(error.diagnostic.stage, 'output-truncated');
      assert.equal(error.diagnostic.httpStatus, 200);
      assert.equal(error.diagnostic.finishReason, 'length');
      assert.deepEqual(error.diagnostic.usage, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, completion_tokens_details: { reasoning_tokens: 5 } });
      assert.ok(!JSON.stringify(error).includes('private poster text'));
      assert.ok(!JSON.stringify(error).includes('dummy-test-only'));
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('HTTP 402 引导核对 API 额度并停止，不通过重试规避拒绝', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => { requests++; return new Response('dummy-test-only private billing details', { status: 402 }); };
    const provider = createProvider({ ...env, MODEL_REQUEST_LIMIT: '10' });
    await assert.rejects(() => provider.extract(input, new AbortController().signal), error => {
      assert.equal(error.diagnostic.httpStatus, 402);
      assert.equal(error.diagnostic.usage, null);
      assert.match(error.message, /API.*余额.*赠送额度/);
      assert.ok(!JSON.stringify(error).includes('private billing details'));
      return true;
    });
    assert.equal(provider.info().stopped, true);
    await assert.rejects(() => provider.extract(input, new AbortController().signal), /预算/);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('区分响应 JSON、提取契约和请求错误，不输出任意异常消息', async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    { fetch: async () => new Response('private poster text'), stage: 'response-json', httpStatus: 200 },
    { fetch: async () => new Response(JSON.stringify({ choices:[{ message:{ content:'private poster text {broken' }, finish_reason:'stop' }] })), stage: 'output-json', httpStatus: 200 },
    { fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: { total_tokens: -1, prompt_tokens: 'dummy-test-only' } })), stage: 'output-contract', httpStatus: 200 },
    { fetch: async () => { throw new TypeError('dummy-test-only private poster text'); }, stage: 'request', httpStatus: null },
    { fetch: async () => { throw new DOMException('dummy-test-only private poster text', 'TimeoutError'); }, stage: 'request', httpStatus: null, timeout: true },
  ];
  try {
    for (const sample of cases) {
      globalThis.fetch = sample.fetch;
      await assert.rejects(() => createProvider(env).extract(input, new AbortController().signal), error => {
        assert.equal(error.diagnostic.stage, sample.stage);
        assert.equal(error.diagnostic.httpStatus, sample.httpStatus);
        assert.equal(error.diagnostic.timeout, Boolean(sample.timeout));
        assert.equal(error.diagnostic.usage, null);
        assert.ok(!JSON.stringify(error).includes('dummy-test-only'));
        assert.ok(!JSON.stringify(error).includes('private poster text'));
        return true;
      });
    }
  } finally { globalThis.fetch = originalFetch; }
});
