import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __speak2drawTest?: {
      submitTranscript: (text: string, confidence?: number) => Promise<void>;
      getScene: () => { objects: Array<{ name: string; groupName?: string; partName?: string; kind: string; x: number; style: { fill: string } }> };
      getAiStatus: () => { state: string; message: string };
      getClarification: () => { originalTranscript: string; question: string } | null;
      getVoiceDiagnostics: () => { policyMode: string; phase: string; interimText: string | null; finalText: string | null };
      getWorkbenchLayout: () => 'focus' | 'side-inspector' | 'bottom-inspector';
      getSettings: () => { aiModel: string; aiBaseUrl: string; sessionKeyConfigured: boolean; voicePolicyMode: string; aiFallbackEnabled: boolean };
    };
  }
}

const openWorkbench = async (page: Page, query = 'e2e=1') => {
  const consoleErrors = collectConsoleErrors(page);
  await page.goto(`/?${query}`);
  await expect(page.getByRole('heading', { name: '纯语音绘图工作台' })).toBeVisible();
  await expect(page.getByRole('button', { name: '启动语音监听' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__speak2drawTest))).toBe(true);
  return consoleErrors;
};

test('导航页两个入口按钮都可以进入语音绘图工作台', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto('/');
  await expect(page.locator('main[aria-label="Speak2Draw 导航页"]')).toBeVisible();
  await expect(page.locator('.landing-nav')).toContainText('S2D');
  await expect(page.locator('.landing-nav')).toContainText('canan');
  await expect(page.getByRole('heading', { name: 'AI 语音绘图工具' })).toBeVisible();
  await expect(page.locator('.landing-primary-button')).toContainText(/Speak2Draw-\s*Agent-Studio/);
  await expect(page.locator('.landing-info-panel')).not.toHaveClass(/is-open/);
  await page.locator('.landing-ink-card').click();
  await expect(page.locator('.landing-info-panel')).toHaveClass(/is-open/);
  await expect(page.locator('.landing-info-panel article')).toHaveCount(4);
  await page.getByRole('button', { name: '关闭产品信息面板' }).click();
  await expect(page.locator('.landing-info-panel')).not.toHaveClass(/is-open/);
  await expect(page.locator('.landing-nav button, .landing-primary-button')).toHaveCount(2);

  await page.getByRole('button', { name: '进入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '纯语音绘图工作台' })).toBeVisible();
  await expect(page.getByRole('button', { name: '启动语音监听' })).toBeVisible();

  await page.goto('/');
  await expect(page.locator('main[aria-label="Speak2Draw 导航页"]')).toBeVisible();
  await page.locator('.landing-primary-button').click();
  await expect(page.getByRole('heading', { name: '纯语音绘图工作台' })).toBeVisible();
  await expect(page.getByRole('button', { name: '启动语音监听' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('语音端点策略可以通过 URL 切换到耐心模式', async ({ page }) => {
  const consoleErrors = await openWorkbench(page, 'e2e=1&voicePolicy=patient');

  expect(await page.evaluate(() => window.__speak2drawTest?.getVoiceDiagnostics())).toMatchObject({
    policyMode: 'patient',
    phase: 'idle'
  });
  expect(consoleErrors).toEqual([]);
});

test('语音端点策略按钮可以即时切换实际策略', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.getByRole('button', { name: /^fast$/ }).click();
  await expect.poll(() => page.evaluate(() => window.__speak2drawTest?.getVoiceDiagnostics().policyMode)).toBe('fast');

  await page.getByRole('button', { name: /^patient$/ }).click();
  await expect.poll(() => page.evaluate(() => window.__speak2drawTest?.getVoiceDiagnostics().policyMode)).toBe('patient');

  await page.getByRole('button', { name: /^balanced$/ }).click();
  await expect.poll(() => page.evaluate(() => window.__speak2drawTest?.getVoiceDiagnostics().policyMode)).toBe('balanced');
  expect(consoleErrors).toEqual([]);
});

test('语音启动长时间无回调时会恢复为可重试错误', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.getByRole('button', { name: '启动语音监听' }).click();
  await expect(page.locator('header').getByText('语音识别启动超时')).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('button', { name: '启动语音监听' })).toBeEnabled();
  expect(await page.evaluate(() => window.__speak2drawTest?.getVoiceDiagnostics().phase)).toBe('error');
  expect(consoleErrors).toEqual([]);
});

test('语音文本可以驱动复杂绘图和按名称编辑', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);
  expect(await page.evaluate(() => window.__speak2drawTest?.getVoiceDiagnostics())).toMatchObject({
    policyMode: 'balanced',
    phase: 'idle'
  });

  await submitVoiceText(page, '画一个房子和太阳');
  await expect(systemFeedback(page)).toContainText('已拆解并执行 5 个绘图步骤。');
  await expect(page.locator('svg polygon')).toHaveCount(1);
  await expect(page.locator('svg circle[fill="#facc15"]')).toHaveCount(1);

  await submitVoiceText(page, '把太阳改成红色');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 5 个图形。');
  await expect(page.locator('svg circle[fill="#ef4444"]')).toHaveCount(1);
  await expect(page.locator('svg rect[fill="#fef3c7"]')).toHaveCount(1);

  await submitVoiceText(page, '把房子放到最上层');
  await expect(systemFeedback(page)).toContainText('已调整图层顺序。');
  const objectNames = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.name) ?? []);
  expect(objectNames[objectNames.length - 1]).toContain('房子');

  await submitVoiceText(page, '选择房子');
  await expect(page.locator('svg .group-selection-box')).toHaveCount(1);
  await expect(page.locator('svg .selection-box')).toHaveCount(0);
  const beforeMove = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.filter((object) => object.groupName === '房子').map((object) => object.x) ?? []);
  await submitVoiceText(page, '向右移动一点');
  const afterMove = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.filter((object) => object.groupName === '房子').map((object) => object.x) ?? []);
  expect(afterMove.every((x, index) => x > (beforeMove[index] ?? x))).toBe(true);

  expect(consoleErrors).toEqual([]);
});

