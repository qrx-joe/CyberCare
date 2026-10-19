import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProvider, ModelFailure } from '../dist/provider.js';
import { chromePath } from '../dist/audit.js';
import { posterCases, evaluationSuiteVersion } from '../tests/fixtures/poster-cases.mjs';
import { scoreFacts, requiresReview } from './evaluation-score.mjs';
import { evaluationPlan } from './evaluation-plan.mjs';

const { live, limit, samples, requestedCaseIds } = evaluationPlan(process.argv.slice(2), posterCases);
const directory = resolve('.local/validation/evaluation', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true });
const provider = createProvider({ ...process.env, MODEL_REQUEST_LIMIT: String(live ? limit : 0) });
const report = {
  createdAt: new Date().toISOString(), evaluationSuiteVersion, mode: live ? 'live-synthetic-vision' : 'offline-label-parser',
  material: '开发者原创合成材料；不是授权真实海报或目标用户测试',
  scope: '四字段保守文字匹配；不是全文正确率、完整无障碍评估、用户效果或社会影响',
  requestLimit: live ? limit : 0, actualRequests: 0, retries: 0,
  requestedCaseIds, plannedCaseIds: samples.map(sample => sample.id),
  status: 'running', stoppedReason: null, cases: [],
  counts: { 'known-match':0, 'known-mismatch':0, 'omitted-known':0, 'unknown-preserved':0, 'invented-known':0 },
  usageByRequest: [],
};
let browser;
try {
  if (live && !provider.info().live) {
    report.status = 'not-configured'; report.stoppedReason = '缺少项目 StepFun 配置；未发送请求，也未使用离线结果替代。';
    process.exitCode = 2;
  } else {
    let page;
    if (live) {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch({ executablePath: chromePath(), headless:true });
      page = await browser.newPage({ viewport:{width:900, height:1000}, deviceScaleFactor:1 });
      await page.route('**/*', route => route.abort());
    }
    for (const sample of samples) {
      const input = { mode:live ? 'live' : 'manual', permission:true, sourceNote:`开发者原创合成评估 ${sample.id}`, text:sample.text };
      if (page) {
        const text = sample.posterText ?? sample.text;
        const safe = text.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
        await page.setContent(`<html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;padding:60px;background:#fff;color:#13251c;font:30px/1.8 'Microsoft YaHei',sans-serif;white-space:pre-wrap">${safe}</body></html>`);
        await page.evaluate(() => document.fonts.ready);
        const bytes = await page.screenshot();
        await writeFile(resolve(directory, `${sample.id}.png`), bytes);
        input.image = { name:`${sample.id}.png`, mime:'image/png', data:bytes.toString('base64') };
      }
      try {
        const result = await provider.extract(input, new AbortController().signal);
        const score = scoreFacts(sample.expected, result.extraction.facts);
        report.cases.push({ id:sample.id, category:sample.category, score, extraction:result.extraction, provider:result.provider });
        for (const key of Object.keys(report.counts)) report.counts[key] += score.counts[key];
        if (live) report.usageByRequest.push({ id:sample.id, usage:result.provider.usage });
        if (requiresReview(score)) {
          report.status = 'needs-review'; report.stoppedReason = '出现已知字段错配、遗漏或未知字段被填值；停止本批，须人工对照图片核实。'; process.exitCode = 1; break;
        }
      } catch (error) {
        const diagnostic = error instanceof ModelFailure ? error.diagnostic : null;
        report.cases.push({ id:sample.id, category:sample.category, error:'提取失败、超时或结构不合法；不复制上游响应与凭据。', diagnostic });
        if (live && provider.info().requests > report.usageByRequest.length) report.usageByRequest.push({ id:sample.id, usage:diagnostic?.usage ?? null });
        report.status = 'failed'; report.stoppedReason = '首次调用失败即停止本批，无自动重试。'; process.exitCode = 1; break;
      }
    }
    if (report.status === 'running') report.status = 'completed';
  }
} catch {
  report.status = 'failed'; report.stoppedReason = '本地评估准备或浏览器失败；未自动重试。'; process.exitCode = 1;
} finally {
  await browser?.close();
  report.actualRequests = provider.info().requests;
  const counts = report.counts;
  report.denominators = { known:counts['known-match'] + counts['known-mismatch'] + counts['omitted-known'], unknown:counts['unknown-preserved'] + counts['invented-known'], failedCases:report.cases.filter(entry => entry.error).length };
  const file = resolve(directory, 'report.json');
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status:report.status, mode:report.mode, cases:report.cases.length, actualRequests:report.actualRequests, counts, denominators:report.denominators, stoppedReason:report.stoppedReason, report:file }, null, 2));
}
