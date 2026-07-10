import type { AlertpilotInput, AlertpilotOutput, AiInput, LogEntry } from "./types"
import { pad2 } from "./utils"

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace"

export type LogStage =
 | "SYSTEM"
 | "INPUT"
 | "AI"
 | "MATCH"
 | "TRANSFORM"
 | "OUTPUT"
 | "SCHEDULE"
 | "SAVE"

export type StructuredLogEntry = LogEntry & {
 step?: number
 level: LogLevel
 stage: LogStage | string
 message: string
 raw?: unknown
 at: string
}

export type LoggerOptions = {
 level?: LogLevel | string
 onLog?: (entry: StructuredLogEntry | unknown) => void
 maxConsoleTextLength?: number
}

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
 error:0,
 warn:1,
 info:2,
 debug:3,
 trace:4
}

const STAGE_LABEL: Record<string, string> = {
 SYSTEM: "🧩SYSTEM",
 INPUT: "🚀START",
 AI: "🤖AI",
 MATCH: "🔍PARSE",
 TRANSFORM: "⏱️PARSE",
 OUTPUT: "✅OUTPUT",
 SCHEDULE: "📅SCHEDULE",
 SAVE: "💾SAVE"
}

export function normalizeLogLevel(level?: string): LogLevel {
 const normalized = String(level || "info").toLowerCase()
 return isLogLevel(normalized) ? normalized : "info"
}

export function isLogLevel(value: string): value is LogLevel {
 return value === "error" || value === "warn" || value === "info" || value === "debug" || value === "trace"
}

export function shouldLogLevel(entryLevel: LogLevel, currentLevel: LogLevel): boolean {
 if (currentLevel === "trace") {
 return entryLevel === "trace" || LOG_LEVEL_WEIGHT[entryLevel] <= LOG_LEVEL_WEIGHT.info
 }

 if (currentLevel === "debug") {
 return entryLevel === "debug" || LOG_LEVEL_WEIGHT[entryLevel] <= LOG_LEVEL_WEIGHT.info
 }

 return LOG_LEVEL_WEIGHT[entryLevel] <= LOG_LEVEL_WEIGHT[currentLevel]
}

export function createStructuredLog(
 step: number | undefined,
 level: LogLevel,
 stage: LogStage | string,
 message: string,
 raw?: unknown
): StructuredLogEntry {
 return {
 ...(step ? { step } : {}),
 level,
 stage,
 message,
 ...(raw === undefined ? {} : { raw }),
 at: formatLocalIsoTimestamp(new Date())
 }
}

function formatLocalIsoTimestamp(date: Date): string {
 const offsetMinutes = -date.getTimezoneOffset()
 const sign = offsetMinutes >=0 ? "+" : "-"
 const absMinutes = Math.abs(offsetMinutes)
 const offsetHour = pad2(Math.floor(absMinutes /60))
 const offsetMinute = pad2(absMinutes %60)
 return `${date.getFullYear()}-${pad2(date.getMonth() +1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3,"0")}${sign}${offsetHour}:${offsetMinute}`
}

export function formatConsoleLog(entry: StructuredLogEntry, maxTextLength =300): string {
 const stage = STAGE_LABEL[entry.stage] || String(entry.stage || "LOG")
 const header = `【${stage}】${entry.message}`
 const raw = entry.raw === undefined
 ? ""
 : `\n${formatReadableDetail(entry.raw, maxTextLength)}`

 return `${header}${raw}`
}

export function formatReadableDetail(value: unknown, maxTextLength =300): string {
 const compacted = compactLogValue(value)
 if (compacted === undefined) return ""

 if (typeof compacted === "string") return truncateText(compacted, maxTextLength)
 if (typeof compacted === "number" || typeof compacted === "boolean" || compacted == null) return String(compacted)

 if (Array.isArray(compacted)) {
 return compacted.map(item => `- ${formatInlineValue(item, maxTextLength)}`).join("\n")
 }

 return Object.entries(compacted as Record<string, unknown>)
 .map(([key, item]) => `${key}: ${formatInlineValue(item, maxTextLength)}`)
 .join("\n")
}

export function formatCompactValue(value: unknown, maxTextLength =300): string {
 if (typeof value === "string") return truncateText(value, maxTextLength)
 if (typeof value === "number" || typeof value === "boolean" || value == null) return String(value)

 try {
 return truncateText(JSON.stringify(compactLogValue(value), null,2), maxTextLength *3)
 } catch {
 return truncateText(String(value), maxTextLength)
 }
}

