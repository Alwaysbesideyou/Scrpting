import { fetch } from "scripting"
import type { AlertpilotConfig, AiInput, HolidayCache, ShortcutInput, UserPreferenceLearningStat } from "./types"
import { formatDateKey, formatDateTime, getErrorMessage } from "./utils"
import { DEFAULT_CONFIG } from "./config"
import { readConfig, writeConfig } from "./storage"
import { configuredSimpleTaskPreferences, normalizeReminderListCategory, buildSimpleTaskCategoryPrompt } from "./smartScheduler"
import { formatMemoryPrompt } from "./profileMemory"

export type AiProviderId = "sudie" | "openai" | "gemini" | "anthropic" | "deepseek"

export type AiGeneratedItem = Partial<AiInput>

type AiGenerationOptions = {
 includeUserProfile?: boolean
}

type AiGeneratedItemsResult = {
    items: AiGeneratedItem[]
}

export function aiProviderOptions() {
    return ["sudie", "openai", "gemini", "anthropic", "deepseek"] as AiProviderId[]
}

export function aiModelOptions(provider: string) {
    switch (provider) {
        case "sudie":
            return ["gpt-4o", "gpt-5.5", "deepseek-v4-pro", "deepseek-v4-flash"]
        case "openai":
            return ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"]
        case "gemini":
            return ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro"]
        case "anthropic":
            return ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-sonnet-4-0"]
        default:
            return [""]
    }
}

export function formatPromptDate(date = new Date()): string {
    return formatDateTime(date)
}

function formatHolidayDate(date: Date): string {
    return formatDateKey(date)
}

export async function getMainlandChinaHolidays(months = 12): Promise<string> {
    const monthCount = Math.max(1, Math.floor(Number(months) || 12))

    try {
        const calendars = await Calendar.forEvents()
        const holidayCalendar = calendars.find(calendar => calendar.title === "中国大陆节假日")
        if (!holidayCalendar) return "未找到日历：中国大陆节假日"

        const startDate = new Date()
        const endDate = new Date(startDate)
        endDate.setMonth(endDate.getMonth() + monthCount)

        const events = await CalendarEvent.getAll(startDate, endDate, [holidayCalendar])
        return events
            .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
            .map(event => `${formatHolidayDate(event.startDate)} ${event.title}`)
            .join("\n") || `近${monthCount}个月未查询到节假日`
    } catch (error) {
        const message = getErrorMessage(error)
        if (/permission|authorized|denied|access/i.test(message)) {
            return [
                "节假日获取失败：没有日历权限。",
                "请到 iOS 设置 → 隐私与安全性 → 日历 → Scripting，开启“完整访问”（或允许访问日历）后重试。",
                `原始错误：${message}`
            ].join("\n")
        }

        return `节假日获取失败：${message}`
    }
}