test('语音可以选中和编辑房子局部窗户', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '画一个房子');
  await submitVoiceText(page, '选择房子窗户');
  await expect(page.locator('svg .group-selection-box')).toHaveCount(0);
  await expect(page.locator('svg .selection-box')).toHaveCount(1);

  await submitVoiceText(page, '把房子窗户改成蓝色');
  const objects = await page.evaluate(() => window.__speak2drawTest?.getScene().objects ?? []);
  const windowObject = objects.find((object) => object.name === '房子窗户');
  const wallObject = objects.find((object) => object.name === '房子墙体');

  expect(windowObject?.style.fill).toBe('#2563eb');
  expect(wallObject?.style.fill).toBe('#fef3c7');
  expect(consoleErrors).toEqual([]);
});

test('删除帽子局部不会删除整只小猫', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.route('**/api/ai/intent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        provider: 'local',
        reason: '测试环境使用本地素材配方。'
      })
    });
  });

  await submitVoiceText(page, '画一个戴帽子的小猫');
  let objects = await page.evaluate(() => window.__speak2drawTest?.getScene().objects ?? []);
  expect(objects.some((object) => object.partName === '帽子')).toBe(true);

  await submitVoiceText(page, '把帽子删去不好看');
  objects = await page.evaluate(() => window.__speak2drawTest?.getScene().objects ?? []);
  expect(objects.some((object) => object.partName === '帽子')).toBe(false);
  expect(objects.some((object) => object.name === '小猫脸')).toBe(true);
  expect(objects.every((object) => object.groupName === '戴帽子的小猫')).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('设置页支持按钮、语音和 AI 连接测试', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.route('**/api/ai/intent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        intent: { type: 'create_shape', shape: 'circle', color: '#ef4444' }
      })
    });
  });

  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.locator('section[aria-label="设置页面"]')).toBeVisible();
  await page.getByLabel('AI 模型').selectOption('deepseek-v4-pro');
  await page.getByLabel('会话 API Key').fill('session-secret');
  await expect.poll(() => page.evaluate(() => window.__speak2drawTest?.getSettings())).toMatchObject({
    aiModel: 'deepseek-v4-pro',
    sessionKeyConfigured: true
  });
  expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain('session-secret');
  expect(await page.content()).not.toContain('session-secret');

  await page.getByRole('button', { name: '测试 AI 连接' }).click();
  await expect(page.locator('aside[aria-label="设置诊断"]')).toContainText('AI 连接正常');
  await page.getByRole('button', { name: '清除会话密钥' }).click();
  await expect(page.getByLabel('会话 API Key')).toHaveValue('');
  await expect.poll(() => page.evaluate(() => window.__speak2drawTest?.getSettings().sessionKeyConfigured)).toBe(false);

  await submitVoiceText(page, '把模型改成 deepseek-v4-flash');
  await expect.poll(() => page.evaluate(() => window.__speak2drawTest?.getSettings().aiModel)).toBe('deepseek-v4-flash');

  await submitVoiceText(page, '关闭设置');
  await expect(page.locator('section[aria-label="设置页面"]')).toBeHidden();
  expect(consoleErrors).toEqual([]);
});

