import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

const hasAtlas = existsSync('.local/avatar/character-atlas-v1.png');
const pixels = async page => page.locator('#avatar-canvas').evaluate(canvas => {
  const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let hash = 2166136261;
  for (let i=0;i<data.length;i+=4) hash = Math.imul(hash ^ (data[i] + data[i+1]*7 + data[i+2]*13 + data[i+3]*17),16777619);
  return hash >>> 0;
});

test('角色真实像素帧变化：自动眨眼、台词演绎、低头；背景卡片不动', async ({ page }) => {
  test.skip(!hasAtlas, 'Generated local avatar atlas is absent; only reference/text fallback is available.');
  await page.goto('/');
  await expect(page.locator('#avatar-animation')).toBeVisible();
  await expect(page.locator('#character-image')).toBeHidden();
  await expect(page.locator('#avatar-kind')).toContainText('本地帧动画');
  await expect(page.locator('#character-frame')).toHaveAttribute('data-avatar-state','idle');
  const neutral = await pixels(page);
  expect(await page.locator('#character-frame').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
  expect(await page.locator('#avatar-body').evaluate(e => getComputedStyle(e).animationName)).toBe('avatar-breathe');
  await page.waitForFunction(() => document.querySelector('#character-frame').dataset.avatarFrame === '2', { }, { timeout:8000 });
  expect(await pixels(page)).not.toBe(neutral);
  await page.locator('#host-banter').click();
  await page.waitForFunction(() => document.querySelector('#character-frame').dataset.avatarState === 'talking' && document.querySelector('#character-frame').dataset.avatarFrame === '4');
  expect(await pixels(page)).not.toBe(neutral);
  await page.locator('#host-bow').click();
  await page.waitForFunction(() => document.querySelector('#character-frame').dataset.avatarFrame === '6');
  expect(await pixels(page)).not.toBe(neutral);
  await expect(page.locator('#character-frame')).toHaveAttribute('data-avatar-state','idle');
});

test('动画可暂停、离屏停止、恢复；减少动态时只保留静态与文字', async ({ page }) => {
  test.skip(!hasAtlas, 'Generated local avatar atlas is absent.');
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(...args) {
      this.canvas.dataset.drawCalls = String(Number(this.canvas.dataset.drawCalls || 0) + 1);
      return original.apply(this,args);
    };
  });
  await page.goto('/'); await expect(page.locator('#avatar-animation')).toBeVisible();
  await page.locator('#host-motion').click();
  await expect(page.locator('#character-frame')).toHaveAttribute('data-avatar-state','paused');
  await page.locator('#host-banter').click();
  const draws = await page.locator('#avatar-canvas').getAttribute('data-draw-calls');
  await page.waitForTimeout(500); // Verify a paused interval, not just a state label.
  // Chrome can change readback colors after its first GPU→CPU canvas read.
  // No redraws, neutral frame and no CSS animation test the actual pause contract.
  expect(await page.locator('#avatar-canvas').getAttribute('data-draw-calls')).toBe(draws);
  await expect(page.locator('#character-frame')).toHaveAttribute('data-avatar-frame','0');
  expect(await page.locator('#avatar-body').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
  await page.locator('#host-motion').click();
  await expect(page.locator('#character-frame')).toHaveAttribute('data-motion','on');
  await page.locator('#input-title').scrollIntoViewIfNeeded();
  await expect(page.locator('#character-frame')).toHaveAttribute('data-avatar-state','paused');
  await page.locator('#host-motion').scrollIntoViewIfNeeded();
  await expect(page.locator('#character-frame')).toHaveAttribute('data-motion','on');
  await page.emulateMedia({ reducedMotion:'reduce' });
  await expect(page.locator('#host-motion')).toBeDisabled();
  await expect(page.locator('#host-motion')).toHaveAttribute('aria-pressed','false');
  await page.locator('#host-bow').click();
  await expect(page.locator('#character-frame')).toHaveAttribute('data-avatar-frame','0');
  expect(await page.locator('#avatar-body').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
});
