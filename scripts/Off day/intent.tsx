import { Intent, Script } from "scripting"
import { getLatestRestDayInfo, getLatestWorkDayInfo, getRestDayInfo, setRestDayInfo, type RestDayKind } from "./utils/is_rest_day"

const SUPPORTED_ACTIONS = ["latest", "getLatestRestDay", "latestWork", "getLatestWorkDay", "isRestDay", "check", "setRestDay", "writeRestDay", "set", "write"]

type IntentInput = {
  action?: string
  date?: string
  baseDate?: string
  kind?: string
  status?: string
  type?: string
  isRestDay?: string | boolean | number
  note?: string
  remark?: string
  lookaheadDays?: number | string
  lookbackDays?: number | string
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback
}

function parseTextInput(text: string): IntentInput {
  const trimmed = text.trim()
  if (!trimmed) return {}

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as IntentInput
    }
  } catch {
    // Continue parsing plain text below.
  }

  const parts = trimmed.split(/[\s,;&]+/).filter(Boolean)
  const result: IntentInput = {}

  for (const part of parts) {
    const separatorIndex = part.indexOf("=") >= 0 ? part.indexOf("=") : part.indexOf(":")
    if (separatorIndex > 0) {
      const key = part.slice(0, separatorIndex).trim()
      const value = part.slice(separatorIndex + 1).trim()
      if (key) (result as Record<string, string>)[key] = value
    }
  }

  if (Object.keys(result).length > 0) return result

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { action: "isRestDay", date: trimmed }
  }

  return { action: trimmed }
}

function getIntentInput(): IntentInput {
  const parameter = Intent.shortcutParameter
  if (!parameter) return {}

  if (parameter.type === "json" && parameter.value && typeof parameter.value === "object" && !Array.isArray(parameter.value)) {
    return parameter.value as IntentInput
  }

  if (parameter.type === "text") {
    return parseTextInput(parameter.value)
  }

  return {}
}

function normalizeAction(input: IntentInput): "latest" | "latestWork" | "isRestDay" | "setRestDay" {
  const action = String(input.action ?? (input.kind || input.status || input.type || input.isRestDay !== undefined ? "setRestDay" : input.date ? "isRestDay" : "latest")).trim()

  switch (action) {
    case "latest":
    case "latestRestDay":
    case "getLatestRestDay":
    case "最近休息日":
      return "latest"
    case "latestWork":
    case "latestWorkDay":
    case "getLatestWorkDay":
    case "最近工作日":
      return "latestWork"
    case "isRestDay":
    case "check":
    case "date":
    case "指定日期":
    case "判断日期":
      return "isRestDay"
    case "setRestDay":
    case "writeRestDay":
    case "set":
    case "write":
    case "写入":
    case "设置日期":
      return "setRestDay"
    default:
      throw new Error(`未知动作：${action}。支持：${SUPPORTED_ACTIONS.join(", ")}`)
  }
}

function parseRestDayKind(value: unknown): RestDayKind {
  const text = String(value ?? "").trim()
  switch (text) {
    case "off":
    case "rest":
    case "休息日":
    case "休息":
    case "休":
    case "true":
    case "1":
      return "off"
    case "work":
    case "工作日":
    case "工作":
    case "班":
    case "false":
    case "0":
      return "work"
    default:
      throw new Error(`日期类型不正确：${text || "空"}，请使用 off/rest/休息日 或 work/工作日`)
  }
}

async function runIntent() {
  try {
    const input = getIntentInput()
    const action = normalizeAction(input)

    if (action === "isRestDay") {
      const dateKey = String(input.date ?? input.baseDate ?? "").trim()
      if (!dateKey) throw new Error("判断指定日期时请传入 date，格式 yyyy-mm-dd")
      const info = await getRestDayInfo(dateKey)
      Script.exit(Intent.json({
        ok: true,
        action: "isRestDay",
        ...info,
      }))
      return
    }

    if (action === "setRestDay") {
      const dateKey = String(input.date ?? "").trim()
      if (!dateKey) throw new Error("写入指定日期时请传入 date，格式 yyyy-mm-dd")
      const kind = parseRestDayKind(input.kind ?? input.status ?? input.type ?? input.isRestDay)
      const result = await setRestDayInfo(dateKey, {
        kind,
        note: input.note ?? input.remark,
      })
      Script.exit(Intent.json({
        ok: true,
        action: "setRestDay",
        ...result,
      }))
      return
    }

    if (action === "latestWork") {
      const lookaheadDays = parsePositiveInteger(input.lookaheadDays ?? input.lookbackDays, 370)
      const latestWorkInfo = await getLatestWorkDayInfo({
        baseDate: input.baseDate || input.date || undefined,
        lookaheadDays,
      })
      Script.exit(Intent.json({
        ok: true,
        action: "latestWork",
        ...latestWorkInfo,
      }))
      return
    }

    const lookaheadDays = parsePositiveInteger(input.lookaheadDays ?? input.lookbackDays, 370)
    const latestInfo = await getLatestRestDayInfo({
      baseDate: input.baseDate || input.date || undefined,
      lookaheadDays,
    })
    Script.exit(Intent.json({
      ok: true,
      action: "latest",
      ...latestInfo,
    }))
  } catch (error) {
    Script.exit(Intent.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      examples: [
        { action: "latest", baseDate: "2026-05-16", lookaheadDays: 370 },
        { action: "latestWork", baseDate: "2026-05-16", lookaheadDays: 370 },
        { action: "isRestDay", date: "2026-05-16" },
        { action: "setRestDay", date: "2026-05-16", kind: "off", note: "年假" },
      ],
    }))
  }
}

runIntent()
