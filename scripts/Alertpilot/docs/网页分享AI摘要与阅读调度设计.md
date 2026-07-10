# 网页分享 AI 摘要与阅读调度设计

## 一、问题背景

### 1.1 用户输入示例

通过快捷指令分享网页时，传入的 JSON：

```json
{
    "shortcutInput": {
        "rawText": "",
        "webTitle": "chiihero/Microsoft-Rewards-Script: 微软奖励脚本，基于他人脚本实现中文环境的本地化",
        "inputUrl": "https://github.com/chiihero/Microsoft-Rewards-Script"
    },
    "saveLogs": true,
    "debug": false,
    "action": "createReminder"
}
```

### 1.2 观察到的异常行为

网页分享时，Alertpilot 不会进行网页内容的 AI 总结，而是机械地将 `webTitle` 原样放到提醒的 `text` 和 `note` 字段中。

### 1.3 期望行为

- **AI 应当抓取 URL 对应的网页内容**，根据正文生成精简的提醒标题（`text`）和摘要备注（`note`）。
- `webTitle` 只作为失败时的兜底来源，不应是主数据源。
- 网页分享的任务类型应固定为用户配置的 `reading`，走用户画像中阅读任务的时间补全规则。
- 网页 AI 摘要不应读取或写入用户画像（历史记忆、学习统计）。

---

## 二、问题定位

### 2.1 根因：`src/app.ts` 中的 `isWebUrlShare` 分支跳过了 AI 调用

**位置**：`src/app.ts` 第 60–85 行

```ts
const isWebUrlShare = Boolean(
    input.shortcutInput?.inputUrl &&
    /^https?:\/\//i.test(input.shortcutInput.inputUrl)
)

if (isWebUrlShare) {
    input.ai = {
        ...input.ai,
        smartCategory: "reading",
        smartReason: "网页链接分享，自动归类为阅读任务"
    }
    input.skipAutoMemory = true
    // ...
}

const aiItems = useAI && !isWebUrlShare    // ← 关键：!isWebUrlShare 导致网页链接永远不调用 AI
    ? await ensureAiInput(input, config, logger)
    : []
```

`!isWebUrlShare` 条件导致只要 `inputUrl` 是 `http://` 或 `https://`，即使 `useAI` 默认开启，也**不会调用** `ensureAiInput()`。

### 2.2 下游 AI 能力实际已就绪

以下代码片段表明，AI 网页摘要的下游逻辑本身是完整的：

| 模块 | 功能 | 位置 |
|---|---|---|
| `src/ai.ts` | `getWebContentMarkdown()` 请求网页并转换 HTML 为 Markdown，最多截取 8000 字符 | 第 102–115 行 |
| `src/ai.ts` | `generateAiItemsForShortcutInput()` 将网页内容注入 `${webContent}` 占位符 | 第 504–520 行 |
| `src/ai.ts` | `fillPromptVariables()` 将 `${webContent}` 替换进 `config.aiPrompt` | 第 174–195 行 |
| `src/ai.ts` | `buildAiUserPrompt()` 构建网页专用用户提示词 | 第 467–502 行 |
| `src/ai.ts` | `requestAiGeneratedItems()` 调用 Assistant 获取结构化结果 | 第 285–338 行 |

默认 `aiPrompt`（`src/config.ts`）中包含：

```
网页内容: ${webContent}
```

并有明确指令："如果传入了网页内容，请整理网页内容为备注。"

### 2.3 标题和备注的兜底链路

跳过 AI 后，`input.ai` 中没有 AI 生成的 `text`、`note`、`isSummary`，因此走本地兜底：

#### 标题（`src/app.ts` 第 186–200 行、221–224 行）

```ts
// urlTitle 优先取 webTitle
urlTitle = input.shortcutInput?.webTitle ||
    await getHtmlTitle(input.shortcutInput?.inputUrl || input.url || "", ...)

// output.text 优先取 AI 摘要，否则取 urlTitle
output.text =
    (input.ai?.isSummary ? input.ai.text : "") ||    // AI 被跳过，为空
    urlTitle.replace(/\n+/gm, "") ||                  // 回退到 webTitle
    `${input.misMatch || ""}${stripDecorators(text)}`
```

#### 备注（`src/parser.ts` 第 45–49 行）

```ts
input.note =
    input.ai?.note ||                                                          // AI 被跳过，为空
    (input.shortcutInput?.webTitle && input.shortcutInput?.inputUrl             // 有标题和 URL 时
        ? input.shortcutInput.webTitle                                          // 直接用 webTitle
        : "") ||
    matchText(/(?:\n)(.+$)/sm).replace(input.url || "", "")
```