test('关闭 AI 兜底后模糊指令不会请求 AI 代理', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);
  let aiRequestCount = 0;

  await page.route('**/api/ai/intent', async (route) => {
    aiRequestCount += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, provider: 'local', reason: '不应该请求 AI。' })
    });
  });

  await submitVoiceText(page, '画一个蓝色圆形叫月亮');
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '语音控制' }).click();
  await page.getByLabel('本地规则不确定时请求 AI').uncheck();
  await expect.poll(() => page.evaluate(() => window.__speak2drawTest?.getSettings().aiFallbackEnabled)).toBe(false);
  await submitVoiceText(page, '关闭设置');
  await submitVoiceText(page, '月亮换个梦幻感');

  expect(aiRequestCount).toBe(0);
  await expect(aiStatus(page)).toContainText('AI 兜底已关闭');
  await expect(page.locator('svg circle[fill="#2563eb"]')).toHaveCount(1);
  expect(consoleErrors).toEqual([]);
});

test('展示级控制台快捷按钮可以触发语音命令', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.getByRole('button', { name: '画太阳' }).click();
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 1 个图形。');
  await expect(page.locator('svg circle[fill="#facc15"]')).toHaveCount(1);

  await page.getByRole('button', { name: '撤销' }).first().click();
  await expect(systemFeedback(page)).toContainText('已撤销上一步。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.length ?? 0)).toBe(0);

  expect(consoleErrors).toEqual([]);
});

test('画布提示和能力区不会伪装成不可用命令按钮', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.getByRole('button', { name: '收起画布提示' }).click();
  await expect(page.getByText('提示已收起')).toBeVisible();
  await expect(page.getByRole('button', { name: '显示画布提示' })).toBeVisible();
  await page.getByRole('button', { name: '显示右侧对象检查器' }).click();
  await expect(page.locator('.capability-toolbar button')).toHaveCount(0);
  await expect(page.locator('.capability-toolbar .capability-chip')).toHaveCount(10);
  await page.getByTitle('查看编辑指令').click();
  await expect(page.getByRole('button', { name: '线条加粗' })).toBeVisible();
  await expect(systemFeedback(page)).toContainText('启动监听后，说出绘图指令。');
  expect(consoleErrors).toEqual([]);
});

test('复合长句可以一次完成创建和图层调整', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '画一个红色房子和蓝色太阳，再把房子放到最上层');
  await expect(systemFeedback(page)).toContainText('已拆解并执行 6 个绘图步骤。');
  await expect(page.locator('svg circle[fill="#2563eb"]')).toHaveCount(1);
  await expect(page.locator('svg rect[fill="#ef4444"]')).toHaveCount(1);

  const objectNames = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.name) ?? []);
  expect(objectNames).toHaveLength(5);
  expect(objectNames[objectNames.length - 1]).toContain('房子');
  expect(consoleErrors).toEqual([]);
});

