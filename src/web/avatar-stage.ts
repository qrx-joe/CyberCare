interface AvatarSdk {
  init(options: { onDownloadProgress(progress: number): void }): Promise<unknown>;
  speak(text: string, start: boolean, end: boolean): void;
  setVolume(volume: number): void;
  interactiveidle(): void;
  destroy(reason?: string): Promise<unknown> | void;
}
declare global { interface Window { XingyunAvatarAgent?: new (options: Record<string, unknown>) => AvatarSdk; } }
let sdk: AvatarSdk | undefined, attemptId = '', disposed = false, started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const send = (type: string, text?: string) => parent.postMessage({ source: 'cybercare-avatar', type, attemptId, text }, location.origin);
async function dispose() {
  if (disposed) return;
  disposed = true; clearTimeout(timer);
  try { sdk?.setVolume(0); sdk?.interactiveidle(); } catch { /* Initialization may not have reached a renderer. */ }
  try { await sdk?.destroy('cybercare_stop'); } catch { /* The parent also closes the owned session. */ }
}
function fail(error?: { code?: unknown; name?: unknown }) {
  if (disposed) return;
  const code = String(error?.code ?? error?.name ?? 'SDK_FAILURE');
  send('failed', /^[A-Za-z0-9_]{1,60}$/.test(code) ? code : 'SDK_FAILURE'); void dispose();
}
document.addEventListener('securitypolicyviolation', event => {
  let host = ''; try { host = new URL(event.blockedURI).hostname; } catch { host = event.blockedURI === 'inline' ? 'inline' : 'local-resource'; }
  send('diagnostic', `CSP ${event.effectiveDirective}: ${host}`);
});
const escapeXml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  const message = event.data;
  if (message?.type !== 'start' || attemptId || typeof message.text !== 'string' || message.text.length > 1200 || !/^[a-f0-9-]{36}$/.test(message.attemptId)) return;
  attemptId = message.attemptId;
  if (!window.XingyunAvatarAgent) { fail(); return; }
  timer = setTimeout(fail, 40000);
  try {
    sdk = new window.XingyunAvatarAgent({
      containerId: '#xingyun-stage', appId: 'cybercare-local', appSecret: 'server-signed',
      gatewayServer: new URL('./api/avatar/session', location.href).href,
      headers: { 'X-CyberCare': '1', 'X-CyberCare-Avatar': attemptId },
      enableLogger: false, enableClientInterrupt: true, sentry: { enabled: false },
      reconnect: { enabled: false }, audio: { inputEnabled: false },
      agentCallbacks: {
        onError: fail,
        onConversationChange(event: { state: string }) { if (!disposed && event.state === 'completed') { send('ended'); void dispose(); } },
      },
      onWidgetEvent() { /* Subtitles are rendered as plain text by the application. */ },
      onMessage(error: { code?: unknown }) { if (error.code !== 0 && error.code !== 50002) fail(error); },
      onVoiceStateChange(status: string) {
        if (disposed) return;
        if (status === 'start' || status === 'voice_start') send('speaking');
      },
    });
    void Promise.resolve(sdk.init({ onDownloadProgress(progress) { if (!disposed) send('progress', String(Math.round(progress))); } })).then(() => {
      if (disposed || started) return;
      started = true; clearTimeout(timer); send('submitted');
      // Escaping prevents poster text from becoming SSML commands or external resources.
      sdk!.speak(`<speak>${escapeXml(message.text)}</speak>`, true, true);
    }).catch(fail);
  } catch { fail(); }
});
window.addEventListener('pagehide', () => { void dispose(); });
export {};
