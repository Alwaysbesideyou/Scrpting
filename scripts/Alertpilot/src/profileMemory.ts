import type { AlertpilotConfig, AlertpilotInput, AlertpilotOutput } from "./types"
import { reminderListLearningCategory, type TimeSlot } from "./smartScheduler"
import { getErrorMessage, pad2 } from "./utils"

function formatDateKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

const MAX_MEMORY_ITEM_LENGTH = 300

function memoryCategoryName(category: string): string {
    return String(category || "").trim().toLowerCase() || "general"
}

function normalizeMemorySlot(slot: string): string {
    const raw = String(slot || "").trim()
    if (!raw) return "unspecified"
    if (raw === "rest") return "restTime"
    if (raw === "evening") return "restTime"
    return raw
}

function normalizeMarkdownMemory(value: unknown): string {
    return String(value || "")
        .replace(/\r\n/g, "\n")
        .trim()
}

function normalizeMemoryLine(value: string): string {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_MEMORY_ITEM_LENGTH)
}

function legacyGlobalToMarkdown(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map(normalizeMemoryLine)
            .filter(Boolean)
            .map(item => `- ${item}`)
            .join("\n")
    }

    return normalizeMarkdownMemory(value)
}

function dailyMemoryToMarkdown(value: unknown): string {
    if (typeof value === "string") return normalizeMarkdownMemory(value)
    if (!Array.isArray(value)) return ""

    return value
        .slice(-7)
        .map(day => {
            const date = String(day?.date || "").trim()
            const items = Array.isArray(day?.items) ? day.items : []
            const body = items
                .map((item: string) => normalizeMarkdownMemory(item))
                .filter(Boolean)
                .map((item: string) => item.startsWith("-") ? item : `- ${item}`)
                .join("\n")
            return date && body ? `## ${date}\n${body}` : body
        })
        .filter(Boolean)
        .join("\n\n")
}

function ensureMemory(config: AlertpilotConfig) {
    const preferences = config.userPreferences
    if (!preferences) return undefined

    const current = preferences.memory || {}
    preferences.memory = {
        global: legacyGlobalToMarkdown(current.global),
        aiDaily: Array.isArray(current.aiDaily) ? current.aiDaily : [],
        aiMarkdown: normalizeMarkdownMemory((current as any).aiMarkdown) || dailyMemoryToMarkdown(current.aiDaily)
    }
    return preferences.memory
}

export function formatMemoryPrompt(config: AlertpilotConfig): string {
    const memory = config.userPreferences?.memory
    const globalMarkdown = legacyGlobalToMarkdown(memory?.global)
    const dailyMarkdown = normalizeMarkdownMemory((memory as any)?.aiMarkdown) || dailyMemoryToMarkdown(memory?.aiDaily)

    if (!globalMarkdown && !dailyMarkdown) return "用户画像记忆：暂无。"

    return [
        "# Alertpilot 用户画像记忆",
        "## 全局记忆（用户手动维护，优先级高）",
        globalMarkdown || "暂无。",
        "## 自动记忆（AI/脚本根据运行结果沉淀，可能有误，仅作参考）",
        dailyMarkdown || "暂无。"
    ].join("\n")
}

export function addGlobalMemory(config: AlertpilotConfig, text: string): boolean {
    const memory = ensureMemory(config)
    if (!memory) return false

    const markdown = normalizeMarkdownMemory(text)
    if (!markdown) return false

    memory.global = memory.global
        ? `${normalizeMarkdownMemory(memory.global)}\n\n${markdown}`
        : markdown
    return true
}

export function replaceGlobalMemory(config: AlertpilotConfig, markdown: string): void {
    const memory = ensureMemory(config)
    if (!memory) return

    memory.global = normalizeMarkdownMemory(markdown)
}

export function replaceAutoMemory(config: AlertpilotConfig, markdown: string): void {
    const memory = ensureMemory(config)
    if (!memory) return

    memory.aiMarkdown = normalizeMarkdownMemory(markdown)
    memory.aiDaily = []
}

export function clearDailyMemory(config: AlertpilotConfig): void {
    const memory = ensureMemory(config)
    if (memory) {
        memory.aiDaily = []
        memory.aiMarkdown = ""
    }
}

export function rememberRunSummary(
    input: AlertpilotInput,
    output: AlertpilotOutput,
    config: AlertpilotConfig,
    now = new Date()
): boolean {
    const memory = ensureMemory(config)
    if (!memory) return false

    const text = output.text || input.finalText || input.ai?.text || input.ai?.rawText || input.shortcutInput?.rawText || "提醒事项"
    const taskCategory = memoryCategoryName(((input as any).smartScheduleDecision?.category || "general") as string)
    const slot = normalizeMemorySlot(((input as any).smartScheduleDecision?.slot || slotFromDate(input.finalDate) || "unspecified") as string)
    const list = output.classReminders || input.classReminders || reminderListLearningCategory(input, config)
    const explicit = !(input as any).smartScheduleDecision && Boolean(input.rawTime || input.daypart || input.otherTime || input.month || input.week || input.isLatestRestDay)
    const line = normalizeMemoryLine(`${explicit ? "用户指定" : "智能默认"}：${taskCategory} / ${list} → ${slot}，${text}`)
    if (!line) return false

    const date = formatDateKey(now)
    const entry = `- ${line}`
    const existingMarkdown = normalizeMarkdownMemory((memory as any).aiMarkdown) || dailyMemoryToMarkdown(memory.aiDaily)
    const sectionHeader = `## ${date}`

    if (existingMarkdown.toLowerCase().includes(entry.toLowerCase())) return false

    if (!existingMarkdown) {
        memory.aiMarkdown = `${sectionHeader}\n${entry}`
    } else if (existingMarkdown.includes(sectionHeader)) {
        memory.aiMarkdown = existingMarkdown.replace(sectionHeader, `${sectionHeader}\n${entry}`)
    } else {
        memory.aiMarkdown = `${existingMarkdown}\n\n${sectionHeader}\n${entry}`
    }

    memory.aiDaily = []
    return true
}

