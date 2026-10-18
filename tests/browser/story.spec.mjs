import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

test('抽象入口：2D 动作复位、预设互动、科普到海报任务，零外部模型请求', async ({ page, context }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await expect(page.locator('h1')).toContainText('听我把话说完');
  await expect(page.locator('#host-disclosure')).toContainText('不是实时 AI 对话');
  await page.locator('#host-bow').click(); await expect(page.locator('#host-speech')).toContainText('才艺结束');
  await expect(page.locator('#character-frame')).toHaveClass(/bowing/);
  await expect(page.locator('#character-frame')).not.toHaveClass(/bowing/);
  await page.locator('#host-bow').click(); await expect(page.locator('#host-speech')).toContainText('先不磕了');
  await expect(page.locator('#character-frame')).toHaveClass(/bowing/);
  await expect(page.locator('#character-frame')).not.toHaveClass(/bowing/);
  await page.locator('#host-motion').click(); await expect(page.locator('#host-motion')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#host-bow').click(); await expect(page.locator('#character-frame')).not.toHaveClass(/bowing/);
  await page.locator('#host-banter').click(); await expect(page.locator('#host-speech')).not.toHaveText('先不磕了。你先帮我核对一条信息，再说。');
  await page.locator('#learn-open').click(); await expect(page.locator('#quick-learn')).toBeVisible();
  await expect(page.locator('#learn-title')).toBeFocused();
  await page.locator('#learn-next').click(); await expect(page.locator('#learn-index')).toContainText('2 / 3');
  await page.locator('#learn-next').click(); await expect(page.locator('#learn-index')).toContainText('3 / 3');
  await expect(page.locator('#learn-source')).toHaveAttribute('href', 'https://www.w3.org/WAI/test-evaluate/');
  await page.locator('#learn-task').click(); await expect(page.locator('#input-title')).toBeFocused();
  const config = await (await context.request.get('/api/config')).json(); expect(config.provider.requests).toBe(0);
  expect(errors).toEqual([]);
});

test('减少动态与参考图缺失均可继续文字任务；科普展开后整页 axe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/reference-poster.jpg', route => route.abort());
  // Simulate both optional local visual assets being unavailable.
  await page.route('**/host.js', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, '');
    await route.fulfill({ response, body:source });
  });
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await expect(page.locator('#character-fallback')).toBeVisible();
  await expect(page.locator('#host-motion')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#host-bow').click(); await expect(page.locator('#character-frame')).not.toHaveClass(/bowing/);
  expect(await page.locator('#character-frame').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
  await page.locator('#nav-learn').click(); await expect(page.locator('#quick-learn')).toBeVisible();
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js', 'utf8'));
  const axe = await page.evaluate(async () => { const result = await window.axe.run(); return { violations: result.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })), incomplete: result.incomplete.map(v => v.id) }; });
  await mkdir('.local/validation', { recursive: true });
  await writeFile('.local/validation/story-axe.json', JSON.stringify(axe, null, 2));
  expect(axe.violations).toEqual([]);
  await page.locator('#hero-task').click(); await expect(page.locator('#input-title')).toBeFocused();
  await page.locator('#permission').check(); await page.locator('#create').click(); await expect(page.locator('#draft')).toBeVisible();
});
