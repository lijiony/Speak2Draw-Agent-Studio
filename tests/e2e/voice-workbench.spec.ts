import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __speak2drawTest?: {
      submitTranscript: (text: string, confidence?: number) => void;
    };
  }
}

const openWorkbench = async (page: Page) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.goto('/?e2e=1');
  await expect(page.getByRole('heading', { name: '纯语音绘图工作台' })).toBeVisible();
  await expect(page.getByRole('button', { name: '启动语音监听' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__speak2drawTest))).toBe(true);
  return consoleErrors;
};

test('语音文本可以驱动复杂绘图和按名称编辑', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '画一个房子和太阳');
  await expect(systemFeedback(page)).toContainText('已拆解并执行 5 个绘图步骤。');
  await expect(page.locator('svg polygon')).toHaveCount(1);
  await expect(page.locator('svg circle[fill="#facc15"]')).toHaveCount(1);

  await submitVoiceText(page, '把太阳改成红色');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 5 个图形。');
  await expect(page.locator('svg circle[fill="#ef4444"]')).toHaveCount(1);
  await expect(page.locator('svg rect[fill="#fef3c7"]')).toHaveCount(1);

  expect(consoleErrors).toEqual([]);
});

test('语音文本归一化不会破坏文字输入', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '写名字');
  await expect(page.locator('svg text')).toContainText('名字');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 1 个图形。');

  expect(consoleErrors).toEqual([]);
});

test('移动端视口下核心面板仍然可见', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const consoleErrors = await openWorkbench(page);

  await expect(page.locator('section[aria-label="绘图画布"]')).toBeVisible();
  await expect(page.locator('aside[aria-label="语音状态"]')).toBeVisible();
  await expect(page.getByText('麦克风输入测试')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

const submitVoiceText = async (page: Page, text: string) => {
  await page.evaluate((value) => {
    window.__speak2drawTest?.submitTranscript(value);
  }, text);
};

const systemFeedback = (page: Page) =>
  page.locator('section.info-block').filter({ hasText: '系统反馈' }).locator('p');

const collectConsoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
};