所以"标题原样进入 text 和 note"是跳过 AI 后兜底逻辑的确定结果。

---

## 三、用户意图澄清

### 3.1 第一轮澄清："不要干扰本地用户画像"

> 普通提醒事项 → 走 AI + 用户画像 AI（合并）
> 链接 → 只走 AI，不要用户画像

用户画像在脚本中分散为三层：

| 层次 | 内容 | 控制字段 |
|---|---|---|
| **AI 提示词中的用户画像** | 工作/休息时间、任务分类、学习统计、全局记忆、自动记忆 | `formatUserPreferencePrompt()` 调用时机 |
| **本地智能调度** | 根据 `smartCategory` 选择时间类型（work/restTime/restDay/specified/any） | `skipProfileAnalysis` |
| **自动记忆写入** | 运行结果沉淀到 `memory.aiMarkdown` | `skipAutoMemory` |

设计目标：

| 输入类型 | AI 调用 | AI 提示词中的用户画像 | 本地智能调度 | 自动记忆写入 |
|---|---|---|---|---|
| 普通提醒 | ✅ | ✅ | ✅ | ✅ |
| 网页链接 | ✅ | ❌ | ✅（按 reading 配置） | ❌ |

### 3.2 第二轮澄清："reading 已有时间配置，直接走时间补全"

> 跳过用户画像模块，直接走用户画像的时间补全。

准确表述：跳过 AI 用户画像注入，不跳过本地 `smartScheduler`。`smartScheduler` 会读取用户对 `reading` 任务配置的 `mode`、`specifiedTimes`、`specifiedDayConstraint` 等，安排提醒时间。

### 3.3 第三轮澄清："webTitle 只是兜底变量"

> 脚本内部进行 URL 访问获得网页内容和标题，然后交给 AI 总结。
> 如果只分享 URL 没有标题，也通过脚本抓取标题。
> webTitle 只是兜底。

### 3.4 第四轮澄清："合并抓取 + 提示词预览"

> 网页标题和正文应该一次请求同时获取。
> `${webContent}` 占位符应包含标题和内容。
> 配置页刷新网页内容后应能查看整合后的提示词。

---

## 四、当前脚本链路分析

### 4.1 标题获取（已存在）

`src/network.ts`：

```ts
export async function getHtmlTitle(url: string, timeout = 3): Promise<string> {
    const response = await fetch(url, { timeout })
    const html = await response.text()
    const title = html.match(/<title.*?>(.+?)<\/title>/is)?.[1]
    return title?.replace(/\s+/g, " ").trim() || ""
}
```

当前使用位置（`src/app.ts` 第 189–191 行）：

```ts
urlTitle =
    input.shortcutInput?.webTitle ||
    await getHtmlTitle(input.shortcutInput?.inputUrl || input.url || "", ...)
```

**问题**：有 `webTitle` 时不会再请求 URL 取 `<title>`，导致不使用实际网页标题。

### 4.2 正文获取（已存在）

`src/ai.ts`：

```ts
export async function getWebContentMarkdown(url: string, timeout = 5): Promise<string> {
    if (!url) return "无"
    try {
        const response = await fetch(url, { timeout })
        const html = await response.text()
        return htmlToMarkdown(html).slice(0, 8000) || "网页内容为空"
    } catch (error) {
        return `网页内容获取失败：${String(error)}`
    }
}
```

**问题**：
- 返回字符串，调用方无法区分"成功正文"、"空正文"、"超时/访问失败"。
- 抓取失败时仍把错误字符串塞入 `${webContent}`，AI 仍会调用。
- 与 `getHtmlTitle()` 各自独立请求，导致两次网络请求。

### 4.3 配置页提示词预览（已存在）

`src/config-ui.tsx` 中 `AiPromptEditorPage` 组件（第 1513–1717 行）：

```tsx
const [webUrl, setWebUrl] = useState("")
const [webContentText, setWebContentText] = useState("请输入 URL 后刷新网页内容")
const mergedPromptText = fillPromptVariables(promptText, config, holidaysText, webContentText)

async function refreshWebContent() {
    const url = webUrl.trim()
    if (!url) {
        setWebContentText("请输入 URL 后刷新网页内容")
        return
    }
    setWebContentText("正在获取网页内容…")
    setWebContentText(await getWebContentMarkdown(url, config.timeOut || 5))
}
```

预览页面 `AiPromptPreviewPage`（第 1719–1780 行）接收 `mergedPromptText` 并展示。

