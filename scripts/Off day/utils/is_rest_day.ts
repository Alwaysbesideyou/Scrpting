import type { DayOverrideKind, HolidayCalendarSource } from "../types"
import { buildHolidayDayMap } from "./holiday_calendar"
import { DEFAULT_HOLIDAY_SOURCE_ID, loadCustomAlarmState, setCustomDayState } from "./storage"

export type RestDayKind = "off" | "work"

export type RestDayInfo = {
  /** 传入的 yyyy-mm-dd 日期 */
  dateKey: string
  /** true 表示休息日，false 表示工作日 */
  isRestDay: boolean
  /** 最终生效的日期类型 */
  kind: RestDayKind
  /** 命中的规则来源 */
  source: "manual" | "holiday-calendar" | "fixed-weekday"
  /** 节假日日历标题，仅在命中日历时可能存在 */
  title?: string
  /** 手动备注 */
  note?: string
}

export type LatestRestDayInfo = RestDayInfo & {
  /** 搜索起点日期，格式 yyyy-mm-dd */
  baseDateKey: string
  /** 与搜索起点相差的天数，0 表示当天就是休息日 */
  daysUntil: number
}

export type LatestWorkDayInfo = RestDayInfo & {
  /** 搜索起点日期，格式 yyyy-mm-dd */
  baseDateKey: string
  /** 与搜索起点相差的天数，0 表示当天就是工作日 */
  daysUntil: number
}

export type RestDayCheckOptions = {
  /**
   * 指定周几固定休息，0=周日，1=周一，...，6=周六。
   * 不传时使用当前脚本设置里保存的固定休息日。
   */
  fixedOffWeekdays?: number[]
  /**
   * 指定手动覆盖记录。不传时使用当前脚本设置里保存的手动覆盖。
   */
  dayOverrides?: Record<string, DayOverrideKind>
  /**
   * 指定节假日日历源。不传时使用当前脚本设置里保存的中国节假日日历。
   */
  holidaySource?: HolidayCalendarSource
}

export type LatestRestDayOptions = RestDayCheckOptions & {
  /**
   * 搜索起点，支持 Date 或 yyyy-mm-dd；默认今天。
   */
  baseDate?: Date | string
  /**
   * 最多向未来查找多少天；默认 370 天。
   */
  lookaheadDays?: number
  /**
   * 兼容旧参数名。最多向未来查找多少天；默认 370 天。
   */
  lookbackDays?: number
}

export type LatestWorkDayOptions = RestDayCheckOptions & {
  /**
   * 搜索起点，支持 Date 或 yyyy-mm-dd；默认今天。
   */
  baseDate?: Date | string
  /**
   * 最多向未来查找多少天；默认 370 天。
   */
  lookaheadDays?: number
  /**
   * 兼容旧参数名。最多向未来查找多少天；默认 370 天。
   */
  lookbackDays?: number
}

export type RestDayWriteOptions = {
  kind: RestDayKind
  note?: string
}

export function formatDateKey(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function parseDateKey(dateKey: string): Date {
  const key = String(dateKey ?? "").trim()
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    throw new Error(`日期格式不正确：${dateKey}，请使用 yyyy-mm-dd`)
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 0, 0, 0, 0)

  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    throw new Error(`日期不存在：${dateKey}`)
  }

  return date
}

function parseBaseDate(baseDate: Date | string | undefined): Date {
  if (!baseDate) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
  }

  if (baseDate instanceof Date) {
    if (Number.isNaN(baseDate.getTime())) throw new Error("搜索起点日期不存在")
    const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0)
    return date
  }

  return parseDateKey(baseDate)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  next.setDate(next.getDate() + days)
  return next
}

function pickHolidaySource(sources: HolidayCalendarSource[]): HolidayCalendarSource | null {
  return sources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? sources[0] ?? null
}

function labelForKind(kind: RestDayKind): boolean {
  return kind === "off"
}

/**
 * 获取指定日期的休息日判断详情。
 *
 * 判断优先级：
 * 1. 手动设置的休息/工作日
 * 2. 已同步的节假日日历（包含法定放假和调休上班）
 * 3. 固定每周休息日（默认来自本脚本设置，通常为周六、周日）
 */
export async function getRestDayInfo(dateKey: string, options: RestDayCheckOptions = {}): Promise<RestDayInfo> {
  const date = parseDateKey(dateKey)
  const state = await loadCustomAlarmState()
  const fixedOffWeekdays = options.fixedOffWeekdays ?? state.fixedOffWeekdays
  const dayOverrides = options.dayOverrides ?? state.dayOverrides
  const holidaySource = options.holidaySource ?? pickHolidaySource(state.holidaySources)
  const note = state.dayNotes[dateKey] || undefined

  const overrideKind = dayOverrides[dateKey]
  if (overrideKind) {
    return {
      dateKey,
      isRestDay: labelForKind(overrideKind),
      kind: overrideKind,
      source: "manual",
      note,
    }
  }

  if (holidaySource) {
    const holidayInfo = buildHolidayDayMap(holidaySource).get(dateKey)
    if (holidayInfo?.kind === "off" || holidayInfo?.kind === "work") {
      return {
        dateKey,
        isRestDay: labelForKind(holidayInfo.kind),
        kind: holidayInfo.kind,
        source: "holiday-calendar",
        title: holidayInfo.title || undefined,
        note,
      }
    }
  }

  const kind: RestDayKind = fixedOffWeekdays.includes(date.getDay()) ? "off" : "work"
  return {
    dateKey,
    isRestDay: labelForKind(kind),
    kind,
    source: "fixed-weekday",
    note,
  }
}

