import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../dist/provider.js';
import { fromTranscript, SAMPLE_TEXT } from '../dist/domain.js';

const env = { STEPFUN_API_KEY: 'dummy-test-only', STEPFUN_BASE_URL: 'https://api.stepfun.com/v1', STEPFUN_MODEL: 'test-model', MODEL_REQUEST_LIMIT: '1' };
const input = { mode: 'live', permission: true, sourceNote: '原创合成单元测试', image: { name: 'synthetic.png', mime: 'image/png', data: 'fake-unit-input' } };

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

test('输出 JSON 失败仍记录可得 Token 和截断原因，仅允许数字用量', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'private poster text {broken' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, private_data: 'dummy-test-only', completion_tokens_details: { reasoning_tokens: 5, private_data: 'private poster text' } },
    }));
    await assert.rejects(() => createProvider(env).extract(input, new AbortController().signal), error => {
      assert.equal(error.diagnostic.stage, 'output-json');
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