test('普通多图形组合会按形状和颜色创建', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '画一个蓝色圆形和绿色矩形');
  await expect(systemFeedback(page)).toContainText('已拆解并执行 2 个绘图步骤。');
  await expect(page.locator('svg circle[fill="#2563eb"]')).toHaveCount(1);
  await expect(page.locator('svg rect[fill="#16a34a"]')).toHaveCount(1);

  const objects = await page.evaluate(() => window.__speak2drawTest?.getScene().objects ?? []);
  expect(objects).toHaveLength(2);
  expect(objects.map((object) => object.kind)).toEqual(['circle', 'rectangle']);
  expect(objects.map((object) => object.style.fill)).toEqual(['#2563eb', '#16a34a']);
  expect(consoleErrors).toEqual([]);
});

test('可以通过语音给图形命名并按名称编辑', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '画一个蓝色圆形叫月亮');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 1 个图形。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects[0]?.name)).toBe('月亮');
  await expect(page.locator('svg circle[fill="#2563eb"]')).toHaveCount(1);

  await submitVoiceText(page, '把月亮改成红色');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 1 个图形。');
  await expect(page.locator('svg circle[fill="#ef4444"]')).toHaveCount(1);

  const beforeMoveX = await page.evaluate(() => window.__speak2drawTest?.getScene().objects[0]?.x ?? 0);
  await submitVoiceText(page, '把月亮向右移动一点');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 1 个图形。');
  const afterMoveX = await page.evaluate(() => window.__speak2drawTest?.getScene().objects[0]?.x ?? 0);
  expect(afterMoveX).toBeGreaterThan(beforeMoveX);

  await submitVoiceText(page, '画布里有什么');
  await expect(systemFeedback(page)).toContainText('月亮');

  expect(consoleErrors).toEqual([]);
});

test('可以给图形改名并复制图形', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '画一个蓝色圆形叫月亮');
  await submitVoiceText(page, '把月亮改名为星星');
  await expect(systemFeedback(page)).toContainText('已重命名目标图形。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects[0]?.name)).toBe('星星');

  await submitVoiceText(page, '复制星星');
  await expect(systemFeedback(page)).toContainText('已复制目标图形。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.name))).toEqual(['星星', '星星副本']);

  expect(consoleErrors).toEqual([]);
});

test('可以直接修改文字内容', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '写文字你好');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 1 个图形。');
  await submitVoiceText(page, '把文字改成世界');
  await expect(systemFeedback(page)).toContainText('已更新文字内容。');
  await expect(page.locator('svg text')).toContainText('世界');

  expect(consoleErrors).toEqual([]);
});

test('可以通过语音组织多个画布对象', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '画一个蓝色圆形叫月亮');
  await submitVoiceText(page, '画一个黄色圆形叫太阳');
  await submitVoiceText(page, '画一个绿色矩形叫云朵');
  await submitVoiceText(page, '把太阳向右移动一点');
  await submitVoiceText(page, '把云朵向右移动一点');
  await submitVoiceText(page, '把云朵向右移动一点');

  await submitVoiceText(page, '把月亮和太阳成组叫夜空');
  await expect(systemFeedback(page)).toContainText('已将 2 个图形成组为夜空。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.groupName ?? null))).toEqual(['夜空', '夜空', null]);

  await submitVoiceText(page, '取消夜空的分组');
  await expect(systemFeedback(page)).toContainText('已取消目标素材组。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.groupName ?? null))).toEqual([null, null, null]);

  await submitVoiceText(page, '水平分布所有图形');
  await expect(systemFeedback(page)).toContainText('已均匀分布目标图形。');

  await submitVoiceText(page, '把所有图形左对齐');
  await expect(systemFeedback(page)).toContainText('已对齐目标图形。');
  const xPositions = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.x) ?? []);
  expect(new Set(xPositions).size).toBe(1);

  expect(consoleErrors).toEqual([]);
});

