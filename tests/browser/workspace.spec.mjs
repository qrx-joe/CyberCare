import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = '.local/validation/product-ui-20261022';
const identityKey = 'cybercare.demo-identity.v1';
const preferencesKey = 'cybercare.reading-preferences.v1';
const ready = async page => expect(page.locator('#transcript')).toHaveValue(/一起读书/);
async function login(page, name = 'acheng') {
  await page.locator('#account-open').click();
  await page.locator(`.identity-option:has(input[value="${name}"])`).click();
  await page.locator('#login-submit').click();
  await expect(page.locator('#login-dialog')).not.toBeVisible();
  await expect(page.locator('#my-page')).toBeVisible();
}

test('页面导航和浏览器历史保留脏草稿；演示身份不会改变任务、权限或检测门禁', async ({ page, context }) => {
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.method()); });
  await page.goto('/'); await ready(page);
  await expect(page.locator('[data-page]:visible')).toHaveCount(1);
  await expect(page.locator('#task-station')).toBeHidden();
  await page.locator('#nav-task').click();
  await expect(page).toHaveTitle('海报工作台 · 赛博公益');
  await expect(page.locator('#nav-task')).toHaveAttribute('aria-current', 'page');
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  const id = (await page.locator('#task-meta').textContent()).match(/[a-f0-9-]{36}/)[0];
  const originalLocation = await page.locator('#fact-location').inputValue();
  await page.locator('#fact-location').fill('只留在本页的未保存修改');
  await page.locator('#nav-me').click();
  await expect(page.locator('#session-state')).toHaveText('等待核对');
  await expect(page.locator('#session-expiry')).toContainText('到期');
  await login(page);
  await expect(page.locator('#profile-name')).toContainText('阿澄');
  await page.locator('#nav-home').click(); await expect(page.locator('#home-page')).toBeVisible();
  await page.goBack(); await expect(page.locator('#my-page')).toBeVisible();
  await expect(page.locator('#nav-me')).toHaveAttribute('aria-current', 'page');
  await page.locator('#session-continue').click();
  await expect(page.locator('#fact-location')).toHaveValue('只留在本页的未保存修改');
  await expect(page.locator('#audit')).toBeDisabled();
  await expect(page.locator('#confirm')).toBeDisabled();
  await page.locator('#nav-me').click(); await page.locator('#profile-logout').click();
  await expect(page.locator('#account-label')).toHaveText('演示登录');
  await expect(page.locator('#session-state')).toHaveText('等待核对');
  await page.locator('#session-continue').click();
  await expect(page.locator('#fact-location')).toHaveValue('只留在本页的未保存修改');
  const task = await (await context.request.get(`/api/tasks/${id}`)).json();
  expect(task.revision).toBe(1); expect(task.values.location).toBe(originalLocation);
  expect(writes).toEqual(['POST']);
  const stranger = await context.browser().newContext();
  expect((await stranger.request.get(`http://127.0.0.1:4311/api/tasks/${id}`)).status()).toBe(404);
  await stranger.close();
  await page.locator('#delete').click(); await page.locator('#nav-me').click();
  await expect(page.locator('#session-state')).toHaveText('尚未开始');
  await expect(page.locator('#session-expiry')).toBeHidden();
  expect(errors).toEqual([]);
});

test('身份仅在标签页恢复，阅读偏好可恢复；刷新不恢复任务且存储不含材料', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/'); await ready(page); await login(page, 'xiaohe');
  await page.locator('#preference-large').check();
  await page.locator('#preference-motion').check();
  await expect(page.locator('html')).toHaveClass('large');
  await expect(page.locator('#large')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#host-motion')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#session-continue').click();
  await page.locator('#mode').selectOption('manual');
  await page.locator('#transcript').fill('活动名称：合成隐私检查-只存内存');
  await page.locator('#source-note').fill('合成来源-禁止持久化');
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  const stored = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(stored).toEqual({ local: { [preferencesKey]: JSON.stringify({ version: 1, large: true, reduceMotion: true }) }, session: { [identityKey]: JSON.stringify({ version: 1, profile: 'xiaohe' }) } });
  await page.reload(); await ready(page);
  await expect(page.locator('#draft')).toBeHidden();
  await expect(page.locator('html')).toHaveClass('large');
  await page.locator('#account-open').click();
  await expect(page.locator('#profile-name')).toContainText('小禾');
  await expect(page.locator('#session-state')).toHaveText('尚未开始');
  await page.locator('#profile-logout').click(); await page.reload(); await ready(page);
  await expect(page.locator('#profile-name')).toContainText('来访的朋友');
  await expect(page.locator('#preference-large')).toBeChecked();
  const otherTab = await context.newPage(); await otherTab.goto('/#me'); await ready(otherTab);
  await expect(otherTab.locator('#profile-name')).toContainText('来访的朋友');
  await otherTab.close();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#preference-motion')).toBeDisabled();
  await expect(page.locator('#preference-motion-help')).toContainText('跟随系统');
});

