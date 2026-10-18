import { chromium, type Browser } from 'playwright-core';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { AppError, type Audit, type Input } from './contracts.js';
import { hash } from './domain.js';
import { validateImage } from './service.js';
const require = createRequire(import.meta.url);

export function chromePath() {
  return [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', chromium.executablePath()].find(p => p && existsSync(p));
}
export function createAuditor() {
  let browserPromise: Promise<Browser> | undefined;
  let running = false;
  async function openBrowser() {
    const executablePath = chromePath();
    if (!executablePath) throw new AppError(503, 'BROWSER_MISSING', '未发现 Chrome/Edge；请通过 CHROME_PATH 指定已有浏览器后重启。');
    browserPromise ??= chromium.launch({ executablePath, headless: true });
    return browserPromise;
  }
  return {
    async decodeImage(image: NonNullable<Input['image']>) {
      validateImage(image);
      if (running) throw new AppError(429, 'AUDIT_BUSY', '图片检查或 HTML 检测正在运行，请稍后重试。');
      running = true;
      let context;
      try {
        context = await (await openBrowser()).newContext({ offline: true });
        const page = await context.newPage();
        const valid = await page.evaluate(async ({ mime, data }) => {
          const img = new Image(); img.src = `data:${mime};base64,${data}`;
          try { await img.decode(); return img.naturalWidth > 0 && img.naturalHeight > 0; } catch { return false; }
        }, image);
        if (!valid) throw new AppError(415, 'IMAGE_DECODE', '图片无法实际解码，请重新导出后上传。');
      } catch (e) {
        if (e instanceof AppError) throw e;
        if (browserPromise) await browserPromise.then(b => b.close()).catch(() => {});
        browserPromise = undefined;
        throw new AppError(503, 'IMAGE_CHECK_FAILED', '图片解码检查未完成，请检查已有浏览器配置。');
      } finally { await context?.close(); running = false; }
    },
    async run(html: string, revision: number): Promise<Audit> {
      if (running) throw new AppError(429, 'AUDIT_BUSY', '另一项检测正在运行，请稍后再试。');
      running = true;
      try {
        const browser = await openBrowser();
        const context = await browser.newContext({ offline: true });
        try {
          const page = await context.newPage();
          await page.setContent(html, { timeout: 15000 });
          await page.addScriptTag({ content: await readFile(require.resolve('axe-core/axe.min.js'), 'utf8') });
          const result = await page.evaluate(async () => {
            const axe = (window as unknown as { axe: typeof import('axe-core') }).axe;
            const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
            return { engine: `axe-core ${r.testEngine.version}`, violations: r.violations.map(v => ({ id: v.id, impact: v.impact ?? null, help: v.help, nodes: v.nodes.length })), incomplete: r.incomplete.map(v => ({ id: v.id, help: v.help, nodes: v.nodes.length })), passes: r.passes.length };
          });
          return { ...result, revision, htmlHash: hash(html), at: new Date().toISOString() };
        } finally { await context.close(); }
      } catch (e) {
        if (e instanceof AppError) throw e;
        if (browserPromise) await browserPromise.then(b => b.close()).catch(() => {});
        browserPromise = undefined;
        throw new AppError(503, 'AUDIT_FAILED', '自动检测未完成；不能把检测失败写成零问题。请检查浏览器路径后重试。');
      } finally { running = false; }
    },
    async close() { if (browserPromise) await browserPromise.then(b => b.close()).catch(() => {}); },
  };
}
