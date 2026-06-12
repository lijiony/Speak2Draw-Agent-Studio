import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __speak2drawTest?: {
      submitTranscript: (text: string, confidence?: number) => Promise<void>;
      getScene: () => { objects: Array<{ name: string; groupName?: string; kind: string; x: number; style: { fill: string } }> };
      getAiStatus: () => { state: string; message: string };
      getClarification: () => { originalTranscript: string; question: string } | null;
      getVoiceDiagnostics: () => { policyMode: string; phase: string; interimText: string | null; finalText: string | null };
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

test('语音端点策略可以通过 URL 切换到耐心模式', async ({ page }) => {
  const consoleErrors = await openWorkbench(page, 'e2e=1&voicePolicy=patient');

  expect(await page.evaluate(() => window.__speak2drawTest?.getVoiceDiagnostics())).toMatchObject({
    policyMode: 'patient',
    phase: 'idle'
  });
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
          name: '猫',
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

  await submitVoiceText(page, '画一只戴帽子的猫');
  await expect(systemFeedback(page)).toContainText('已拆解并执行 4 个绘图步骤。');

  const objectNames = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.name) ?? []);
  expect(objectNames).toEqual(['猫脸', '猫左耳', '猫右耳', '红色帽子']);
  expect(await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.groupName) ?? [])).toEqual(['猫', '猫', '猫', '猫']);
  await expect(page.locator('svg circle[fill="#f9fafb"]')).toHaveCount(1);
  await expect(page.locator('svg rect[fill="#ef4444"]')).toHaveCount(1);

  const beforeMove = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.x) ?? []);
  await submitVoiceText(page, '把猫向右移动一点');
  await expect(systemFeedback(page)).toContainText('已更新画布，现在共有 4 个图形。');
  const afterMove = await page.evaluate(() => window.__speak2drawTest?.getScene().objects.map((object) => object.x) ?? []);
  expect(afterMove.every((x, index) => x > (beforeMove[index] ?? x))).toBe(true);
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
  await expect(page.locator('aside[aria-label="语音状态"]')).toBeVisible();
  await expect(page.getByText('麦克风输入测试')).toBeVisible();

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