function slotFromDate(date?: Date): TimeSlot | undefined {
    if (!date) return undefined
    const n = Number(`${pad2(date.getHours())}${pad2(date.getMinutes())}`)
    if (n < 1200) return "morning"
    if (n < 1800) return "work"
    if (n < 2200) return "restTime"
    return "restTime"
}

export type MemoryOrganizeMode = "global" | "auto" | "both"

export async function aiOrganizeMemory(
    config: AlertpilotConfig,
    mode: MemoryOrganizeMode = "both"
): Promise<{ global?: string; auto?: string }> {
    if (!Assistant.isAvailable) {
        throw new Error("Scripting Assistant 不可用。请先在 Scripting 中配置并启用 Assistant。")
    }

    const memory = config.userPreferences?.memory
    const globalMarkdown = legacyGlobalToMarkdown(memory?.global)
    const autoMarkdown = normalizeMarkdownMemory((memory as any)?.aiMarkdown) || dailyMemoryToMarkdown(memory?.aiDaily)

    if (!globalMarkdown && !autoMarkdown) {
        throw new Error("暂无记忆内容可整理。")
    }

    const needsGlobal = mode === "global" || mode === "both"
    const needsAuto = mode === "auto" || mode === "both"

    const prompt = `你是一个记忆整理助手，专门整理 Alertpilot 提醒事项应用的用户画像记忆。

## 记忆类型说明
- **全局记忆**：用户手动维护的长期偏好、习惯、重要信息，优先级高，会作为高优先级用户画像注入 AI 提示词
- **自动记忆**：脚本根据运行结果自动沉淀的每日提醒摘要，按日期标题组织，包含任务类型、时间槽位、提醒内容等信息

## 整理原则
1. **保留所有信息**：不要删除任何实质性内容，只做组织和标准化
2. **归类整理**：将相关记忆归类到合适的主题下
3. **标准化格式**：使用清晰的 Markdown 格式，包括标题、列表等
4. **去除重复**：合并重复或高度相似的记忆
5. **优化表述**：使记忆表述更清晰、简洁
6. **保持原意**：不要改变记忆的原意，只优化表达

## 全局记忆整理规范
- 使用 ## 二级标题分类（如：## 偏好、## 习惯、## 重要信息）
- 每条记忆使用 - 列表项
- 保持简洁，避免冗余
- 如果有时间相关偏好，明确标注

## 自动记忆整理规范
- 输出为双层结构：先给出“## 近期偏好摘要”，再给出“## 原始记录”
- “近期偏好摘要”中提炼稳定模式，如常见任务类型、常用提醒列表、典型时间偏好、生活场景倾向
- “原始记录”下使用 ### 日期标题（如：### 2024-01-15）
- 每条原始记忆使用 - 列表项，格式统一为：- category / list / slot：内容
- category 必须使用英文分类名（如 shopping、work、exercise），不要使用两位数 ID，也不要使用 categary:01 这类格式
- slot 统一使用 morning、work、restTime、restDay、any、unspecified 这些名称；将 rest、evening 等旧写法统一归并
- 删除信息量过低的噪声记录（如仅有“提醒事项”且无有效上下文）
- 合并重复或高度相似的记录；必要时可在摘要中指出低置信度/脏数据已被清洗

## 输出格式
请返回一个 JSON 对象，包含以下字段：
- "global": 整理后的全局记忆（如果需要整理）
- "auto": 整理后的自动记忆（如果需要整理）

如果某个字段不需要整理，请返回 null。

注意：若整理自动记忆，输出中必须是双层结构（“## 近期偏好摘要” + “## 原始记录”），并将原始记录中的 category 统一改成英文分类名，而不是数字 ID。

## 用户记忆
${needsGlobal ? `### 全局记忆\n${globalMarkdown || "暂无。"}` : ""}
${needsAuto ? `### 自动记忆\n${autoMarkdown || "暂无。"}` : ""}`

    try {
        const result = await Assistant.requestStructuredData<{
            global: string | null
            auto: string | null
        }>(prompt, {
            type: "object",
            description: "整理后的记忆内容",
            properties: {
                global: { type: "string", description: "整理后的全局记忆" },
                auto: { type: "string", description: "整理后的自动记忆" }
            }
        })

        return {
            global: result.global || undefined,
            auto: result.auto || undefined
        }
    } catch (error) {
        const message = getErrorMessage(error)
        if (/rejected/i.test(message)) {
            throw new Error("AI 整理请求被拒绝。请检查 Assistant 配置。")
        }
        throw error
    }
}