test('本地规则不确定时可以通过 AI 兜底解析自然语言', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);
  const aiRequests: Array<{ transcript: string }> = [];

  await page.route('**/api/ai/intent', async (route) => {
    const requestBody = route.request().postDataJSON() as { transcript: string };
    aiRequests.push(requestBody);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        intent: {
          type: 'update_style',
          selector: { mode: 'by_name', name: '月亮' },
          color: '#ec4899'
        }
      })
    });
  });

  await submitVoiceText(page, '画一个蓝色圆形叫月亮');
  await expect(page.locator('svg circle[fill="#2563eb"]')).toHaveCount(1);

  await submitVoiceText(page, '月亮换个梦幻感');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 1 个图形。');
  await expect(aiStatus(page)).toContainText('AI 理解为 update_style。');
  await expect(page.locator('svg circle[fill="#ec4899"]')).toHaveCount(1);

  expect(await page.evaluate(() => window.__speak2drawTest?.getAiStatus())).toMatchObject({
    state: 'used',
    message: 'DeepSeek 已解析为 update_style。'
  });
  expect(aiRequests.map((request) => request.transcript)).toEqual(['月亮换个梦幻感']);
  expect(consoleErrors).toEqual([]);
});

test('DeepSeek 未配置时会展示 AI 回退原因且不误改画布', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.route('**/api/ai/intent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        provider: 'local',
        reason: '未配置 DEEPSEEK_API_KEY。'
      })
    });
  });

  await submitVoiceText(page, '画一个蓝色圆形叫月亮');
  await submitVoiceText(page, '月亮换个梦幻感');

  await expect(aiStatus(page)).toContainText('未配置 DEEPSEEK_API_KEY。');
  await expect(systemFeedback(page)).toContainText('暂不支持这条指令。');
  await expect(page.locator('svg circle[fill="#2563eb"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__speak2drawTest?.getAiStatus())).toMatchObject({
    state: 'fallback',
    message: '未配置 DEEPSEEK_API_KEY。'
  });
  expect(consoleErrors).toEqual([]);
});

test('用户可以用下一句语音补充 AI 澄清问题', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);
  const aiRequests: Array<{
    transcript: string;
    clarificationContext?: { originalTranscript: string; question: string };
  }> = [];

  await page.route('**/api/ai/intent', async (route) => {
    const requestBody = route.request().postDataJSON() as {
      transcript: string;
      clarificationContext?: { originalTranscript: string; question: string };
    };
    aiRequests.push(requestBody);

    if (!requestBody.clarificationContext) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          intent: {
            type: 'clarify',
            reason: '你想画什么角色？'
          }
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        intent: {
          type: 'create_asset_recipe',
          name: '猫',
          recipe: [
            { shape: 'circle', name: '猫脸', color: '#f9fafb', position: { x: 370, y: 230 }, width: 160, height: 140 },
            { shape: 'rectangle', name: '红色帽子', color: '#ef4444', position: { x: 405, y: 185 }, width: 100, height: 36 }
          ]
        }
      })
    });
  });

  await submitVoiceText(page, '画一个神秘角色');
  await expect(systemFeedback(page)).toContainText('你想画什么角色？');
  await expect(page.locator('section.info-block').filter({ hasText: '等待补充' }).locator('p')).toContainText('你想画什么角色？');
  expect(await page.evaluate(() => window.__speak2drawTest?.getClarification())).toMatchObject({
    originalTranscript: '画一个神秘角色',
    question: '你想画什么角色？'
  });

  await submitVoiceText(page, '戴红帽子的猫');
  await expect(systemFeedback(page)).toContainText('已拆解并执行 2 个绘图步骤。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getClarification())).toBeNull();
  expect(aiRequests[1]).toMatchObject({
    transcript: '戴红帽子的猫',
    clarificationContext: {
      originalTranscript: '画一个神秘角色',
      question: '你想画什么角色？'
    }
  });
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.name) ?? [])).toEqual(['猫脸', '红色帽子']);
  expect(consoleErrors).toEqual([]);
});