**问题**：预览使用旧的 `getWebContentMarkdown()`，与主流程可能不一致。

---

## 五、设计决策

### 5.1 合并网页抓取

新增 `getWebPageContent()` 函数，一次 `fetch` 同时返回：

```ts
export type WebPageContentResult = {
    title: string       // 优先快捷指令传入，否则从 HTML <title> 提取
    markdown: string    // "# 标题\n\n正文 Markdown"，最多 8000 字符
    isAvailable: boolean // 是否成功获取正文
    error?: string      // 失败原因
}
```

**优先级**：
1. 快捷指令传入的 `webTitle` 作为首选标题。
2. 没有 `webTitle` 时，从 HTML `<title>` 提取。
3. 都没有时，标题为空。

**失败处理**：
- URL 访问超时/异常 → `isAvailable = false`，`error` 记录原因。
- 调用方根据 `isAvailable` 决定是否调用 AI 或回退到 `webTitle`。

### 5.2 网页 AI 摘要不注入用户画像

在 `src/ai.ts` 的 `buildAiUserPrompt()` 中增加 `AiGenerationOptions`：

```ts
type AiGenerationOptions = {
    includeUserProfile?: boolean
}
```

网页场景传入 `includeUserProfile: false`（通过 `shortcutInput.inputUrl ? undefined : config` 间接实现）。

### 5.3 固定任务类型为 reading

网页链接识别后，设置：

```ts
input.ai = {
    ...input.ai,
    smartCategory: "reading",
    smartReason: "网页链接分享，固定归类为阅读任务"
}
```

并在 AI 返回结果后再次覆盖，防止 AI 输出其他分类。

### 5.4 分离画像学习与本地调度

新增 `skipProfileLearning` 字段，仅控制学习统计写入，不影响 `applySmartScheduleDecision()`：

```ts
if (isWebUrlShare) {
    input.skipProfileLearning = true   // 不记录自学习统计
    input.skipAutoMemory = true        // 不写入自动画像记忆
    // 注意：不设置 skipProfileAnalysis，保留本地 reading 时间调度
}
```

### 5.5 网页提示词改进

将原来的：

```
2. 对 webTitle 进行极简总结，直接作为提醒事项 text。
3. 若没有明确时间，请根据当前时间创建提醒事项（保留 timeWord 为空，让 Alertpilot 使用当前时间补全）。
4. url 使用 inputUrl。
5. 每个 item 都必须填写 rawText...
```

改为：

```
2. 根据网页正文生成极简中文提醒标题作为 text；正文不可用时才基于 webTitle 清理、精简标题。
3. note 用 1～3 条简要要点总结网页核心内容，不要重复 text 或照抄 webTitle。
4. isSummary 必须为 true，url 必须使用 inputUrl。
5. 若补充 rawText 没有明确时间，timeWord 必须为空，让 Alertpilot 按本地阅读任务配置补全时间。
6. 每个 item 都必须填写 rawText...
```

---

## 六、已实施的修改

### 6.1 第一轮修改（已完成）

**目标**：恢复网页 AI 调用、隔离画像、固定 reading 分类。

#### 6.1.1 `src/types.ts`

新增 `skipProfileLearning` 字段：

```ts
export type AlertpilotInput = {
    // ...
    skipProfileMemory?: boolean
    skipProfileAnalysis?: boolean
    skipProfileLearning?: boolean  // ← 新增
    skipAutoMemory?: boolean
    // ...
}
```

#### 6.1.2 `src/ai.ts`

新增 `AiGenerationOptions` 类型：

```ts
type AiGenerationOptions = {
    includeUserProfile?: boolean
}
```

`buildAiUserPrompt()` 增加 options 参数，控制是否注入用户画像：

```ts
export function buildAiUserPrompt(
    shortcutInput: ShortcutInput,
    sourceText: string,
    config?: AlertpilotConfig,
    options: AiGenerationOptions = {}
): string {
    const userProfilePrompt = options.includeUserProfile !== false && config
        ? formatUserPreferencePrompt(config, sourceText || rawText || webTitle || "")
        : ""
    // ...
}
```

网页场景通过传入 `shortcutInput.inputUrl ? undefined : config` 间接禁用画像注入。

#### 6.1.3 `src/app.ts`

**网页分支不再跳过 AI**：

```ts
// 原代码
const aiItems = useAI && !isWebUrlShare ? await ensureAiInput(...) : []

// 新代码
const aiItems = useAI ? await ensureAiInput(input, config, logger) : []
```