export function compactLogValue<T = unknown>(value: T): T | undefined {
 if (isEmptyLogValue(value)) return undefined

 if (Array.isArray(value)) {
 const items = value
 .map(item => compactLogValue(item))
 .filter(item => item !== undefined)
 return (items.length ? items : undefined) as T | undefined
 }

 if (value && typeof value === "object") {
 const entries = Object.entries(value as Record<string, unknown>)
 .map(([key, item]) => [key, compactLogValue(item)] as const)
 .filter(([, item]) => item !== undefined)

 if (!entries.length) return undefined
 return Object.fromEntries(entries) as T
 }

 return value
}

function isEmptyLogValue(value: unknown): boolean {
 if (value === undefined || value === null) return true
 if (typeof value === "string") return value.trim() === ""
 if (typeof value === "boolean") return value === false
 if (Array.isArray(value)) return value.length ===0
 if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length ===0
 return false
}

function formatInlineValue(value: unknown, maxTextLength =300): string {
 const compacted = compactLogValue(value)
 if (compacted === undefined) return ""

 if (typeof compacted === "string") return truncateText(compacted, maxTextLength)
 if (typeof compacted === "number" || typeof compacted === "boolean" || compacted == null) return String(compacted)

 if (Array.isArray(compacted)) {
 return compacted.map(item => formatInlineValue(item, maxTextLength)).filter(Boolean).join("；")
 }

 return Object.entries(compacted as Record<string, unknown>)
 .map(([key, item]) => `${key}=${formatInlineValue(item, Math.max(80, Math.floor(maxTextLength /2)))}`)
 .filter(line => !line.endsWith("="))
 .join("；")
}

export function truncateText(text: string, maxLength =300): string {
 const value = String(text || "")
 if (value.length <= maxLength) return value
 return `${value.slice(0, maxLength)}…（已截断 ${value.length - maxLength} 字）`
}

export function summarizeInput(input: AlertpilotInput) {
 const shortcutInput = input.shortcutInput || {}
 return compactLogValue({
 rawText: truncateText(shortcutInput.rawText || input.ai?.rawText || "",180),
 finalText: truncateText(input.finalText || input.ai?.text || "",180),
 inputUrl: shortcutInput.inputUrl || input.url || input.ai?.url || "",
 webTitle: truncateText(shortcutInput.webTitle || "",120),
 useAI: input.useAI,
 ai: summarizeAiItem(input.ai)
 })
}

export function summarizeAiItem(item?: Partial<AiInput>) {
 if (!item) return undefined
 return compactLogValue({
 rawText: truncateText(item.rawText || "",180),
 text: item.text || "",
 isSummary: item.isSummary,
 classReminders: item.classReminders || "",
 timeWord: item.timeWord || "",
 note: truncateText(item.note || "",180),
 url: item.url || "",
 smartCategory: item.smartCategory || "",
 smartReason: truncateText(item.smartReason || "",120)
 })
}

export function summarizeAiItems(items: Partial<AiInput>[]) {
 return compactLogValue({
 count: items.length,
 items: items.map(summarizeAiItem)
 })
}

export function summarizeMatch(input: AlertpilotInput, output?: AlertpilotOutput) {
 return compactLogValue({
 finalText: input.finalText || input.ai?.text || "",
 timeText: input.ai?.timeWord || input.rawTime || input.daypart || input.otherTime || "",
 matched: {
 url: input.url || "",
 note: truncateText(input.note || "",180),
 parentReminder: input.parentReminder || "",
 classReminders: input.classReminders || output?.classReminders || "",
 location: input.location || "",
 tag: input.tag || "",
 festival: input.festival || "",
 month: input.month || "",
 week: input.week || "",
 otherTime: input.otherTime || "",
 rawTime: input.rawTime || "",
 daypart: input.daypart || "",
 priority: input.priority || "",
 restMode: input.isLatestRestDay || false
 }
 })
}

export function summarizeTransform(input: AlertpilotInput) {
 return compactLogValue({
 timeWord: input.ai?.timeWord || "",
 rawTime: input.rawTime || "",
 daypart: input.daypart || "",
 otherTime: input.otherTime || "",
 month: input.month || "",
 week: input.week || "",
 time: input.time || "",
 finalDate: input.finalDate ? input.finalDate.toISOString() : "",
 location: input.location || ""
 })
}

export function summarizeOutput(output: AlertpilotOutput) {
 return compactLogValue({
 text: output.text || "",
 specifiedDate: output.specifiedDate || "",
 classReminders: output.classReminders || "",
 tags: output.tags || "",
 priority: output.priority || "",
 note: truncateText(output.note || "",180),
 scheduleKind: output.scheduleKind || "",
 url: output.url || "",
 parentReminder: output.parentReminder || "",
 addtionalNotification: truncateText(output.addtionalNotification || "",180),
 error: output.error,
 message: output.message
 })
}
