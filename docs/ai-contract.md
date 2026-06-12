# AI 契约与 DeepSeek 联调文档

## 目标

本文档记录 Speak2Draw-Agent-Studio 与 DeepSeek 的交互契约。AI 只负责把中文语音文本转换为结构化绘图意图，不能直接修改 DOM、不能执行任意代码、不能返回任意 SVG/HTML。所有 AI 输出都必须回到本地白名单绘图引擎执行。

## 本地配置

复制环境变量示例文件：

```bash
copy .env.example .env.local
```

在 `.env.local` 中填写：

```bash
DEEPSEEK_API_KEY=本地密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_TIMEOUT_MS=8000
```

`.env.local` 必须保持本地 ignored 状态，不能提交到远程仓库。

## API 入口

浏览器端只调用本地代理：

```http
POST /api/ai/intent
Content-Type: application/json
```

Vite 本地代理再调用：

```http
POST https://api.deepseek.com/chat/completions
Authorization: Bearer <DEEPSEEK_API_KEY>
Content-Type: application/json
```

浏览器端不会接触 DeepSeek API Key。

## 请求 Payload

```json
{
  "transcript": "月亮换个梦幻感",
  "localReason": "暂不支持这条指令。",
  "scene": {
    "objects": [
      {
        "name": "月亮",
        "groupName": "夜空",
        "kind": "circle",
        "fill": "#2563eb"
      }
    ],
    "selectedName": "月亮"
  }
}
```

字段说明：

- `transcript`：本轮语音识别文本。
- `localReason`：本地规则无法执行或需要澄清的原因。
- `scene.objects`：当前画布对象摘要，只包含名称、素材组名、形状和颜色。
- `scene.selectedName`：当前选中对象名称，没有选中时为 `null`。
- `clarificationContext`：上一轮澄清上下文，仅在多轮补充时出现。

多轮澄清请求示例：

```json
{
  "transcript": "戴红帽子的猫",
  "localReason": "你想画什么角色？",
  "clarificationContext": {
    "originalTranscript": "画一个神秘角色",
    "question": "你想画什么角色？",
    "reason": "缺少明确对象"
  },
  "scene": {
    "objects": [],
    "selectedName": null
  }
}
```

## DeepSeek 输出格式

DeepSeek 必须优先返回包裹格式：

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "create_shape",
    "shape": "circle",
    "color": "#ef4444"
  }
}
```

当前兼容裸 `DrawingIntent`，但提示词和文档都以包裹格式为准。

## 支持的 Intent

### 创建基础图形

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "create_shape",
    "shape": "circle",
    "color": "#ef4444",
    "name": "红色圆形"
  }
}
```

要求：

- `shape` 必须是 `circle`、`rectangle`、`ellipse`、`line`、`triangle`、`text` 之一。
- `color` 必须是 `#RRGGBB`。

### 修改样式

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "update_style",
    "selector": {
      "mode": "by_name",
      "name": "月亮"
    },
    "color": "#ec4899"
  }
}
```

要求：

- 必须包含 `color`、`strokeColor` 或 `strokeWidth` 至少一个。
- 用户提到已有对象名称时，优先使用 `selector.mode = "by_name"`。

### 移动对象

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "move_object",
    "selector": {
      "mode": "by_name",
      "name": "猫"
    },
    "direction": "right"
  }
}
```

要求：

- `direction` 必须是 `left`、`right`、`up`、`down`、`center`、`top-left`、`top-right`、`bottom-left`、`bottom-right` 之一。

### 成组、取消成组、对齐和分布

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "group_objects",
    "selector": {
      "mode": "by_names",
      "names": ["月亮", "太阳"]
    },
    "name": "夜空"
  }
}
```

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "align_objects",
    "selector": {
      "mode": "all"
    },
    "alignment": "left"
  }
}
```

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "distribute_objects",
    "selector": {
      "mode": "all"
    },
    "axis": "horizontal"
  }
}
```

要求：

- `selector.mode` 可以使用 `all`、`by_name`、`by_names`、`selected` 或 `last`。
- `align_objects` 必须包含 `alignment`，合法值为 `left`、`center-x`、`right`、`top`、`center-y`、`bottom`。
- `distribute_objects` 必须包含 `axis`，合法值为 `horizontal` 或 `vertical`。
- 成组和布局命令只修改本地 SceneModel，不允许返回任意 SVG 或脚本。

### 缺失元素素材配方

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "create_asset_recipe",
    "name": "戴帽子的猫",
    "recipe": [
      {
        "shape": "circle",
        "name": "猫脸",
        "color": "#f9fafb",
        "strokeColor": "#111827",
        "position": { "x": 370, "y": 230 },
        "width": 160,
        "height": 140
      },
      {
        "shape": "rectangle",
        "name": "红色帽子",
        "color": "#ef4444",
        "strokeColor": "#111827",
        "position": { "x": 405, "y": 185 },
        "width": 100,
        "height": 36
      }
    ]
  }
}
```