**网页分支设置画像隔离**：

```ts
if (isWebUrlShare) {
    input.ai = { ...input.ai, smartCategory: "reading", smartReason: "..." }
    input.skipProfileLearning = true
    input.skipAutoMemory = true
    // 注意：不设置 skipProfileAnalysis
}
```

**AI 返回后强制固定 reading**：

```ts
if (isWebUrlShare) {
    input.ai = { ...input.ai, smartCategory: "reading", smartReason: "..." }
    aiItems.forEach(item => {
        item.smartCategory = "reading"
        item.smartReason = "网页链接分享，固定归类为阅读任务"
    })
}
```

**学习统计受 `skipProfileLearning` 控制**：

```ts
const learnedFromExplicit = input.skipProfileAnalysis || input.skipProfileLearning
    ? false
    : learnFromExplicitSchedule(input, config, logger)
```

#### 6.1.4 修复已有类型错误

`normalizeAiGeneratedItem()` 中 `getDefaultReminderList` 漏调用：

```ts
// 原代码
classReminders: String(item.classReminders || "").trim() || getDefaultReminderList,

// 修复
classReminders: String(item.classReminders || "").trim() || getDefaultReminderList(config),
```

### 6.2 第二轮修改（进行中）

**目标**：统一网页抓取、提示词预览。

#### 6.2.1 `src/ai.ts` 新增 `getWebPageContent()`

```ts
export type WebPageContentResult = {
    title: string
    markdown: string
    isAvailable: boolean
    error?: string
}

function htmlTitle(html: string): string {
    return html.match(/<title.*?>(.+?)<\/title>/is)?.[1]
        ?.replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim() || ""
}

export async function getWebPageContent(
    url: string,
    timeout = 5,
    preferredTitle = ""
): Promise<WebPageContentResult> {
    // 一次 fetch，同时提取 <title> 和正文 Markdown
    // preferredTitle（来自 shortcutInput.webTitle）优先于 <title>
    // 成功返回 isAvailable=true，失败返回 isAvailable=false + error
}
```

#### 6.2.2 `generateAiItemsForShortcutInput()` 接入新函数

待完成：将主流程的网页抓取从 `getWebContentMarkdown()` 切换到 `getWebPageContent()`，并：

- 根据 `isAvailable` 决定是否调用 AI；
- 将 `webPage.title` 回写到 `shortcutInput.webTitle`（仅在没有时）；
- 将 `webPage.markdown` 注入 `${webContent}`。

#### 6.2.3 `config-ui.tsx` 配置页预览同步

待完成：将提示词编辑页的 `refreshWebContent()` 改为调用 `getWebPageContent()`，确保预览与实际 AI 调用使用相同内容。

---

## 七、完整链路（目标状态）

### 7.1 网页链接分享

```
快捷指令输入：url +（可选）webTitle
    ↓
识别为网页链接（isWebUrlShare）
    ↓
设置画像隔离：
  - skipProfileLearning = true
  - skipAutoMemory = true
  - 不设置 skipProfileAnalysis
    ↓
AI 调用（useAI=true 时）：
  - getWebPageContent() 一次请求获取 title + markdown
  - 优先使用 shortcutInput.webTitle，没有才用 <title>
  - 将 markdown 注入 ${webContent}
  - 提示词不注入用户画像（includeUserProfile=false）
  - URL 不可用时抛出错误，不调用 AI
    ↓
AI 生成结果：
  - text：网页正文的简短提醒标题
  - note：网页正文的 1～3 条摘要
  - isSummary：true
  - smartCategory：被本地强制覆盖为 "reading"
    ↓
本地 smartScheduler：
  - 读取 reading 的 mode/specifiedTimes/specifiedDayConstraint
  - 计算提醒日期和时间
  - 检查冲突并重排
    ↓
创建提醒
  - 标题 = AI text
  - 备注 = AI note
  - 标签 = 📖Reading
    ↓
不写入自学习统计、不写入自动画像记忆
```

### 7.2 网页访问失败回退

```
getWebPageContent() 返回 isAvailable=false
    ↓
抛出错误，不调用 AI
    ↓
ensureAiInput() 捕获错误，回退到本地解析
    ↓
shortcutInput.rawText = shortcutInput.webTitle || shortcutInput.inputUrl
    ↓
本地解析链路：
  - note = webTitle（如果有的话）
  - text = webTitle（如果有的话）
  - 否则使用 URL 兜底标题
    ↓
仍然固定 smartCategory = "reading"
仍然走 reading 的时间调度
```

