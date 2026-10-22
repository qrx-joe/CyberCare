import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = '.local/validation/home-login-a11y-20261022';

// Use the actual rendered foreground and nearest opaque background. Complex paints
// remain unresolved instead of being treated as passing contrast checks.
async function inspectCharacters(page, selectors) {
  return page.evaluate(selectors => selectors.flatMap(selector => [...document.querySelectorAll(selector)]
    .filter(element => element.checkVisibility({ visibilityProperty: true }))
    .map(element => {
      const style = getComputedStyle(element);
      let backgroundColor = null, unresolved = null;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const paint = getComputedStyle(ancestor);
        if (paint.backgroundImage !== 'none' || paint.opacity !== '1') { unresolved = 'Complex paint requires separate review'; break; }
        const rgba = paint.backgroundColor.match(/[\d.]+/g)?.map(Number);
        if (rgba?.length === 3 || rgba?.[3] === 1) { backgroundColor = paint.backgroundColor; break; }
        if (rgba?.[3] !== 0) { unresolved = 'Translucent background requires separate review'; break; }
      }
      const luminance = color => {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const foreground = luminance(style.color), background = backgroundColor ? luminance(backgroundColor) : null;
      const box = element.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      return { selector, text: element.textContent, foregroundColor: style.color, backgroundColor, unresolved,
        ratio: background === null ? null : (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05),
        fontSize: style.fontSize, lineHeight: style.lineHeight,
        textWithinBox: text.left >= box.left && text.right <= box.right && text.top >= box.top && text.bottom <= box.bottom };
    })), selectors);
}

async function audit(page) {
  return page.evaluate(async () => {
    const result = await window.axe.run();
    const details = items => items.map(({ id, impact, nodes }) => ({ id, impact,
      nodes: nodes.map(({ target, html, failureSummary, any, all, none }) => ({ target, html, failureSummary, checks: [...any, ...all, ...none] })) }));
    return { engine: result.testEngine, violations: details(result.violations), incomplete: details(result.incomplete) };
  });
}

for (const width of [1440, 390, 320]) test(`首页和演示登录字符复核：${width}px，保留 axe incomplete`, async ({ page }) => {
  test.setTimeout(90000);
  await mkdir(directory, { recursive: true });
  await page.goto('/');
  await expect(page.locator('#transcript')).toHaveValue(/一起读书/);
  await page.setViewportSize({ width, height: 960 });
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js', 'utf8'));
  const reports = [];
  for (const fontSize of ['100%', '200%']) {
    await page.locator('html').evaluate((element, value) => { element.style.fontSize = value; }, fontSize);
    for (const view of ['home', 'login-xiaohe', 'login-acheng']) {
      if (view === 'home') {
        await expect(page.locator('#learn-open')).toHaveAccessibleName('花 30 秒了解一下');
        await expect(page.locator('#account-open')).toHaveAccessibleName('演示登录');
      } else {
        if (view === 'login-xiaohe') await page.locator('#account-open').click();
        else await page.locator('.identity-option:has(input[value="acheng"])').click();
        await expect(page.locator('#login-dialog')).toHaveAccessibleName('这次，怎么称呼你？');
        await expect(page.locator('#login-close')).toHaveAccessibleName('关闭演示登录');
        await expect(page.getByRole('radio', { name: '小禾 先从一件小事开始', exact: true })).toHaveCount(1);
        await expect(page.getByRole('radio', { name: '阿澄 让信息更容易被读到', exact: true })).toHaveCount(1);
        await expect(page.locator(`input[value="${view === 'login-xiaohe' ? 'xiaohe' : 'acheng'}"]`)).toBeChecked();
      }
      const selectors = view === 'home' ? ['#hero-task > span', '#hero-example > span', '#learn-open > span', '#account-avatar']
        : ['.identity-avatar', '.identity-check', '#login-close'];
      await page.mouse.move(0, 0);
      const characters = await inspectCharacters(page, selectors);
      const result = await audit(page);
      const control = page.locator(view === 'home' ? '#learn-open' : '#login-close');
      await control.hover();
      const hoverCharacters = await inspectCharacters(page, [view === 'home' ? '#learn-open > span' : '#login-close']);
      const names = view === 'home' ? await page.locator('.hero-primary-actions').ariaSnapshot() : await page.locator('#login-dialog').ariaSnapshot();
      reports.push({ width, fontSize, view, ...result, characters, hoverCharacters, names });
      await page.screenshot({ path: `${directory}/${view}-${width}-${fontSize}.png` });
      // Persist raw incomplete results, including unexpected items; never filter them
      // away or assert that an empty violations list proves full accessibility.
      await writeFile(`${directory}/review-${width}.json`, JSON.stringify(reports, null, 2));
      expect(result.violations, `${view} / ${fontSize}`).toEqual([]);
      for (const character of [...characters, ...hoverCharacters]) {
        expect(character.unresolved, character.selector).toBeNull();
        expect(character.ratio, `${character.selector}: ${character.foregroundColor} / ${character.backgroundColor}`).toBeGreaterThanOrEqual(4.5);
        if (character.selector === '.identity-avatar' || character.selector === '#account-avatar') expect(character.textWithinBox, `头像 ${character.text} 在 ${fontSize} 下不得溢出背景`).toBe(true);
      }
      expect(await page.locator('html').evaluate(element => element.scrollWidth <= innerWidth)).toBe(true);
      if (view !== 'home') expect(await page.locator('#login-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.locator('#login-close').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#login-dialog')).toBeHidden();
    await expect(page.locator('#account-open')).toBeFocused();
  }
  // The header uses a single character after choosing an identity as well.
  for (const [profile, name] of [['xiaohe', '小禾'], ['acheng', '阿澄']]) {
    await page.locator('#account-open').click();
    await page.locator(`.identity-option:has(input[value="${profile}"])`).click();
    await page.locator('#login-submit').click();
    await page.locator('#nav-home').click();
    await expect(page.locator('#account-open')).toHaveAccessibleName(`${name}的工作台，演示身份`);
    const characters = await inspectCharacters(page, ['#account-avatar']);
    reports.push({ width, fontSize: '200%', view: `home-${profile}`, characters });
    await writeFile(`${directory}/review-${width}.json`, JSON.stringify(reports, null, 2));
    expect(characters).toHaveLength(1);
    expect(characters[0].unresolved).toBeNull();
    expect(characters[0].ratio).toBeGreaterThanOrEqual(4.5);
    expect(characters[0].textWithinBox, `首页头像 ${name} 不得溢出底色`).toBe(true);
    await page.locator('#account-open').click();
    await page.locator('#profile-logout').click();
    await page.locator('#nav-home').click();
  }
});