test('演示登录支持键盘、Esc、遮罩关闭和游客继续；不发生身份 API 请求', async ({ page }) => {
  const writes = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('/'); await ready(page);
  await page.locator('#account-open').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('input[value="xiaohe"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#login-submit')).toContainText('阿澄');
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('#login-dialog').contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#login-dialog')).not.toBeVisible();
  await expect(page.locator('#account-open')).toBeFocused();
  await page.locator('#account-open').click(); await page.locator('#login-guest').click();
  await expect(page.locator('#account-label')).toHaveText('演示登录');
  await page.locator('#account-open').click(); await page.mouse.click(2, 2);
  await expect(page.locator('#login-dialog')).not.toBeVisible();
  expect(writes).toEqual([]);
});

test('存储损坏或被浏览器禁止时有退路，仍可切页和使用演示身份', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ identityKey, preferencesKey }) => {
    sessionStorage.setItem(identityKey, '{broken');
    localStorage.setItem(preferencesKey, JSON.stringify({ version: 1, large: 'yes', reduceMotion: false }));
  }, { identityKey, preferencesKey });
  await page.goto('/#me'); await ready(page);
  await expect(page.locator('#profile-name')).toContainText('来访的朋友');
  await expect(page.locator('#preference-large')).not.toBeChecked();
  await page.evaluate(() => {
    for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new DOMException('Synthetic blocked storage', 'SecurityError'); };
  });
  await login(page);
  await expect(page.locator('#profile-name')).toContainText('阿澄');
  await expect(page.locator('#workspace-message')).toContainText('浏览器未允许保存');
  await page.locator('#preference-large').check(); await expect(page.locator('html')).toHaveClass('large');
  await page.locator('#profile-logout').click(); await page.locator('#session-continue').click();
  await expect(page.locator('#task-station')).toBeVisible();
  await expect(page.locator('#create')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('在个人页面等待到期后，任务入口同步清空且不留下历史记录', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#workbench'); await ready(page);
  await page.locator('#permission').check(); await page.locator('#create').click();
  await expect(page.locator('#draft')).toBeVisible();
  await page.locator('#nav-me').click(); await expect(page.locator('#session-state')).toHaveText('等待核对');
  await page.clock.fastForward(31 * 60 * 1000);
  await expect(page.locator('#session-state')).toHaveText('尚未开始');
  await expect(page.locator('#session-expiry')).toBeHidden();
  await page.locator('#session-continue').click();
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#original')).toBeEmpty();
});

test('三个页面与登录弹窗在窄屏、大字下无横向溢出，axe 保留未覆盖项', async ({ page }) => {
  test.setTimeout(90000);
  await mkdir(directory, { recursive: true });
  await page.goto('/'); await ready(page);
  await page.evaluate(await readFile('node_modules/axe-core/axe.min.js', 'utf8'));
  const audits = [];
  for (const view of ['home', 'workbench', 'me', 'login']) {
    if (view === 'login') await page.locator('#account-open').click();
    else await page.locator(`#nav-${view === 'workbench' ? 'task' : view}`).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (view === 'login') expect(await page.locator('#login-dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await page.screenshot({ path: `${directory}/${view}-${width}.png` });
    }
    await page.locator('html').evaluate(e => { e.style.fontSize = '200%'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (view === 'login') expect(await page.locator('#login-dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    const audit = await page.evaluate(async () => {
      const result = await window.axe.run();
      const details = items => items.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
      return { violations: details(result.violations), incomplete: details(result.incomplete) };
    });
    audits.push({ view, ...audit });
    await page.locator('html').evaluate(e => { e.style.fontSize = ''; });
  }
  await writeFile(`${directory}/page-audits.json`, JSON.stringify(audits, null, 2));
  for (const audit of audits) expect(audit.violations, audit.view).toEqual([]);
});
