import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { AppError, FIELDS, fieldKeys, type Task } from './contracts.js';
import { contentForTask, dateReviewNote } from './domain.js';

const gatewayPath = '/user/v1/ttsa_v2/session';
const gateway = `https://nebula-agent.xingyun3d.com${gatewayPath}`;
const requestSchema = z.object({ request_id: z.string().regex(/^[a-f0-9]{32}$/), config: z.object({ raw_audio: z.boolean().optional() }).optional() });
export const AVATAR_SECONDS = 120;

// Match the official SDK's sorted JSON / ASCII escaping signing contract.
export function signXingyun(appId: string, secret: string, method: string, data: Record<string, unknown>, now = Date.now()) {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sort(item)])) : value;
  const body = JSON.stringify(sort(data));
  const canonical = body.replace(/[^\u0000-\u007e]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).replace(/ /g, '');
  const timestamp = String(Math.floor(now / 1000));
  const token = createHash('md5').update(`${gatewayPath}${method.toLowerCase()}${canonical}${secret}${timestamp}`).digest('hex');
  return { body, headers: { 'Content-Type': 'application/json', 'X-APP-ID': appId, 'X-TOKEN': token, 'X-TIMESTAMP': timestamp } };
}

export function narrationForTask(task: Task, revision: number) {
  if (task.revision !== revision || task.status !== 'completed' || task.review?.revision !== revision || !task.review.contentConfirmed)
    throw new AppError(409, 'NARRATION_REVIEW_REQUIRED', '请先完成当前版本的检测与逐项确认。');
  const mode = { sample: '以下是合成示例，不是真实活动。', manual: '以下内容来自人工转录并经当前操作者确认。', live: '以下内容经 AI 提取和当前操作者核对，仍可能有错误。' }[task.source.mode];
  const text = [mode, ...fieldKeys.map(key => `${FIELDS[key]}：${task.values?.[key] || '未知，请向活动方核实'}。`), dateReviewNote(task), contentForTask(task).summary,
    '以上播报四项信息与概述。完整文字请阅读文字版；人工确认不代表事实已独立核实。'].filter(Boolean).join('\n');
  if (text.length > 1200) throw new AppError(400, 'NARRATION_TOO_LONG', '四项信息与概述超过本次讲解上限，请先阅读或下载完整文字版。');
  return { text, revision, expiresAt: task.expiresAt };
}