test('AI 可以把缺失元素生成安全矢量配方', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.route('**/api/ai/intent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        intent: {
          type: 'create_asset_recipe',
          name: '戴帽子的小猫',
          recipe: [
            { shape: 'circle', name: '猫脸', color: '#f9fafb', position: { x: 370, y: 230 }, width: 160, height: 140 },
            { shape: 'triangle', name: '猫左耳', color: '#f9fafb', position: { x: 375, y: 190 }, width: 60, height: 70 },
            { shape: 'triangle', name: '猫右耳', color: '#f9fafb', position: { x: 470, y: 190 }, width: 60, height: 70 },
            { shape: 'rectangle', name: '红色帽子', color: '#ef4444', position: { x: 405, y: 185 }, width: 100, height: 36 }
          ]
        }
      })
    });
  });

  await submitVoiceText(page, '画一个戴帽子的小猫');
  await expect(systemFeedback(page)).toContainText('已拆解并执行 4 个绘图步骤。');

  const objectNames = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.name) ?? []);
  expect(objectNames).toEqual(['猫脸', '猫左耳', '猫右耳', '红色帽子']);
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.groupName) ?? [])).toEqual(['戴帽子的小猫', '戴帽子的小猫', '戴帽子的小猫', '戴帽子的小猫']);
  await expect(page.locator('svg circle[fill="#f9fafb"]')).toHaveCount(1);
  await expect(page.locator('svg rect[fill="#ef4444"]')).toHaveCount(1);

  const beforeMove = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.x) ?? []);
  await submitVoiceText(page, '把小猫向右移动一点');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 4 个图形。');
  const afterMove = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.x) ?? []);
  expect(afterMove.every((x, index) => x > (beforeMove[index] ?? x))).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('DeepSeek 不可用时创作类指令使用本地安全素材配方兜底', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.route('**/api/ai/intent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        provider: 'local',
        reason: '未配置 DEEPSEEK_API_KEY。'
      })
    });
  });

  await submitVoiceText(page, '画一个戴帽子的小猫');
  await expect(systemFeedback(page)).toContainText('已拆解并执行');
  await expect(aiStatus(page)).toContainText('本地安全素材配方');

  const scene = await page.evaluate(() => window.__speak2drawTest?.getScene());
  expect(scene?.objects.length).toBeGreaterThanOrEqual(6);
  expect(scene?.objects.every((object) => object.groupName === '戴帽子的小猫')).toBe(true);
  expect(await page.locator('svg .group-selection-box').count()).toBe(1);
  expect(consoleErrors).toEqual([]);
});

test('画布专注布局完整显示小猫并通过浮窗切换检查器', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await page.route('**/api/ai/intent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        provider: 'local',
        reason: '测试环境使用本地素材配方。'
      })
    });
  });

  await submitVoiceText(page, '画一个戴帽子的小猫');
  await expect(page.locator('svg .group-selection-box')).toHaveCount(1);
  expect(await page.evaluate(() => window.__speak2drawTest?.getWorkbenchLayout())).toBe('focus');
  await expect(page.locator('.object-workbench')).toHaveCount(0);
  await expect(page.locator('.canvas-layout-controls')).toBeVisible();
  await expect(page.locator('.canvas-micro-tags')).toContainText('SVG');

  const selectionVisible = await page.locator('svg .group-selection-box').evaluate((box) => {
    const bounds = box.getBoundingClientRect();
    const canvas = document.querySelector('.drawing-canvas')?.getBoundingClientRect();
    if (!canvas) return false;
    return bounds.top >= canvas.top && bounds.left >= canvas.left && bounds.bottom <= canvas.bottom && bounds.right <= canvas.right;
  });
  expect(selectionVisible).toBe(true);

  await page.getByRole('button', { name: '显示右侧对象检查器' }).click();
  expect(await page.evaluate(() => window.__speak2drawTest?.getWorkbenchLayout())).toBe('side-inspector');
  await expect(page.locator('.object-workbench.side')).toBeVisible();
  await expect(page.locator('.object-workbench.side')).toContainText('当前对象检查器');

  await page.getByRole('button', { name: '隐藏对象检查器' }).click();
  expect(await page.evaluate(() => window.__speak2drawTest?.getWorkbenchLayout())).toBe('focus');
  await expect(page.locator('.object-workbench')).toHaveCount(0);

  await page.getByRole('button', { name: '显示底部对象检查器' }).click();
  expect(await page.evaluate(() => window.__speak2drawTest?.getWorkbenchLayout())).toBe('bottom-inspector');
  await expect(page.locator('.object-workbench.bottom')).toBeVisible();

  await page.locator('.canvas-layout-controls button[aria-label="打开状态信息"]').click();
  await expect(page.getByRole('dialog', { name: '状态信息' })).toBeVisible();
  await page.getByRole('button', { name: '关闭状态信息' }).click();
  await expect(page.getByRole('dialog', { name: '状态信息' })).toBeHidden();

  await page.locator('.canvas-layout-controls button[aria-label="打开设置"]').click();
  await expect(page.locator('section[aria-label="设置页面"]')).toBeVisible();
  await submitVoiceText(page, '关闭设置');
  await expect(page.locator('section[aria-label="设置页面"]')).toBeHidden();
  expect(await page.locator('aside[aria-label="语音控制栏"] button[aria-label="打开设置"]').count()).toBe(0);
  expect(consoleErrors).toEqual([]);
});

