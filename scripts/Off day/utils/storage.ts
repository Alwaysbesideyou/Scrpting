import type {
  CalendarState,
  DayOverrideKind,
  HolidayCalendarSource,
} from "../types"
import { loadCalendarState, saveCalendarState, setDayOverride, getDayOverride, deleteDayOverride } from "./database"

export const DEFAULT_HOLIDAY_SOURCE_ID = "cn-holiday-calendar"
export const DEFAULT_HOLIDAY_URL = "https://calendars.icloud.com/holidays/cn_zh.ics"

const DEFAULT_FIXED_OFF_WEEKDAYS = [0, 6]

function defaultHolidaySource(): HolidayCalendarSource {
  return {
    id: DEFAULT_HOLIDAY_SOURCE_ID,
    title: "中国节假日",
    url: DEFAULT_HOLIDAY_URL,
    holidayDates: [],
    holidayItems: [],
    lastSyncedAt: null,
  }
}

function emptyState(): CalendarState {
  return {
    holidaySources: [defaultHolidaySource()],
    fixedOffWeekdays: [...DEFAULT_FIXED_OFF_WEEKDAYS],
    dayOverrides: {},
    dayNotes: {},
  }
}

function builtinHolidaySource(sources: HolidayCalendarSource[]): HolidayCalendarSource {
  return sources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? defaultHolidaySource()
}

function normalizeHolidayItemKind(value: unknown): "off" | "work" | "unknown" {
  switch (value) {
    case "off":
    case "work":
      return value
    default:
      return "unknown"
  }
}

function inferHolidayItemKind(title: string): "off" | "work" | "unknown" {
  if (/(补班|上班|调班|工作日|值班|班)/.test(title)) return "work"
  if (/(放假|休假|休息|假期|除夕|元旦|春节|清明节?|劳动节?|五一|端午节?|中秋节?|国庆节?)/.test(title)) {
    return "off"
  }
  return "unknown"
}

function normalizeHolidaySource(value: any): HolidayCalendarSource | null {
  if (!value || typeof value !== "object") return null
  const id = String(value.id ?? "").trim()
  const url = String(value.url ?? "").trim()
  if (!id || !url) return null

  const holidayItems = Array.isArray(value.holidayItems)
    ? (value.holidayItems as unknown[])
        .map((item: unknown): HolidayCalendarSource["holidayItems"][number] | null => {
          if (!item || typeof item !== "object") return null
          const dateKey = String((item as any).dateKey ?? "").trim()
          const title = String((item as any).title ?? "").trim()
          if (!dateKey) return null
          const kind: "off" | "work" | "unknown" = (() => {
            const explicit = normalizeHolidayItemKind((item as any).kind)
            const inferred = inferHolidayItemKind(title)
            if (inferred !== "unknown") return inferred
            return explicit === "work" ? "work" : "unknown"
          })()
          return {
            id: String((item as any).id ?? `${dateKey}-${title}`),
            dateKey,
            title: title || "节假日",
            kind,
          }
        })
        .filter((item: HolidayCalendarSource["holidayItems"][number] | null): item is HolidayCalendarSource["holidayItems"][number] => Boolean(item))
    : []

  const holidayDates = holidayItems.length
    ? Array.from(
        new Set(
          holidayItems
            .filter((item) => item.kind === "off")
            .map((item) => item.dateKey)
        )
      ).sort((a, b) => a.localeCompare(b))
    : Array.isArray(value.holidayDates)
      ? (value.holidayDates as unknown[]).map((item: unknown) => String(item)).filter(Boolean)
      : []

  return {
    id,
    title: id === DEFAULT_HOLIDAY_SOURCE_ID ? "中国节假日" : String(value.title ?? "").trim(),
    url: id === DEFAULT_HOLIDAY_SOURCE_ID ? DEFAULT_HOLIDAY_URL : url,
    holidayDates,
    holidayItems,
    lastSyncedAt: Number.isFinite(Number(value.lastSyncedAt))
      ? Number(value.lastSyncedAt)
      : null,
  }
}

function normalizeFixedOffWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_FIXED_OFF_WEEKDAYS]
  const result = Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
    )
  ).sort((a, b) => a - b)
  return result.length ? result : [...DEFAULT_FIXED_OFF_WEEKDAYS]
}

function normalizeDayOverrides(value: unknown): Record<string, DayOverrideKind> {
  if (!value || typeof value !== "object") return {}
  const result: Record<string, DayOverrideKind> = {}
  for (const [key, kind] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
    if (kind === "off" || kind === "work") result[key] = kind
  }
  return result
}

function normalizeDayNotes(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {}
  const result: Record<string, string> = {}
  for (const [key, note] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
    const text = String(note ?? "").trim()
    if (text) result[key] = text.slice(0, 20)
  }
  return result
}

function normalizeCalendarState(state: CalendarState): CalendarState {
  return {
    holidaySources: [builtinHolidaySource(state.holidaySources)],
    fixedOffWeekdays: normalizeFixedOffWeekdays(state.fixedOffWeekdays),
    dayOverrides: normalizeDayOverrides(state.dayOverrides),
    dayNotes: normalizeDayNotes(state.dayNotes),
  }
}

export async function loadCustomAlarmState(): Promise<CalendarState> {
  try {
    const state = await loadCalendarState()
    // 如果数据库为空，返回默认状态
    if (state.holidaySources.length === 0 && state.fixedOffWeekdays.length === 0) {
      return emptyState()
    }
    return normalizeCalendarState(state)
  } catch (error) {
    console.error("加载日历状态失败:", error)
    return emptyState()
  }
}

export async function saveCustomAlarmState(state: CalendarState): Promise<void> {
  const normalized = normalizeCalendarState(state)
  await saveCalendarState(normalized)
}

export async function setCustomDayState(dateKey: string, kind: DayOverrideKind, note?: string): Promise<CalendarState> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`日期格式不正确：${dateKey}，请使用 yyyy-mm-dd`)
  }
  if (kind !== "off" && kind !== "work") {
    throw new Error(`日期类型不正确：${String(kind)}，请使用 off 或 work`)
  }

  const trimmedNote = String(note ?? "").trim().slice(0, 20)
  await setDayOverride(dateKey, kind, trimmedNote || undefined)

  // 重新加载完整状态
  return await loadCustomAlarmState()
}

export async function getCustomDayState(dateKey: string): Promise<{ kind: DayOverrideKind; note?: string } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`日期格式不正确：${dateKey}，请使用 yyyy-mm-dd`)
  }
  return await getDayOverride(dateKey)
}

export async function removeCustomDayState(dateKey: string): Promise<CalendarState> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`日期格式不正确：${dateKey}，请使用 yyyy-mm-dd`)
  }
  await deleteDayOverride(dateKey)
  return await loadCustomAlarmState()
}
