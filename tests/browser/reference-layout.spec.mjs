import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

test('工作台进度跟随真实状态；长结果、大字与窄屏不与页脚重叠', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  const evidenceDir = '.local/validation/reference-frontend-20261019';
  await mkdir(evidenceDir, { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.screenshot({ path: `${evidenceDir}/hero-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js', 'utf8'));
  const audit = await page.evaluate(async () => {
    const result = await window.axe.run();
    const details = items => items.map(item => ({ id: item.id, impact: item.impact,
      nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
    return { violations: details(result.violations), incomplete: details(result.incomplete) };
  });
  await writeFile(`${evidenceDir}/page-axe-details.json`, JSON.stringify(audit, null, 2));
  expect(audit.violations).toEqual([]);
  await expect(page.locator('#step-input')).toHaveAttribute('aria-current', 'step');
  await page.locator('#mode').selectOption('manual');
  const longText = `活动名称：合成长海报排版检查\n活动说明：${'这是一段开发者编写的合成材料，用于检查长文字换行和结果容器，不代表真实活动或用户反馈。'.repeat(120)}\n`;
  await page.locator('#transcript').fill(longText);
  await page.locator('#source-note').fill('开发者原创合成长文本，仅用于布局回归');
  await page.locator('#permission').check();
  await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  await expect(page.locator('#empty')).toBeHidden();
  expect(await page.locator('#empty').evaluate(e => getComputedStyle(e).display)).toBe('none');
  await expect(page.locator('#step-review')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#step-input')).not.toHaveAttribute('aria-current');
  await expect(page.locator('#desk-status')).toHaveText('等待人工核对');
  await expect(page.locator('#fact-time')).toHaveValue('');
  await expect(page.locator('#confirm')).toBeDisabled();
  await page.locator('#draft > details summary').click();
  await expect(page.locator('#original')).toHaveText(longText.trim());
  await page.locator('#draft > details summary').click();
  await page.locator('#audit').click();
  await expect(page.locator('#audit-output')).toContainText('Critical 0 / Serious 0');
  await expect(page.locator('#confirm')).toBeDisabled();
  for (const key of ['title', 'time', 'location', 'registration']) await page.locator(`#checked-${key}`).check();
  await page.locator('#confirm-content').check();
  await page.locator('#confirm').click();
  await expect(page.locator('#completed')).toBeVisible();
  await expect(page.locator('#step-export')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#desk-status')).toHaveText('已确认，可导出');
  await expect(page.locator('#final-text')).toContainText(longText.trim());
  await expect(page.locator('#final-text')).toContainText('未知，请向活动方核实');
  await page.locator('#large').click();
  await expect(page.locator('html')).toHaveClass('large');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    const bounds = await page.locator('#final-text').evaluate(e => {
      const result = e.getBoundingClientRect(), panel = e.closest('.result-panel').getBoundingClientRect();
      return { contained: result.left >= panel.left && result.right <= panel.right && result.bottom <= panel.bottom,
        footerBelow: document.querySelector('footer').getBoundingClientRect().top >= result.bottom,
        noOverflow: document.documentElement.scrollWidth <= innerWidth };
    });
    expect(bounds).toEqual({ contained: true, footerBelow: true, noOverflow: true });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#result-title').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidenceDir}/long-result-320-large.png` });
  await page.locator('#delete').click();
  await expect(page.locator('#step-input')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#step-export')).not.toHaveAttribute('aria-current');
  await expect(page.locator('#desk-status')).toHaveText('等待提交材料');
  await expect(page.locator('#final-text')).toBeEmpty();
});
