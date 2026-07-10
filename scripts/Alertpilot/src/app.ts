import { CHANGELOG, SAVE_LOGS, getDefaultReminderList } from "./config"
import scriptMetadata from "../script.json"
import type { AlertpilotInput, AlertpilotOutput, AlertpilotOutputs, RuntimeState, AlertpilotConfig, LogSink, LogLevel } from "./types"
import type { AiGeneratedItem } from "./ai"
import { readConfig, writeChangelog, writeConfig, writeLog } from "./storage"
import { applySmartScheduleDecision, learnFromExplicitSchedule, avoidReminderTimeConflicts } from "./smartScheduler"
import { Logger } from "./notifier"
import { parseInput } from "./parser"
import { resolveDateTime } from "./dateTime"
import { getHtmlTitle } from "./network"
import { createOrFindParentReminder } from "./reminders"
import { languagePack, stripDecorators, type LanguagePack, getErrorMessage } from "./utils"
import { generateAiItemsForShortcutInput } from "./ai"
import { rememberRunSummary } from "./profileMemory"
import { summarizeAiItem, summarizeAiItems, summarizeInput, summarizeMatch, summarizeOutput, summarizeTransform } from "./logger"

const SCRIPT_VERSION = String((scriptMetadata as { version?: string }).version || "")

function buildReminderBridgeNote(metadata: Record<string, unknown>): string {
 return `[[AlertpilotMeta:${JSON.stringify(metadata)}]]`
}

type RunAlertpilotOptions = {
 debug?: boolean
 saveLogs?: boolean
 onLog?: LogSink
 logLevel?: LogLevel
 internalChildRun?: boolean
}