interface Attempt { owner: string; id: string; requestId?: string; sessionId?: string; closed: boolean; closing?: Promise<void>; closeError?: AppError; timer?: ReturnType<typeof setTimeout>; until: number; }
interface Options { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; sdkAvailable?: () => boolean; }
export function createXingyunGateway(options: Options = {}) {
  const env = options.env ?? process.env, fetcher = options.fetcher ?? fetch;
  const appId = env.XINGYUN_APP_ID?.trim(), secret = env.XINGYUN_APP_SECRET?.trim();
  const sdkAvailable = options.sdkAvailable ?? (() => existsSync(new URL('web/xmov-avatar.js', import.meta.url)));
  // Since the 10/22 public opening: local runs keep the 3-session default, the public
  // origin defaults to 100; 300 is the hard ceiling and invalid values close the gateway.
  const defaultLimit = env.CYBERCARE_PUBLIC_ORIGIN ? 100 : 3;
  const configuredLimit = Number(env.XINGYUN_SESSION_LIMIT ?? defaultLimit);
  const limit = Number.isInteger(configuredLimit) && configuredLimit >= 0 && configuredLimit <= 300 ? configuredLimit : 0;
  const attempts = new Map<string, Attempt>();
  let requests = 0, stopped = false;
  let lastFailure: { method: string; stage: string; httpStatus?: number; providerCode?: number } | undefined;
  const info = () => ({ configured: !!appId && !!secret && sdkAvailable() && limit > 0 && !stopped && requests < limit,
    reason: !appId || !secret ? '星云应用尚未配置；原有 2D 角色仍可使用。' : !sdkAvailable() ? '星云 SDK 本地文件未就绪；原有 2D 角色仍可使用。' : limit === 0 ? '星云会话已关闭。' : stopped ? '本进程星云验证已因失败停止。' : requests >= limit ? '本进程星云会话次数已用完。' : '星云已配置，实际声音与口型仍需试播。',
    requests, limit, maxSeconds: AVATAR_SECONDS, ...(lastFailure ? { lastFailure } : {}) });
  async function upstream(method: 'POST' | 'DELETE', data: Record<string, unknown>) {
    const signed = signXingyun(appId!, secret!, method, data);
    let response: Response;
    try { response = await fetcher(gateway, { method, ...signed, signal: AbortSignal.timeout(method === 'POST' ? 12000 : 5000), redirect: 'error' }); }
    catch { lastFailure = { method, stage: 'network' }; throw new Error('Xingyun network failed'); }
    if (!response.ok) { lastFailure = { method, stage: 'http', httpStatus: response.status }; throw new Error('Xingyun request failed'); }
    const raw = await response.text();
    if (raw.length > 2 * 1024 * 1024 || raw.includes(secret!)) throw new Error('Invalid Xingyun response');
    const result = JSON.parse(raw) as Record<string, unknown>;
    if (result.error_code !== undefined && result.error_code !== 0) {
      lastFailure = { method, stage: 'provider', httpStatus: response.status, ...(typeof result.error_code === 'number' ? { providerCode: result.error_code } : {}) };
      throw new Error('Xingyun rejected request');
    }
    if (method === 'DELETE' && result.error_code === undefined) { lastFailure = { method, stage: 'stop-response', httpStatus: response.status }; throw new Error('Unconfirmed Xingyun stop'); }
    return result;
  }
  const key = (owner: string, id: string) => `${owner}:${id}`;
  function prune() { for (const [key, attempt] of attempts) if (attempt.closed && attempt.until <= Date.now()) attempts.delete(key); }
  async function closeAttempt(attempt: Attempt) {
    if (attempt.closeError) throw attempt.closeError;
    if (attempt.closing) return attempt.closing;
    if (attempt.closed) return;
    attempt.closed = true; clearTimeout(attempt.timer);
    if (attempt.requestId && appId && secret) {
      attempt.closing = (async () => {
        try { await upstream('DELETE', { request_id: attempt.requestId, ...(attempt.sessionId ? { session_id: attempt.sessionId } : {}), stop_reason: 'cybercare_stop' }); }
        catch { stopped = true; attempt.closeError = new AppError(502, 'AVATAR_STOP_UNCONFIRMED', '本地播放已停止，但星云会话关闭未获确认。请在星云控制台核对，本进程不再创建会话。'); throw attempt.closeError; }
      })();
      return attempt.closing;
    }
  }
  return {
    info,
    async open(owner: string, id: string, input: unknown) {
      prune();
      if (!info().configured) throw new AppError(503, 'AVATAR_UNAVAILABLE', info().reason);
      if (attempts.has(key(owner, id))) throw new AppError(409, 'AVATAR_ATTEMPT_USED', '本次连接已使用或取消，不会自动重试。');
      if ([...attempts.values()].some(attempt => !attempt.closed)) throw new AppError(409, 'AVATAR_BUSY', '已有一个星云会话，请先停止。');
      if (attempts.size >= 512) throw new AppError(429, 'AVATAR_ATTEMPT_LIMIT', '连接记录已达本机上限。');
      const inputData = requestSchema.parse(input);
      const attempt: Attempt = { owner, id, requestId: inputData.request_id, closed: false, until: Date.now() + AVATAR_SECONDS * 2000 };
      attempts.set(key(owner, id), attempt); requests++;
      attempt.timer = setTimeout(() => { void closeAttempt(attempt).catch(() => {}); }, AVATAR_SECONDS * 1000).unref();
      try {
        const result = await upstream('POST', { request_id: attempt.requestId, gateway_type: 'default', session_speak_req_id: 1, config: { raw_audio: inputData.config?.raw_audio ?? true, framedata_proto_version: 2, walk_version: 3 } });
        const data = result.data as Record<string, unknown> | undefined;
        if (!data?.resource_pack || typeof data.session_id !== 'string' || typeof data.token !== 'string' || typeof data.socket_io_url !== 'string') { lastFailure = { method: 'POST', stage: 'session-contract' }; throw new Error('Invalid session'); }
        attempt.sessionId = data.session_id;
        if (attempt.closed) {
          // A stop can arrive while the provider is still creating its session.
          try { await upstream('DELETE', { request_id: attempt.requestId, session_id: attempt.sessionId, stop_reason: 'cybercare_late_session' }); }
          catch { attempt.closeError = new AppError(502, 'AVATAR_STOP_UNCONFIRMED', '晚到星云会话的关闭未获确认，请在星云控制台核对。'); throw attempt.closeError; }
          throw new AppError(409, 'AVATAR_CANCELLED', '连接已取消，晚到会话已关闭。');
        }
        return result;
      } catch (error) {
        stopped = true;
        await closeAttempt(attempt);
        if (error instanceof AppError) throw error;
        throw new AppError(502, 'AVATAR_CONNECT_FAILED', '星云连接未完成，已回退原有角色。本进程停止继续创建会话；已发出的请求可能消耗积分。');
      }
    },
    async stop(owner: string, id: string) {
      prune();
      const attempt = attempts.get(key(owner, id));
      if (attempt) await closeAttempt(attempt);
      else if (attempts.size < 512) attempts.set(key(owner, id), { owner, id, closed: true, until: Date.now() + AVATAR_SECONDS * 2000 });
      // Remember stops even before the SDK's POST arrives.
      return { stopped: true };
    },
    async dispose() { await Promise.allSettled([...attempts.values()].map(closeAttempt)); attempts.clear(); },
  };
}