function htmlToMarkdown(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
        .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

export async function getWebContentMarkdown(url: string, timeout = 5): Promise<string> {
    if (!url) return "无"

    try {
        const response = await fetch(url, {
            timeout,
            debugLabel: "Alertpilot AI web content"
        })
        const html = await response.text()
        return htmlToMarkdown(html).slice(0, 8000) || "网页内容为空"
    } catch (error) {
        return `网页内容获取失败：${String(error)}`
    }
}

export function todayKey(date = new Date()): string {
    return formatDateKey(date)
}

function getHolidayMonths(config: AlertpilotConfig): number {
    return Math.max(1, Math.floor(Number(config.calendarAddNum) || 12))
}

export function getHolidayCacheText(config: AlertpilotConfig): string {
    return String(config.userPreferences?.holidayCache?.text || "")
}

export function isHolidayCacheFresh(config: AlertpilotConfig, date = new Date()): boolean {
    const cache = config.userPreferences?.holidayCache
    return Boolean(
        cache?.text &&
        cache.date === todayKey(date) &&
        Number(cache.months) === getHolidayMonths(config)
    )
}

export async function ensureHolidayCache(config: AlertpilotConfig, date = new Date()): Promise<AlertpilotConfig> {
    if (isHolidayCacheFresh(config, date)) return config

    const months = getHolidayMonths(config)
    const text = await getMainlandChinaHolidays(months)
    const holidayCache: HolidayCache = {
        date: todayKey(date),
        months,
        text
    }
    const nextConfig: AlertpilotConfig = {
        ...config,
        userPreferences: {
            ...(config.userPreferences || DEFAULT_CONFIG.userPreferences!),
            holidayCache
        }
    }

    try {
        await writeConfig(nextConfig)
    } catch {
        // 即使保存失败，也返回本次获取到的缓存，避免运行时把提示文案传给 AI。
    }

    return nextConfig
}

export async function readConfigWithHolidayCache(): Promise<AlertpilotConfig> {
    return ensureHolidayCache(await readConfig())
}

export async function getCachedHolidayText(config: AlertpilotConfig): Promise<string> {
    const nextConfig = await ensureHolidayCache(config)
    return getHolidayCacheText(nextConfig)
}

export function fillPromptVariables(
    template: string,
    config: AlertpilotConfig,
    holidays: string,
    webContent: string
): string {
    const listText = Object.entries(config["提醒列表"] || {})
        .map(([, value]) => value)
        .join("；")
    const timeText = Array.from(new Set([
        ...Object.keys(config["时间"] || {}),
        ...Object.keys(config["附加时间"] || {})
    ])).join("；")
    const currentTime = formatPromptDate()

    return template
        .replace(/\$\{listText\}/g, listText)
        .replace(/\$\{timeText\}/g, timeText)
        .replace(/\$\{currentTime\}/g, currentTime)
        .replace(/\$\{holidays\}/g, holidays)
        .replace(/\$\{webContent\}/g, webContent)
}

export function extractUrl(text: string): string {
    return text.match(/https?:\/\/[^\s]+/i)?.[0] || ""
}

export function aiOutputSchema(): any {
    return {
        type: "object",
        description: "Alertpilot AI parsed reminders array wrapper",
        properties: {
            items: {
                type: "array",
                description: "Alertpilot AI parsed reminders",
                required: true,
                items: {
                    type: "object",
                    description: "Alertpilot AI parsed reminder item",
                    properties: {
                        // rawText: { type: "string", description: "当前拆分出的单个提醒事项原文；用于后续脚本规则继续补全时间、地点、优先级等字段", required: true },
                        text: { type: "string", description: "提醒事项主要内容，不包含时间", required: true },
                        isSummary: { type: "boolean", description: "事件是否被总结或翻译", required: true },
                        classReminders: { type: "string", description: "提醒分类", required: true },
                        timeWord: { type: "string", description: "可以对用户原文中的口语化时间词进行标准化扩写（如将'今晚'扩展为'今天晚上'），但不得归一化、换算、补全年月日、推断具体日期，不得输出 yyyy-mm-dd 等脚本可计算格式", required: true },
                        note: { type: "string", description: "备注", required: true },
                        url: { type: "string", description: "事件相关链接", required: true },
                        smartCategory: { type: "string", description: "AI 根据语义判断的任务类型英文分类名；只能从用户画像的可选 smartCategory 中选择，如 shopping、work、exercise，可为空", required: true },
                        smartReason: { type: "string", description: "AI 判断该事项属于该任务类型的简短原因；只解释类别判别依据，不要提时间、时段、slot 或默认调度，可为空", required: true }
                    }
                }
            }
        }
    }
}

function normalizeGeneratedItems(result: unknown): AiGeneratedItem[] {
    if (Array.isArray(result)) return result as AiGeneratedItem[]
    const maybeResult = result as Partial<AiGeneratedItemsResult> | undefined
    if (Array.isArray(maybeResult?.items)) return maybeResult.items
    return []
}

function extractJsonLike(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    if (fenced) return fenced.trim()

    const arrayStart = text.indexOf("[")
    const objectStart = text.indexOf("{")
    const starts = [arrayStart, objectStart].filter(index => index >= 0)
    if (!starts.length) return ""

    const start = Math.min(...starts)
    const endArray = text.lastIndexOf("]")
    const endObject = text.lastIndexOf("}")
    const end = Math.max(endArray, endObject)
    return end >= start ? text.slice(start, end + 1).trim() : ""
}

function normalizeGeneratedItemsFromError(error: unknown): AiGeneratedItem[] {
    const message = String((error as any)?.message || error)
    const output = message.match(/<output>\s*([\s\S]*?)\s*<\/output>/i)?.[1] || message
    const jsonText = extractJsonLike(output)
    if (!jsonText) return []

    try {
        return normalizeGeneratedItems(JSON.parse(jsonText))
    } catch {
        return []
    }
}

function appendMandatoryOutputGuard(instructions: string): string {
    return [
        instructions,
        "",
        "# Alertpilot 强制输出约束（优先级最高）",
        "无论上文示例是否写成 JSON 数组，最终都必须返回一个 JSON 对象，格式为 { \"items\": [...] }。",
        "不要使用 Markdown 代码块，不要添加解释文字。",
        "items 中每一项必须包含 text、isSummary、classReminders、timeWord、note、url、smartCategory、smartReason；没有值时使用空字符串或 false。",
        "timeWord 限制：可以对用户原文中的口语化时间词进行标准化扩写（如将“今晚”扩展为“今天晚上”，“明早”扩展为“明天早上”），但不得补全年份、月份、日期，不得把“周六”改成“2026-06-13”，不得生成 yyyy-mm-dd、yyyy年m月d日、ISO 时间戳或任何脚本可自行推算出的精确日期。",
        "如果原文写的是“今晚”，timeWord 就写“今天晚上”；原文写“周六”，就写“周六”；原文写“明天晚上”，就写“明天晚上”；原文完全没写时间，timeWord 必须为空字符串。",
        "时间优先级最高，请先区分三类时间表达：1）具体/即时/时段时间：0700/07:00/7点、早上/上午/中午/下午/晚上/下班、等下/等会、几分钟后/几小时后等；这类必须原样保留并写入 timeWord，不得用用户画像改写。2）仅日期范围：今天/明天/后天/下周/周末/某月某日/周三等，且没有具体时刻或时段；这类必须保留用户指定日期范围原词，不得自行换算成具体公历日期。3）完全没有时间：保留 timeWord 为空，让脚本根据任务类型、用户画像和本地规则安排日期时间。",
        "AI 只负责判断任务类型 smartCategory 和原因 smartReason；不要决定默认提醒时间段，具体日期时间一律由 Alertpilot 脚本调度。",
        "smartReason 只说明为什么把该事项判成这个类别，可引用动作、对象、场景等语义线索；不要写适合几点、早晚、工作日/休息日、slot、画像偏好或默认安排。",
        "用户画像用于帮助判断 smartCategory；后续脚本会根据用户显式时间写入/学习偏好，不要反向用画像覆盖用户已经输入的时间。",
        "若本次完全没有时间表达，请结合 Alertpilot 用户画像从可选 smartCategory 中判断 smartCategory、smartReason；若无法明确判断，应返回默认 smartCategory，不要留空。",
        "拆分规则再次强调：包含 & 时必须拆分；没有 & 时默认只保留 1 项，不要因为“和/与/并/以及/还有”等连接词拆分同一事项的多个对象，只有确实是多个独立提醒事项才拆分。"
    ].join("\n")
}

export async function requestAiGeneratedItems(
    prompt: string,
    instructions: string,
    config: AlertpilotConfig
): Promise<AiGeneratedItem[]> {
    if (!Assistant.isAvailable) {
        throw new Error("Scripting Assistant 不可用。请先在 Scripting 中配置并启用 Assistant，或在调试页开启“使用输入的 AI 配置”后手动填写 ai 字段。")
    }

    const fullPrompt = [
        appendMandatoryOutputGuard(instructions),
        "",
        "---",
        "",
        prompt
    ].join("\n")

    try {
        if (config.useBuiltInAi ?? true) {
            const result = await Assistant.requestStructuredData<AiGeneratedItemsResult>(
                fullPrompt,
                aiOutputSchema()
            )

            return normalizeGeneratedItems(result)
        }

        const provider = config.aiProvider || "openai"
        const modelId = config.aiModelId || aiModelOptions(provider)[0] || ""
        const result = await Assistant.requestStructuredData<AiGeneratedItemsResult>(
            fullPrompt,
            aiOutputSchema(),
            { provider, modelId } as any
        )

        return normalizeGeneratedItems(result)
    } catch (error) {
        const recoveredItems = normalizeGeneratedItemsFromError(error)
        if (recoveredItems.length) {
            return recoveredItems
        }

        const message = getErrorMessage(error)
        if (/rejected/i.test(message)) {
            throw new Error([
                "Scripting Assistant 拒绝了本次结构化生成请求（rejected）。",
                "可能原因：Assistant 当前未配置可用模型、模型不支持结构化输出、提示词/网页内容过长，或内容被供应商安全策略拒绝。",
                "可尝试：检查 Scripting 的 Assistant 配置；缩短输入/网页内容；或在调试页开启“使用输入的 AI 配置”手动填写 ai 字段。",
                `原始错误：${message}`
            ].join("\n"))
        }
        throw error
    }
}

function formatUserPreferencePrompt(config: AlertpilotConfig, sourceText: string): string {
    const p = config.userPreferences
    if (!p?.enabled) return "用户画像：未启用智能默认提醒。"

    const learningSlotKeys = ["morning", "work", "evening", "rest", "weekend"] as const
    const learningStatTotal = (stat?: UserPreferenceLearningStat) => Math.max(
        Number(stat?.total || 0),
        learningSlotKeys.reduce((sum, slot) => sum + Number(stat?.[slot] || 0), 0)
    )
    const mergeLearningStat = (left?: UserPreferenceLearningStat, right?: UserPreferenceLearningStat): UserPreferenceLearningStat => ({
        morning: Number(left?.morning || 0) + Number(right?.morning || 0),
        work: Number(left?.work || 0) + Number(right?.work || 0),
        evening: Number(left?.evening || 0) + Number(right?.evening || 0),
        rest: Number(left?.rest || 0) + Number(right?.rest || 0),
        weekend: Number(left?.weekend || 0) + Number(right?.weekend || 0),
        total: learningStatTotal(left) + learningStatTotal(right)
    })
    const formatLearningStat = (stat?: UserPreferenceLearningStat) => learningStatTotal(stat) > 0
        ? [
            `- morning: ${stat?.morning || 0}`,
            `- work: ${stat?.work || 0}`,
            `- evening: ${stat?.evening || 0}`,
            `- rest: ${stat?.rest || 0}`,
            `- weekend: ${stat?.weekend || 0}`,
            `- total: ${learningStatTotal(stat)}`
        ].join("\n")
        : "暂无足够样本"
    const formatLearningEntries = (
        title: string,
        entryLabel: string,
        learning: Record<string, UserPreferenceLearningStat> | undefined,
        normalizeCategory: (category: string) => string = category => category
    ) => {
        const grouped: Record<string, UserPreferenceLearningStat> = {}
        for (const [rawCategory, stat] of Object.entries(learning || {})) {
            const category = normalizeCategory(rawCategory)
            grouped[category] = mergeLearningStat(grouped[category], stat)
        }
        const rows = Object.entries(grouped)
            .filter(([, stat]) => learningStatTotal(stat) > 0)
            .sort((a, b) => learningStatTotal(b[1]) - learningStatTotal(a[1]) || a[0].localeCompare(b[0]))
        return rows.length
            ? [
                `## ${title}`,
                rows.map(([category, stat]) => [
                    "---",
                    `## ${entryLabel}：${category}`,
                    formatLearningStat(stat)
                ].join("\n")).join("\n\n")
            ].join("\n\n")
            : [`## ${title}`, "暂无足够样本"].join("\n")
    }
    function normalizeSpecifiedTimes(time?: string, times?: string[]): string[] {
        const values = (times && times.length > 0 ? times : [time || "2000"])
            .map(item => String(item || "").replace(/\D/g, "").padStart(4, "0").slice(-4))
            .filter(Boolean)
        return values.length > 0 ? values : ["2000"]
    }

    function formatProfileTime(time?: string): string {
        const value = normalizeSpecifiedTimes(time)[0]
        return `${value.slice(0, 2)}:${value.slice(2, 4)}`
    }

    const configuredSimpleTaskRows = configuredSimpleTaskPreferences(config).map(item => ({
        title: item.title,
        typeId: item.typeId,
        mode: item.mode,
        time: item.time,
        specifiedTimes: item.specifiedTimes,
        specifiedDayConstraint: item.specifiedDayConstraint,
        workDayTimes: item.workDayTimes,
        restDayTimes: item.restDayTimes
    }))
    const simpleTaskCategories = configuredSimpleTaskRows.map(item => item.typeId)
    const fallbackSmartCategory = simpleTaskCategories.includes(String(p.defaultSmartCategory || "").trim())
        ? String(p.defaultSmartCategory || "").trim()
        : (simpleTaskCategories[0] || "")
    const fallbackSmartCategoryLabel = configuredSimpleTaskRows.find(item => item.typeId === fallbackSmartCategory)?.title || "一般"
    const learningText = [
        formatLearningEntries("本地学习统计（所有任务类型）", "任务类型", p.learning),
        formatLearningEntries("本地学习统计（所有提醒列表，按当前提醒列表配置同步）", "提醒列表", p.learningByList, category => normalizeReminderListCategory(category, config))
    ].join("\n\n")

    return [
        "# Alertpilot 用户画像",

        "## 规则",
        "1. 输入中出现 & 时，& 是强拆分符，必须按 & 分隔为多个 items，顺序保持一致。",
        "2. 没有 & 时，不要过度拆分；默认只返回 1 个 item。“和/与/并/以及/还有”等连接词通常只是同一事项内的多个对象或补充信息，不要拆分；只有语义上确实存在多个独立、可分别提醒的事项（例如不同动作且不同对象，或不同时间分别对应不同事项）时才拆分。",
        "3. 不要把同一事项的多个对象、时间、地点、备注、链接、修饰语、步骤说明拆成多个 item；例如“买牛奶和面包”必须是 1 个 item。",
        "4. 每个 item.rawText 必须保留该事项对应的原始片段（包含该事项的时间、地点、优先级、@父提醒、#标签# 等可供脚本继续解析的信息）。",
        "5. 每个 item.text 是该事项的核心提醒内容，尽量不包含时间；timeWord 是该事项扩写后的时间表达。",

        "## 使用边界",
        "- 你需要先判断用户输入的时间属于哪一类：",
        "  1. 具体/即时/时段时间：0700/07:00/7点、早上/上午/中午/下午/晚上/下班、等下/等会、几分钟后/几小时后等；这类必须优先尊重用户输入，不要读取画像来改写 timeWord。",
        "  2. 仅日期范围：今天/明天/后天/下周/周末/某月某日/周三等，且没有具体时刻或时段；这类必须保留用户指定日期范围，不要用画像补具体时间段。",
        "  3. 完全没有时间：保留 timeWord 为空，让脚本结合任务类型、画像和本地规则安排默认日期时间。",
        "- AI 只负责判断任务类型 smartCategory 和判断原因 smartReason；不要决定默认日期或时间段。",
        "- smartReason 只解释为什么判成该类别，不要提几点、早晚、工作日/休息日、slot、用户画像时间偏好或默认调度。",
        "- 不要只依赖关键词硬匹配；请结合语义判断事项类型，具体安排到哪一天、几点由脚本处理。",

        "## 基础时间偏好",
        `- 工作时间：${formatProfileTime(p.workStart)}-${formatProfileTime(p.workEnd)}`,
        `- 重要事项偏好：${formatProfileTime(p.importantTaskTime)}`,

        "## 简单任务偏好",
        "可能一个输入匹配多个任务类别，结合输入语义选取最可能的类别。",
        "已启用任务：",
        buildSimpleTaskCategoryPrompt(config),

        "## 任务分类规则",
        simpleTaskCategories.length > 0
            ? `可选 smartCategory：${simpleTaskCategories.join(", ")}`
            : "可选 smartCategory：暂无已启用任务类型。",
        fallbackSmartCategory
            ? `若语义无法明确匹配到其他任务类别，smartCategory 必须回退为默认类别 ${fallbackSmartCategory}（${fallbackSmartCategoryLabel}），不要留空。`
            : "若语义无法明确匹配到其他任务类别，可暂时留空，脚本会兜底。",
        "AI 只输出 smartCategory/smartReason；slot 是脚本内部调度中间结果，不由 AI 决定。",
        "请参考上方「已启用任务」中的语义解释来判断类别。",

        learningText,
        formatMemoryPrompt(config)
    ].filter(Boolean).join("\n\n")
}

export function buildAiUserPrompt(
 shortcutInput: ShortcutInput,
 sourceText: string,
 config?: AlertpilotConfig,
 options: AiGenerationOptions = {}
): string {
    const rawText = shortcutInput.rawText || ""
    const webTitle = shortcutInput.webTitle || ""
    const inputUrl = shortcutInput.inputUrl || ""
    const userProfilePrompt = options.includeUserProfile !== false && config
 ? formatUserPreferencePrompt(config, sourceText || rawText || webTitle || "")
 : ""

    if (webTitle || inputUrl) {
        return [
            userProfilePrompt,
            "请根据系统分享来的网页信息创建提醒事项：",
            "1. 默认只创建 1 个 item；只有 rawText 明确要求多个提醒，或包含 & 强拆分符时，才拆分为多个 items。",
            "2. 对 webTitle 进行极简总结，直接作为提醒事项 text。",
            "3. 若没有明确时间，请根据当前时间创建提醒事项（保留 timeWord 为空，让 Alertpilot 使用当前时间补全）。",
            "4. url 使用 inputUrl。",
            "5. 每个 item 都必须填写 rawText：若是网页分享，rawText 使用该 item 对应的原始标题/文本/拆分片段。",
            "",
            `webTitle: ${webTitle}`,
            `inputUrl: ${inputUrl}`,
            rawText ? `补充 rawText: ${rawText}` : ""
        ].filter(Boolean).join("\n")
    }

    return [
        userProfilePrompt,
        "请根据以下输入生成 JSON 对象，根字段为 items 数组；每个 item 的字段只包含 rawText、text、isSummary、classReminders、timeWord、note、url、smartCategory、smartReason：",
        "",
        sourceText || rawText || ""
    ].join("\n")
}

export async function generateAiItemsForShortcutInput(
    shortcutInput: ShortcutInput,
    config: AlertpilotConfig
): Promise<AiGeneratedItem[]> {
    const sourceText = shortcutInput.rawText || shortcutInput.webTitle || ""
    const url = shortcutInput.inputUrl || extractUrl(sourceText)
    const holidays = await getCachedHolidayText(config)
    const webContent = await getWebContentMarkdown(url, config.timeOut || 5)
    const instructions = fillPromptVariables(config.aiPrompt || "", config, holidays, webContent)
    const prompt = buildAiUserPrompt(
 shortcutInput,
 sourceText,
 shortcutInput.inputUrl ? undefined : config
)

    return requestAiGeneratedItems(prompt, instructions, config)
}