export async function runAlertpilot(
 rawInput: AlertpilotInput,
 options: RunAlertpilotOptions = {}
): Promise<AlertpilotOutputs> {
 const input = normalizeInput(rawInput)
 const output: AlertpilotOutput = {}
 const state: RuntimeState = {
 input,
 output,
 logs: []
 }

 const config = await readConfig()
 const debugMode = options.debug === true || input.debug === true
 if (debugMode) {
 input.skipProfileMemory = true
 }
 const effectiveLogLevel = options.logLevel || input.logLevel || (options.onLog ? config.logLevel : "warn") || "warn"
 const logger = new Logger(state.logs, options.onLog, effectiveLogLevel)
 const lang = languagePack()
 const useAI = applyUseAiDirective(input)

 const isNewVersion = await writeChangelog(SCRIPT_VERSION, CHANGELOG)
 if (isNewVersion) {
 await logger.ios(`🆕Version：${SCRIPT_VERSION}\n💥Changelog：${CHANGELOG}\n\n往期日志请查看文件`)
 }

 logger.info("INPUT", "运行开始", () => summarizeInput(input), false)

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
 logger.info("AI", "检测到网页链接分享，跳过AI分析，自动使用阅读任务分类", {
 url: input.shortcutInput?.inputUrl,
 webTitle: input.shortcutInput?.webTitle
 })
 }

 const aiItems = useAI && !isWebUrlShare
 ? await ensureAiInput(input, config, logger)
 : []
 if (!useAI || isWebUrlShare) {
 logger.info("AI", isWebUrlShare ? "网页链接分享，跳过AI调用" : "检测到 no-ai/useAI=false 指令，跳过 AI 与用户画像记忆", {
 rawText: input.shortcutInput?.rawText || ""
 })
 }
 if (aiItems.length >1 && !options.internalChildRun) {
 const outputs: AlertpilotOutputs = []
 for (const item of aiItems) {
 const childOutputs = await runAlertpilot({
 shortcutInput: {
 ...(input.shortcutInput || {}),
 rawText: item.rawText || item.timeWord || item.text || input.shortcutInput?.rawText || "",
 inputUrl: item.url || input.shortcutInput?.inputUrl || "",
 webTitle: ""
 },
 ai: item,
 debug: input.debug,
 saveLogs: input.saveLogs,
 logLevel: input.logLevel,
 skipProfileMemory: input.skipProfileMemory
 }, {
 ...options,
 internalChildRun: true,
 saveLogs: false
 })
 outputs.push(...childOutputs)
 }
 logger.info("OUTPUT", `多事项提醒处理完成：${outputs.length} 个`, () => ({
 items: outputs.map(summarizeOutput)
 }))
 const finalLogEntry = {
 input: {
 ...state.input,
 ai: {
 ...state.input.ai,
 allItems: aiItems.map(item => summarizeAiItem(item))
 }
 },
 output: outputs,
 summary: {
 count: outputs.length,
 items: outputs.map((item: AlertpilotOutput) => ({
 text: item.text,
 specifiedDate: item.specifiedDate,
 tags: item.tags,
 classReminders: item.classReminders,
 scheduleKind: item.scheduleKind,
 note: item.note
 }))
 }
 }
 state.logs.push(finalLogEntry)
 const shouldSaveLogs = debugMode ? false : options.saveLogs ?? input.saveLogs ?? config.saveLogs ?? SAVE_LOGS
 if (shouldSaveLogs) {
 await writeLog(state.logs)
 logger.info("SAVE", "日志已保存", undefined, false)
 }
 return outputs
 }

 parseInput(input, output, config, logger)
 logger.trace("MATCH", "脚本匹配完成", () => summarizeMatch(input, output))
 const learnedFromExplicit = input.skipProfileAnalysis
 ? false
 : learnFromExplicitSchedule(input, config, logger)
 if (!input.skipProfileAnalysis) {
 await applySmartScheduleDecision(input, config, logger)
 } else {
 logger.trace("SCHEDULE", "已跳过用户画像智能默认提醒", undefined, false)
 }

 let text = input.finalText || ""
 const hasGlobalUrl = Boolean(input.shortcutInput?.inputUrl || input.url)

 if (!text && !input.misMatch && !hasGlobalUrl) {
 if (input.url) {
 text = ""
 } else {
 text = input.note || "提醒事项"

 const date = new Date()
 date.setMinutes(date.getMinutes() +30)
 input.time = `${date.getHours()}${String(date.getMinutes()).padStart(2,"0")}`
 logger.warn("TRANSFORM", "无提醒正文，自动创建30 分钟后提醒", {
 fallbackText: text,
 fallbackTime: input.time
 })
 }
 }

 let urlTitle = ""
 if (hasGlobalUrl) {
 try {
 urlTitle =
 input.shortcutInput?.webTitle ||
 await getHtmlTitle(input.shortcutInput?.inputUrl || input.url || "", config.timeOut ||3)
 } catch (err) {
 logger.warn("INPUT", "网页标题获取失败，使用 URL兜底标题", {
 error: String(err),
 url: input.shortcutInput?.inputUrl || input.url || ""
 })
 const url = input.shortcutInput?.inputUrl || input.url || ""
 urlTitle = url ? `🌐无标题：🔗${url.replace(/^https?:\/\//, "")}` : ""
 }
 }

 await resolveDateTime(input, config, logger)
 logger.trace("TRANSFORM", "时间转换完成", () => summarizeTransform(input))
 if (!input.skipProfileAnalysis) {
 await avoidReminderTimeConflicts(input, config, logger)
 } else {
 logger.trace("SCHEDULE", "已跳过用户画像时间冲突重排", undefined, false)
 }

 if (input.parentReminder) {
 const parent = await createOrFindParentReminder(input.parentReminder, output.classReminders)
 output.parentReminder = parent.parentReminder
 output.calForReminders = parent.calForReminders
 output.pReminderDate = parent.pReminderDate
 } else {
 output.parentReminder = ""
 output.calForReminders = "Reminders"
 output.pReminderDate = "2023-03-03T04:00:00.000Z"
 }

 output.text =
 (input.ai?.isSummary ? input.ai.text : "") ||
 urlTitle.replace(/\n+/gm, "") ||
 `${input.misMatch || ""}${stripDecorators(text)}`

 if (text.length >20 && ((input.ai?.isSummary && input.ai?.text) || urlTitle)) {
 output.note = `${output.note || ""}${stripDecorators(text)}`
 }

 output.specifiedDate = input.time || ""
 output.tags = buildTags(config, input)
 output.scheduleKind = inferScheduleKind(input)
 const originalNote = output.note || ""
 const outputSnapshot: AlertpilotOutput = {
 ...output,
 note: originalNote,
 scheduleKind: output.scheduleKind,
 }
 output.note = buildReminderBridgeNote({
 ...outputSnapshot,
 createdAt: new Date().toISOString(),
 dueDate: input.finalDate ? input.finalDate.toISOString() : null,
 finalDate: input.finalDate ? input.finalDate.toISOString() : null,
 location: input.location || "",
 tag: input.tag || "",
 rawTime: input.rawTime || "",
 otherTime: input.otherTime || "",
 daypart: input.daypart || "",
 month: input.month || "",
 week: input.week || "",
 isLatestRestDay: input.isLatestRestDay || false,
 smartCategory: input.ai?.smartCategory || "",
 smartReason: input.ai?.smartReason || "",
 })

 output.addtionalNotification = buildAdditionalNotification(outputSnapshot, lang)

 logger.trace("OUTPUT", `已生成提醒：${output.text || "提醒事项"}`, () => summarizeOutput(outputSnapshot))

 const rememberedRun = input.skipAutoMemory ? false : rememberRunSummary(input, output, config)
 if (rememberedRun) {
 logger.debug("SAVE", "已写入用户画像每日记忆", {
 text: output.text,
 classReminders: output.classReminders
 })
 }

 const finalLogEntry = {
 input: state.input,
 output: outputSnapshot,
 summary: {
 text: outputSnapshot.text,
 specifiedDate: outputSnapshot.specifiedDate,
 tags: outputSnapshot.tags,
 classReminders: outputSnapshot.classReminders,
 scheduleKind: outputSnapshot.scheduleKind,
 note: outputSnapshot.note
 }
 }
 state.logs.push(finalLogEntry)

 const shouldSaveLogs = debugMode ? false : options.saveLogs ?? input.saveLogs ?? config.saveLogs ?? SAVE_LOGS
 if (learnedFromExplicit || rememberedRun) {
 await writeConfig(config)
 }
 if (shouldSaveLogs) {
 await writeLog(state.logs)
 logger.info("SAVE", "日志已保存", undefined, false)
 }

 return [output]
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
 if (value === undefined || value === null || value === "") return undefined
 if (typeof value === "boolean") return value
 if (typeof value === "number") return value ===0 ? false : true
 const text = String(value).trim().toLowerCase()
 if (["1", "true", "yes", "on"].includes(text)) return true
 if (["0", "false", "no", "off"].includes(text)) return false
 return undefined
}

