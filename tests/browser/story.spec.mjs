import { test, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
const hasAtlas = existsSync('.local/avatar/character-atlas-v1.png');
const hasKowtow = hasAtlas && existsSync('.local/avatar/character-kowtow-v1.png');

test('角色入口：可用动作复位或文字退路、预设互动、科普到海报任务，零外部模型请求', async ({ page, context }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await expect(page.locator('#headline')).toContainText('听我把话说完');
  await expect(page.locator('#host-disclosure')).toContainText('不是实时 AI 对话');
  if (hasAtlas) await expect(page.locator('#avatar-animation')).toBeVisible();
  else await expect(page.locator('#character-fallback')).toBeVisible();
  for (const line of ['认真磕一个','再磕一个']) {
    await page.locator('#host-bow').click();
    if (hasKowtow) {
      await expect(page.locator('#host-speech')).toContainText(line);
      await expect(page.locator('#character-frame')).toHaveClass(/bowing/);
      await expect(page.locator('#character-frame')).not.toHaveClass(/bowing/);
    } else {
      await expect(page.locator('#host-speech')).toContainText('动作先省了');
      await expect(page.locator('#character-frame')).not.toHaveClass(/bowing/);
    }
  }
  if (hasAtlas) await page.locator('#host-motion').click();
  else await expect(page.locator('#host-motion')).toBeDisabled();
  await expect(page.locator('#host-motion')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#host-bow').click(); await expect(page.locator('#character-frame')).not.toHaveClass(/bowing/);
  await page.locator('#host-banter').click(); await expect(page.locator('#host-speech')).not.toContainText('动作先省了');
  await page.locator('#learn-open').click(); await expect(page.locator('#quick-learn')).toBeVisible();
  await expect(page.locator('#learn-title')).toBeFocused();
  await page.locator('#learn-next').click(); await expect(page.locator('#learn-index')).toContainText('2 / 3');
  await page.locator('#learn-next').click(); await expect(page.locator('#learn-index')).toContainText('3 / 3');
  await expect(page.locator('#learn-source')).toHaveAttribute('href', 'https://www.w3.org/WAI/test-evaluate/');
  await page.locator('#learn-task').click(); await expect(page.locator('#input-title')).toBeFocused();
  const config = await (await context.request.get('/api/config')).json(); expect(config.provider.requests).toBe(0);
  expect(errors).toEqual([]);
});

test('缺素材时停用动作并准确说明文字退路；减少动态与科普展开后整页 axe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/reference-poster.jpg', route => route.abort());
  // Simulate both optional local visual assets being unavailable.
  await page.route('**/host.js', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, '');
    await route.fulfill({ response, body:source });
  });
  await page.goto('/'); await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await expect(page.locator('#character-fallback')).toBeVisible();
  await expect(page.locator('#avatar-kind')).toContainText('文字角色');
  await expect(page.locator('#host-motion')).toBeDisabled();
  await expect(page.locator('#host-motion')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#host-bow')).toContainText('文字互动');
  await page.locator('#host-bow').click(); await expect(page.locator('#character-frame')).not.toHaveClass(/bowing/);
  await expect(page.locator('#host-speech')).toContainText('动作先省了');
  await page.emulateMedia({ reducedMotion:'reduce' });
  await expect(page.locator('#host-motion')).toBeDisabled();
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