test('语音可以切换画布检查器布局', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '打开对象信息');
  expect(await page.evaluate(() => window.__speak2drawTest?.getWorkbenchLayout())).toBe('side-inspector');
  await expect(page.locator('.object-workbench.side')).toBeVisible();
  await expect(systemFeedback(page)).toContainText('已打开右侧对象检查器。');

  await submitVoiceText(page, '打开底部栏');
  expect(await page.evaluate(() => window.__speak2drawTest?.getWorkbenchLayout())).toBe('bottom-inspector');
  await expect(page.locator('.object-workbench.bottom')).toBeVisible();

  await submitVoiceText(page, '恢复画布模式');
  expect(await page.evaluate(() => window.__speak2drawTest?.getWorkbenchLayout())).toBe('focus');
  await expect(page.locator('.object-workbench')).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test('语音可以打开和关闭状态信息浮层', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '打开状态信息');
  await expect(page.getByRole('dialog', { name: '状态信息' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '状态信息' }).getByText('工作流运行状态')).toBeVisible();
  await expect(systemFeedback(page)).toContainText('已打开状态信息。');

  await submitVoiceText(page, '关闭状态信息');
  await expect(page.getByRole('dialog', { name: '状态信息' })).toBeHidden();
  await expect(systemFeedback(page)).toContainText('已关闭状态信息。');
  expect(consoleErrors).toEqual([]);
});

test('撤销会回退整条复杂语音命令', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '画一个房子和太阳');
  await expect(systemFeedback(page)).toContainText('已拆解并执行 5 个绘图步骤。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.length ?? 0)).toBe(5);

  await submitVoiceText(page, '撤销');
  await expect(systemFeedback(page)).toContainText('已撤销上一步。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.length ?? 0)).toBe(0);

  await submitVoiceText(page, '重做');
  await expect(systemFeedback(page)).toContainText('已重做上一步。');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.length ?? 0)).toBe(5);

  expect(consoleErrors).toEqual([]);
});

test('纯语音查询可以返回帮助和画布状态', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);

  await submitVoiceText(page, '我能说什么');
  await expect(systemFeedback(page)).toContainText('可以说');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.length ?? 0)).toBe(0);

  await submitVoiceText(page, '画一个蓝色圆形');
  await submitVoiceText(page, '画布里有什么');
  await expect(systemFeedback(page)).toContainText('画布里有 1 个图形');
  await expect(systemFeedback(page)).toContainText('圆形');

  await submitVoiceText(page, '当前选中的是什么');
  await expect(systemFeedback(page)).toContainText('当前选中：圆形');
  await expect(systemFeedback(page)).toContainText('颜色 蓝色');

  expect(consoleErrors).toEqual([]);
});

