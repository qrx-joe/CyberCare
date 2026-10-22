import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

const hasAtlas = existsSync('.local/avatar/character-atlas-v1.png');
const hasKowtow = existsSync('.local/avatar/character-kowtow-v1.png');
const pixels = async page => page.locator('#avatar-canvas').evaluate(canvas => {
  const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let hash = 2166136261;
  for (let i=0;i<data.length;i+=4) hash = Math.imul(hash ^ (data[i] + data[i+1]*7 + data[i+2]*13 + data[i+3]*17),16777619);
  return hash >>> 0;
});

test('角色真实像素帧变化：自动眨眼、台词演绎；背景卡片不动', async ({ page }) => {
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
  await expect(page.locator('#character-frame')).toHaveAttribute('data-avatar-state','idle');
});

test('磕头完整俯身触地后复位；重复点击、打断与减少动态不遗留动作', async ({ page }) => {
  test.skip(!hasAtlas || !hasKowtow, 'Generated local expression/kowtow atlas is absent.');
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.goto('/');
  await expect(page.locator('#avatar-animation')).toBeVisible();
  await expect(page.locator('#bow-kind')).toHaveText('2D 磕头');
  const frame = page.locator('#character-frame');
  const silhouette = () => page.locator('#avatar-canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let top = canvas.height, bottom = 0;
    for (let y=0;y<canvas.height;y++) for (let x=0;x<canvas.width;x++) {
      if (data[(y*canvas.width+x)*4+3] > 64) { top = Math.min(top,y); bottom = Math.max(bottom,y); }
    }
    return { top, height:bottom-top };
  });
  const upright = await silhouette();
  for (let repeat=0;repeat<2;repeat++) {
    await page.locator('#host-bow').click();
    await expect(frame).toHaveAttribute('data-avatar-sheet','kowtow');
    await page.waitForFunction(() => {
      const stage = document.querySelector('#character-frame');
      return stage.dataset.avatarSheet === 'kowtow' && stage.dataset.avatarFrame === '4';
    });
    await expect(page.locator('#bow-sound')).toBeVisible();
    const contact = await silhouette();
    expect(contact.top).toBeGreaterThan(upright.top + 100);
    expect(contact.height).toBeLessThan(upright.height * .8);
    expect(await page.locator('#avatar-body').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
    await expect(frame).toHaveAttribute('data-avatar-state','idle');
    await expect(frame).toHaveAttribute('data-avatar-sheet','expressions');
    await expect(frame).toHaveAttribute('data-avatar-frame','0');
    await expect(frame).not.toHaveClass(/bowing/);
    await expect(page.locator('#bow-sound')).toBeHidden();
  }
  await page.locator('#host-bow').click();
  await page.locator('#host-bow').click();
  await expect(frame).toHaveAttribute('data-avatar-state','bowing');
  await page.locator('#host-banter').click();
  await expect(frame).not.toHaveClass(/bowing/);
  await expect(page.locator('#bow-sound')).toBeHidden();
  await expect(frame).toHaveAttribute('data-avatar-sheet','expressions');
  await page.locator('#host-bow').click();
  await page.locator('#host-motion').click();
  await expect(frame).toHaveAttribute('data-avatar-state','paused');
  await expect(frame).not.toHaveClass(/bowing/);
  await expect(frame).toHaveAttribute('data-avatar-frame','0');
  await page.locator('#host-motion').click();
  await page.locator('#host-bow').click();
  await page.emulateMedia({ reducedMotion:'reduce' });
  await expect(frame).toHaveAttribute('data-avatar-state','paused');
  await expect(frame).not.toHaveClass(/bowing/);
  await expect(page.locator('#bow-sound')).toBeHidden();
  await expect(page.locator('#bow-kind')).toHaveText('文字互动');
});

test('缺磕头素材时保留表情动画，只做文字招呼', async ({ page }) => {
  test.skip(!hasAtlas, 'Generated local avatar atlas is absent.');
  await page.route('**/host.js', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/(const KOWTOW_ATLAS = )(['"])data:image\/png;base64,[A-Za-z0-9+/=]+\2/, '$1\'\'');
    await route.fulfill({ response, body:source });
  });
  await page.goto('/');
  await expect(page.locator('#avatar-animation')).toBeVisible();
  await expect(page.locator('#bow-kind')).toHaveText('文字互动');
  await page.locator('#host-bow').click();
  await expect(page.locator('#host-speech')).toContainText('动作先省了');
  await expect(page.locator('#character-frame')).not.toHaveClass(/bowing/);
  await expect(page.locator('#bow-sound')).toBeHidden();
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
  await page.locator('#nav-task').click();
  await expect(page.locator('#character-frame')).toHaveAttribute('data-avatar-state','paused');
  await page.locator('#nav-home').click();
  await page.locator('#host-motion').scrollIntoViewIfNeeded();
  await expect(page.locator('#character-frame')).toHaveAttribute('data-motion','on');
  await page.emulateMedia({ reducedMotion:'reduce' });
  await expect(page.locator('#host-motion')).toBeDisabled();
  await expect(page.locator('#host-motion')).toHaveAttribute('aria-pressed','false');
  await page.locator('#host-bow').click();
  await expect(page.locator('#character-frame')).toHaveAttribute('data-avatar-frame','0');
  expect(await page.locator('#avatar-body').evaluate(e => getComputedStyle(e).animationName)).toBe('none');
});