### 7.3 只有 URL 没有 webTitle

```
getWebPageContent() 从 HTML <title> 提取标题
    ↓
回写到 shortcutInput.webTitle
    ↓
其余流程与有 webTitle 时相同
```

### 7.4 普通提醒（不受影响）

```
文本输入（无 URL）
    ↓
isWebUrlShare = false
    ↓
AI 调用 + 用户画像注入
AI 判断 smartCategory
本地按 smartCategory 调度
写入自学习统计和自动画像记忆
```

---

## 八、关键代码位置索引

| 文件 | 功能 | 行号（大致） |
|---|---|---|
| `src/types.ts` | `AlertpilotInput.skipProfileLearning` | 43 |
| `src/ai.ts` | `WebPageContentResult` 类型 | 102–107 |
| `src/ai.ts` | `htmlTitle()` | 109–114 |
| `src/ai.ts` | `getWebPageContent()` | 131–173 |
| `src/ai.ts` | `getWebContentMarkdown()`（旧，保留兼容） | 116–129 |
| `src/ai.ts` | `AiGenerationOptions` | 13–15 |
| `src/ai.ts` | `buildAiUserPrompt()` | 467–502 |
| `src/ai.ts` | `generateAiItemsForShortcutInput()` | 562–578 |
| `src/app.ts` | `isWebUrlShare` 判断 | 60–63 |
| `src/app.ts` | 网页分支设置画像隔离 | 65–77 |
| `src/app.ts` | AI 调用（不再跳过网页） | 79–81 |
| `src/app.ts` | AI 返回后强制 reading | 82–100 |
| `src/app.ts` | 学习统计受 `skipProfileLearning` 控制 | 158–160 |
| `src/app.ts` | `urlTitle` 兜底标题 | 186–200 |
| `src/app.ts` | `output.text` 赋值 | 221–224 |
| `src/parser.ts` | `input.note` 赋值优先级 | 45–49 |
| `src/config-ui.tsx` | `AiPromptEditorPage` 提示词编辑 | 1513–1717 |
| `src/config-ui.tsx` | `refreshWebContent()` 网页刷新 | 1582–1591 |
| `src/config-ui.tsx` | `AiPromptPreviewPage` 整合预览 | 1719–1780 |
| `src/config-ui.tsx` | `fillAiInputByModel()` 调试页 AI 填写 | 1979–2010 |
| `src/config.ts` | 默认 `aiPrompt`（含 `${webContent}` 占位符） | 153–217 |
| `src/network.ts` | `getHtmlTitle()` | 3–12 |
| `src/smartScheduler.ts` | `applySmartScheduleDecision()` | 228–327 |
| `src/smartScheduler.ts` | `configuredSimpleTaskFromCategory()` | 154–163 |
| `src/smartScheduler.ts` | `defaultSlot()` | 661–686 |
| `src/smartScheduler.ts` | `timeForSlot()` | 706–724 |
| `docs/时间类型与自学习设计.md` | 调度逻辑核心参考 | 全文 |

---

## 九、备份记录

| 时间 | 备份路径 | 触发原因 |
|---|---|---|
| 20260710_133330 | `backup/Alertpilot/Alertpilot_修复网页AI摘要与阅读调度_20260710_133330/` | 第一轮修改前 |
| 20260710_183216 | `backup/Alertpilot/Alertpilot_统一网页抓取与提示词预览_20260710_183216/` | 第二轮修改前 |
| 20260710_183216 | `src/ai.pre-web-unification-backup.ts` | 第二轮 ai.ts 修改前本地副本 |

---

## 十、已知问题与后续工作

### 10.1 第二轮修改未完成

`generateAiItemsForShortcutInput()` 的 `getWebPageContent()` 接入经历了多次编辑失败（`replace_in_file` 的 `old_str` 匹配不精确导致连续 `old_str was not found`），目前函数已新增但主流程调用参数尚未完全切换。

### 10.2 配置页预览与主流程不一致

配置页 `AiPromptEditorPage` 仍使用旧的 `getWebContentMarkdown()`，需要改为 `getWebPageContent()`。

### 10.3 提示词安全

网页正文与标题属于不可信外部内容，被直接嵌入 `config.aiPrompt` 展开后的提示词。建议在 `${webContent}` 周围增加边界标记，并在强制约束中强调仅提取网页事实、不遵从网页中的指令。

### 10.4 双函数共存

`getWebContentMarkdown()` 和 `getWebPageContent()` 同时存在。完成迁移后应评估是否删除旧函数，或保留为兼容别名。
