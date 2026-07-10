import { Navigation, Script } from "scripting"
import { HomeView } from "./components/HomeView"
import { getLatestRestDayInfo, getLatestWorkDayInfo, getRestDayInfo, setRestDayInfo, type RestDayKind } from "./utils/is_rest_day"

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback
}

function parseRestDayKind(value: string | undefined): RestDayKind {
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

function queryItems(): Record<string, unknown> {
  const params = (Script.queryParameters || {}) as Record<string, unknown>
  const items = params.items
  if (items && typeof items === "object" && !Array.isArray(items)) {
    return items as Record<string, unknown>
  }
  return {}
}

function queryValue(key: string): string | undefined {
  const params = (Script.queryParameters || {}) as Record<string, unknown>
  const items = queryItems()
  const value = params[key] ?? items[key]
  if (value === undefined || value === null) return undefined
  return String(value)
}

async function runAsCallableAction(): Promise<boolean> {
  const action = String(queryValue("action") ?? "").trim()
  if (!action) return false

  try {
    switch (action) {
      case "getLatestRestDay":
      case "latestRestDay":
      case "latest": {
        const info = await getLatestRestDayInfo({
          baseDate: queryValue("baseDate") || queryValue("date") || undefined,
          lookaheadDays: parsePositiveInteger(
            queryValue("lookaheadDays") ?? queryValue("lookbackDays"),
            370
          ),
        })
        Script.exit({ ok: true, action: "latest", ...info })
        return true
      }
      case "getLatestWorkDay":
      case "latestWorkDay":
      case "latestWork": {
        const info = await getLatestWorkDayInfo({
          baseDate: queryValue("baseDate") || queryValue("date") || undefined,
          lookaheadDays: parsePositiveInteger(
            queryValue("lookaheadDays") ?? queryValue("lookbackDays"),
            370
          ),
        })
        Script.exit({ ok: true, action: "latestWork", ...info })
        return true
      }
      case "isRestDay":
      case "check": {
        const dateKey = String(queryValue("date") ?? queryValue("baseDate") ?? "").trim()
        if (!dateKey) throw new Error("判断指定日期时请传入 date，格式 yyyy-mm-dd")
        const info = await getRestDayInfo(dateKey)
        Script.exit({ ok: true, action: "isRestDay", ...info })
        return true
      }
      case "setRestDay":
      case "writeRestDay":
      case "set":
      case "write": {
        const dateKey = String(queryValue("date") ?? "").trim()
        if (!dateKey) throw new Error("写入指定日期时请传入 date，格式 yyyy-mm-dd")
        const kind = parseRestDayKind(
          queryValue("kind")
          ?? queryValue("status")
          ?? queryValue("type")
          ?? queryValue("isRestDay")
        )
        const result = await setRestDayInfo(dateKey, {
          kind,
          note: queryValue("note") ?? queryValue("remark") ?? undefined,
        })
        Script.exit({
          ok: true,
          action: "setRestDay",
          ...result,
        })
        return true
      }
      default:
        Script.exit({
          ok: false,
          error: `未知调用动作：${action}`,
          supportedActions: ["getLatestRestDay", "getLatestWorkDay", "isRestDay", "setRestDay"],
        })
        return true
    }
  } catch (error) {
    Script.exit({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      supportedActions: ["getLatestRestDay", "getLatestWorkDay", "isRestDay", "setRestDay"],
    })
    return true
  }
}

async function run() {
  if (await runAsCallableAction()) return

  await Navigation.present({
    element: <HomeView />,
  })
  Script.exit()
}

void run()