test('模糊样式指令不会误报成功', async ({ page }) => {
  const consoleErrors = await openWorkbench(page);
  await page.route('**/api/ai/intent', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        provider: 'local',
        reason: '测试环境未配置 DeepSeek。'
      })
    });
  });

  await submitVoiceText(page, '画一个蓝色圆形');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 1 个图形。');

  await submitVoiceText(page, '把它改成漂亮一点');
  await expect(systemFeedback(page)).toContainText('没有识别出要修改的颜色或样式');
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.length ?? 0)).toBe(1);
  await expect(page.locator('svg circle[fill="#2563eb"]')).toHaveCount(1);

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
  await expect(page.locator('aside[aria-label="语音控制栏"]')).toBeVisible();
  await expect(page.getByText('麦克风输入测试')).toBeVisible();
  await expect(page.getByText('尚未读取麦克风输入')).toBeVisible();
  await expect(page.locator('[aria-label="麦克风实时音量"] span')).toHaveCount(0);
  const canvasTop = await page.locator('section[aria-label="绘图画布"]').evaluate((element) => element.getBoundingClientRect().top);
  const diagnosticsTop = await page.locator('aside[aria-label="语音控制栏"]').evaluate((element) => element.getBoundingClientRect().top);
  expect(canvasTop).toBeLessThan(diagnosticsTop);

  expect(consoleErrors).toEqual([]);
});

test('左右栏和设置页使用独立滚动，不带动整个页面', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 320 });
  const consoleErrors = await openWorkbench(page);

  const documentScroll = await page.evaluate(() => ({
    bodyOverflow: window.getComputedStyle(document.body).overflow,
    scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
    clientHeight: document.scrollingElement?.clientHeight ?? 0
  }));
  expect(documentScroll.bodyOverflow).toBe('hidden');
  expect(documentScroll.scrollHeight).toBe(documentScroll.clientHeight);

  await expectScrollableRegion(page, 'aside[aria-label="语音控制栏"]');
  const canvasMain = await page.locator('.studio-main').evaluate((element) => ({
    overflowY: window.getComputedStyle(element).overflowY,
    overscrollY: window.getComputedStyle(element).overscrollBehaviorY
  }));
  expect(canvasMain.overflowY).toBe('hidden');
  expect(canvasMain.overscrollY).toBe('contain');

  await page.getByRole('button', { name: '显示右侧对象检查器' }).click();
  await expectScrollableRegion(page, '.object-workbench.side');

  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.locator('section[aria-label="设置页面"]')).toBeVisible();
  await expectScrollableRegion(page, 'section[aria-label="设置表单"]');
  await expectScrollableRegion(page, 'aside[aria-label="设置诊断"]');

  const finalDocumentScroll = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
  expect(finalDocumentScroll).toBe(0);
  expect(consoleErrors).toEqual([]);
});

const submitVoiceText = async (page: Page, text: string) => {
  await page.evaluate(async (value) => {
    await window.__speak2drawTest?.submitTranscript(value);
  }, text);
};

const systemFeedback = (page: Page) =>
  page.locator('section.info-block').filter({ hasText: '系统反馈' }).locator('p');

const aiStatus = (page: Page) =>
  page.locator('section[aria-label="AI 解析状态"]').locator('p');

const expectScrollableRegion = async (page: Page, selector: string) => {
  const before = await page.locator(selector).evaluate((element) => ({
    overflowY: window.getComputedStyle(element).overflowY,
    overscrollY: window.getComputedStyle(element).overscrollBehaviorY,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    beforeTop: element.scrollTop
  }));
  expect(['auto', 'scroll']).toContain(before.overflowY);
  expect(before.overscrollY).toBe('contain');
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

  const after = await page.locator(selector).evaluate((element) => {
    element.scrollTop = 96;
    return {
      afterTop: element.scrollTop,
      documentTop: document.scrollingElement?.scrollTop ?? 0
    };
  });
  expect(after.afterTop).toBeGreaterThan(before.beforeTop);
  expect(after.documentTop).toBe(0);
};

const collectConsoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isIgnoredConsoleError(message.text(), message.location().url)) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
};

const isIgnoredConsoleError = (text: string, url: string) =>
  url.endsWith('/favicon.ico') && text.includes('404');