要求：

- `name` 表示整组素材名称，推荐必填。
- `recipe` 最多执行 16 个部件。
- 每个部件只能使用基础图形白名单，不能返回 `path`、任意 SVG、HTML 或脚本。
- 落地后系统会写入 `groupId` 和 `groupName`，用户后续可以按组名选择、移动、改色、删除整组素材。

### 复杂顺序指令

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "sequence",
    "intents": [
      {
        "type": "create_shape",
        "shape": "circle",
        "color": "#2563eb",
        "name": "月亮"
      },
      {
        "type": "move_object",
        "selector": { "mode": "by_name", "name": "月亮" },
        "direction": "top-right"
      }
    ]
  }
}
```

要求：

- `sequence` 只能包含 1 到 6 个子意图。
- 不能嵌套 `sequence`。
- 不能混入 `unknown` 或 `clarify` 子意图。

### 澄清或失败

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "clarify",
    "reason": "你想画什么角色？"
  }
}
```

或：

```json
{
  "schemaVersion": "1.0",
  "intent": {
    "type": "unknown",
    "reason": "这条指令暂时无法安全执行。"
  }
}
```

要求：

- `clarify` 和 `unknown` 必须包含 `reason`。
- 返回后应用会语音反馈，并保留澄清上下文。

## 本地安全校验

应用会拒绝以下 AI 输出：

- 非 JSON 或无法解析的内容。
- 不支持的 intent type。
- 非白名单 shape。
- 非十六进制颜色。
- 缺少每类 intent 的必填字段。
- 非白名单对齐方式、分布轴或选择器模式。
- 嵌套 `sequence`。
- `sequence` 中混入 `unknown` 或 `clarify`。
- 空 `recipe`。
- 超出限制的尺寸、线宽、缩放比例。
- 任意 SVG、HTML、脚本或 path 类自由绘制内容。

## 代理失败返回

未配置密钥：

```json
{
  "ok": false,
  "provider": "local",
  "reason": "未配置 DEEPSEEK_API_KEY。"
}
```

DeepSeek 超时：

```json
{
  "ok": false,
  "provider": "deepseek",
  "reason": "DeepSeek 响应超时。"
}
```

DeepSeek 返回不安全内容：

```json
{
  "ok": false,
  "provider": "deepseek",
  "reason": "DeepSeek 返回内容未通过安全校验。"
}
```

失败时前端保留本地澄清反馈，不误改画布。

## 手工联调步骤

1. 确认 `.env.local` 已配置 DeepSeek 环境变量。
2. 运行 `npm run dev`。
3. 打开 `http://127.0.0.1:5173/`。
4. 授权麦克风。
5. 依次说：
   - `画一个蓝色圆形叫月亮`
   - `月亮换个梦幻感`
   - `画一个神秘角色`
   - `戴红帽子的猫`
   - `画一只戴帽子的猫`
   - `把猫向右移动一点`
   - `把所有图形左对齐`
   - `水平分布所有图形`
   - `画一个海边日落，有小船和云`
   - `画布里有什么`
6. 观察右侧 AI 解析状态：
   - 明确本地指令应显示本地规则处理。
   - 自然语言兜底应显示 DeepSeek 解析出的 intent type。
   - 需要补充时应显示等待补充。
   - DeepSeek 不可用时应显示回退原因。
7. 确认画布没有因失败 AI 响应发生误修改。

## 自动化测试策略

- 单元测试使用 mock，不调用真实 DeepSeek。
- 端到端测试拦截 `/api/ai/intent`，模拟成功、失败、澄清和素材配方。
- 真实 DeepSeek 联调只作为手工 QA，不把 API Key 写入测试或文档。