function normalizeInput(raw: Partial<AlertpilotInput> | null | undefined): AlertpilotInput {
 const source = (raw || {}) as Partial<AlertpilotInput> & Record<string, unknown>
 const shortcutInput = (raw?.shortcutInput || {}) as AlertpilotInput["shortcutInput"] & Record<string, unknown>
 const explicitUseAI = parseOptionalBoolean(source.useAI) ?? parseOptionalBoolean(shortcutInput.useAI)
 const noAiRequested = [
 source.noai,
 shortcutInput.noai
 ].some(value => parseOptionalBoolean(value) === true)

 return {
 ...source,
 shortcutInput,
 ai: raw?.ai || {},
 useAI: noAiRequested ? false : explicitUseAI ?? true,
 skipProfileMemory: source.skipProfileMemory === true || noAiRequested || explicitUseAI === false,
 skipProfileAnalysis: source.skipProfileAnalysis === true || source.skipProfileMemory === true || noAiRequested || explicitUseAI === false,
 skipAutoMemory: source.skipAutoMemory === true || source.skipProfileMemory === true || noAiRequested || explicitUseAI === false
 }
}

function applyUseAiDirective(input: AlertpilotInput): boolean {
 const shortcutInput = input.shortcutInput || {}
 const rawText = String(shortcutInput.rawText || "")
 const matchText = (re: RegExp, source = rawText) => {
 const m = source.match(re)
 return m ? m[0].trim() : ""
 }
 const directive = matchText(/(?:noai|-ai)/i)

 if (directive) {
 shortcutInput.rawText = rawText.replace(/(?:noai|-ai)/ig, "").trim()
 shortcutInput.useAI = false
 input.shortcutInput = shortcutInput
 input.ai = {}
 input.useAI = false
 input.skipProfileMemory = true
 return false
 }

 const shouldUseAI = parseOptionalBoolean(input.useAI) ?? parseOptionalBoolean(shortcutInput.useAI) ?? true
 input.useAI = shouldUseAI
 if (!shouldUseAI) {
 input.ai = {}
 shortcutInput.useAI = false
 input.shortcutInput = shortcutInput
 input.skipProfileMemory = true
 }
 return shouldUseAI
}

function hasExternalAiInput(input: AlertpilotInput): boolean {
 const ai = input.ai || {}
 return Boolean(
 ai.rawText ||
 ai.text ||
 ai.timeWord ||
 ai.note ||
 ai.url ||
 ai.classReminders ||
 ai.isSummary
 )
}