/**
 * 批量获取多个日期的休息日判断详情（只加载一次状态）。
 */
export async function getRestDayInfoBatch(dateKeys: string[], options: RestDayCheckOptions = {}): Promise<RestDayInfo[]> {
  const state = await loadCustomAlarmState()
  const fixedOffWeekdays = options.fixedOffWeekdays ?? state.fixedOffWeekdays
  const dayOverrides = options.dayOverrides ?? state.dayOverrides
  const holidaySource = options.holidaySource ?? pickHolidaySource(state.holidaySources)
  const holidayDayMap = holidaySource ? buildHolidayDayMap(holidaySource) : null

  return dateKeys.map((dateKey) => {
    const date = parseDateKey(dateKey)
    const note = state.dayNotes[dateKey] || undefined

    const overrideKind = dayOverrides[dateKey]
    if (overrideKind) {
      return { dateKey, isRestDay: labelForKind(overrideKind), kind: overrideKind, source: "manual" as const, note }
    }

    if (holidayDayMap) {
      const holidayInfo = holidayDayMap.get(dateKey)
      if (holidayInfo?.kind === "off" || holidayInfo?.kind === "work") {
        return { dateKey, isRestDay: labelForKind(holidayInfo.kind), kind: holidayInfo.kind, source: "holiday-calendar" as const, title: holidayInfo.title || undefined, note }
      }
    }

    const kind: RestDayKind = fixedOffWeekdays.includes(date.getDay()) ? "off" : "work"
    return { dateKey, isRestDay: labelForKind(kind), kind, source: "fixed-weekday" as const, note }
  })
}

/**
 * 将指定日期写入为休息日或工作日，并附带备注。
 */
export async function setRestDayInfo(dateKey: string, options: RestDayWriteOptions): Promise<RestDayInfo> {
  parseDateKey(dateKey)
  await setCustomDayState(dateKey, options.kind, options.note)
  return await getRestDayInfo(dateKey)
}

/**
 * 判断指定日期（yyyy-mm-dd）是否为休息日。
 */
export async function isRestDay(dateKey: string, options?: RestDayCheckOptions): Promise<boolean> {
  const info = await getRestDayInfo(dateKey, options)
  return info.isRestDay
}

/**
 * 从指定日期（默认今天）开始向未来查找，返回最近一次休息日。
 *
 * 其他脚本可通过 Script.run 调用本脚本的 `getLatestRestDay` 动作获取同样结果。
 */
export async function getLatestRestDayInfo(options: LatestRestDayOptions = {}): Promise<LatestRestDayInfo> {
  const baseDate = parseBaseDate(options.baseDate)
  const baseDateKey = formatDateKey(baseDate)
  const lookaheadDays = options.lookaheadDays ?? options.lookbackDays ?? 370

  const mergedOptions: RestDayCheckOptions = {
    fixedOffWeekdays: options.fixedOffWeekdays,
    dayOverrides: options.dayOverrides,
    holidaySource: options.holidaySource,
  }

  const BATCH_SIZE = 5
  for (let batchStart = 0; batchStart <= lookaheadDays; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, lookaheadDays)
    const dateKeys = []
    for (let i = batchStart; i <= batchEnd; i++) {
      dateKeys.push(formatDateKey(addDays(baseDate, i)))
    }
    const results = await getRestDayInfoBatch(dateKeys, mergedOptions)
    for (let j = 0; j < results.length; j++) {
      if (results[j].isRestDay) {
        return { ...results[j], baseDateKey, daysUntil: batchStart + j }
      }
    }
  }

  return {
    dateKey: baseDateKey,
    isRestDay: false,
    kind: "work",
    source: "fixed-weekday",
    baseDateKey,
    daysUntil: -1,
  }
}

/**
 * 从指定日期（默认今天）开始向未来查找，返回下一次工作日。
 *
 * 其他脚本可通过 Script.run 调用本脚本的 `getLatestWorkDay` 动作获取同样结果。
 */
export async function getLatestWorkDayInfo(options: LatestWorkDayOptions = {}): Promise<LatestWorkDayInfo> {
  const baseDate = parseBaseDate(options.baseDate)
  const baseDateKey = formatDateKey(baseDate)
  const lookaheadDays = options.lookaheadDays ?? options.lookbackDays ?? 370

  const mergedOptions: RestDayCheckOptions = {
    fixedOffWeekdays: options.fixedOffWeekdays,
    dayOverrides: options.dayOverrides,
    holidaySource: options.holidaySource,
  }

  const BATCH_SIZE = 5
  for (let batchStart = 0; batchStart <= lookaheadDays; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, lookaheadDays)
    const dateKeys = []
    for (let i = batchStart; i <= batchEnd; i++) {
      dateKeys.push(formatDateKey(addDays(baseDate, i)))
    }
    const results = await getRestDayInfoBatch(dateKeys, mergedOptions)
    for (let j = 0; j < results.length; j++) {
      if (!results[j].isRestDay) {
        return { ...results[j], baseDateKey, daysUntil: batchStart + j }
      }
    }
  }

  return {
    dateKey: baseDateKey,
    isRestDay: true,
    kind: "off",
    source: "fixed-weekday",
    baseDateKey,
    daysUntil: -1,
  }
}