async function ensureAiInput(
 input: AlertpilotInput,
 config: AlertpilotConfig,
 logger: Logger
) {
 if (hasExternalAiInput(input)) {
 logger.info("AI", "检测到 ai 层已有内容，按兼容模式直接使用。", () => summarizeAiItem(input.ai))
 return []
 }

 const shortcutInput = input.shortcutInput || {}
 const hasShortcutText = Boolean(
 shortcutInput.rawText ||
 shortcutInput.webTitle ||
 shortcutInput.inputUrl
 )

 if (!hasShortcutText) return []

 logger.info("AI", "未检测到外置 ai 输入，开始根据 shortcutInput 调用 AI。", () => summarizeInput(input))
 let items: AiGeneratedItem[] = []
 try {
 items = await generateAiItemsForShortcutInput(shortcutInput, config)
 } catch (error) {
 logger.warn("AI", "AI生成失败，已退回脚本本地解析原始输入", {
 error: getErrorMessage(error),
 fallbackRawText: shortcutInput.rawText || shortcutInput.webTitle || shortcutInput.inputUrl || ""
 })
 input.ai = {}
 input.shortcutInput = {
 ...shortcutInput,
 rawText: shortcutInput.rawText || shortcutInput.webTitle || shortcutInput.inputUrl || "",
 inputUrl: shortcutInput.inputUrl || ""
 }
 return []
 }
 const normalizedItems = Array.isArray(items)
 ? items
 .filter(Boolean)
 .map(item => normalizeAiGeneratedItem(item, shortcutInput.rawText || shortcutInput.webTitle || ""))
 : []

 if (!normalizedItems.length) {
 logger.warn("AI", "AI 未返回可用提醒事项 JSON，已退回脚本本地解析原始输入", {
 fallbackRawText: shortcutInput.rawText || shortcutInput.webTitle || shortcutInput.inputUrl || ""
 })
 input.ai = {}
 input.shortcutInput = {
 ...shortcutInput,
 rawText: shortcutInput.rawText || shortcutInput.webTitle || shortcutInput.inputUrl || "",
 inputUrl: shortcutInput.inputUrl || ""
 }
 return []
 }

 input.ai = {
 ...input.ai,
 ...normalizedItems[0]
 }
 input.shortcutInput = {
 ...shortcutInput,
 rawText: normalizedItems[0].rawText || shortcutInput.rawText || shortcutInput.webTitle || "",
 inputUrl: normalizedItems[0].url || shortcutInput.inputUrl || ""
 }

 logger.trace("AI", "AI 已生成提醒事项", () => summarizeAiItems(normalizedItems))
 return normalizedItems
}

function buildTags(config: AlertpilotConfig, input: AlertpilotInput): string {
 const locationTag = config["地点"][input.location || ""] || ""
 const customTag = input.tag ? `,${input.tag}` : ""
 return `${locationTag}${customTag} `
}

function inferScheduleKind(input: AlertpilotInput): "work" | "rest" {
 if (input.isLatestRestDay) return "rest"
 return input.location === "家" ? "rest" : "work"
}

function buildAdditionalNotification(output: AlertpilotOutput, lang: LanguagePack): string {
 return [
 output.classReminders !== "Reminders" ? `📋${lang.list}：${output.classReminders}` : "",
 output.note ? `📝${lang.note}：${output.note}` : "",
 output.url ? `🔗${lang.url}：${output.url}` : "",
 output.parentReminder ? `🔔${lang.PR}：${output.parentReminder}` : ""
 ]
 .filter(Boolean)
 .map(line => `\n${line}`)
 .join("")
}

function normalizeAiGeneratedItem(
 item: AiGeneratedItem,
 fallbackRawText: string
): AiGeneratedItem {
 const rawText = String(item.rawText || item.timeWord || item.text || fallbackRawText || "").trim()
 return {
 ...item,
 rawText,
 text: String(item.text || "").trim(),
 timeWord: String(item.timeWord || "").trim(),
 note: String(item.note || "").trim(),
 url: String(item.url || "").trim(),
 classReminders: String(item.classReminders || "").trim() || getDefaultReminderList,
 smartCategory: String(item.smartCategory || "").trim(),
 smartReason: String(item.smartReason || "").trim()
 }
}
