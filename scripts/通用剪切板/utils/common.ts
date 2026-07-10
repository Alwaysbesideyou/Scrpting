import { playCaisHaptic } from "./feedback"

export function makeId(prefix = "clip"): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim()
}

export function normalizeClipContent(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n")
}

export function isLikelyURL(value: string): boolean {
  const text = value
  if (!text || /\s/.test(text)) return false
  return /^https?:\/\/[^\s]+$/i.test(text) || /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(text)
}

export function clipTitle(kind: string, content: string): string {
  if (kind === "image") return "图片"
  const firstLine = content.split("\n").map((line) => line.trim()).find(Boolean) ?? ""
  if (!firstLine) return kind === "url" ? "链接" : "文本"
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine
}

export function hashString(input: string): string {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

const WEEK_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const

/** 获取某天 00:00:00 的 Date 对象 */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 获取本周一 00:00:00（周一为每周第一天） */
function mondayOfWeek(d: Date): Date {
  const s = startOfDay(d)
  const day = s.getDay() // 0=周日, 1=周一, ...
  const offset = day === 0 ? 6 : day - 1 // 距本周一的天数
  return new Date(s.getTime() - offset * 86400000)
}

export function formatDateTime(timestamp?: number | null): string {
  if (!timestamp) return "暂无"
  try {
    const date = new Date(timestamp)
    const now = new Date()

    const todayStart = startOfDay(now)
    const dateStart = startOfDay(date)
    const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / 86400000)

    const hh = String(date.getHours()).padStart(2, "0")
    const mm = String(date.getMinutes()).padStart(2, "0")
    const time = `${hh}:${mm}`

    // 1. 今天
    if (diffDays === 0) return `今天 ${time}`

    // 2. 昨天
    if (diffDays === 1) return `昨天 ${time}`

    // 3. 本周内（前天 ~ 本周一）
    const thisWeekMonday = mondayOfWeek(now)
    if (dateStart >= thisWeekMonday) {
      return `${WEEK_NAMES[date.getDay()]} ${time}`
    }

    // 4. 上周（上周一 ~ 上周日）
    const lastWeekMonday = new Date(thisWeekMonday.getTime() - 7 * 86400000)
    const lastWeekSunday = new Date(thisWeekMonday.getTime() - 86400000)
    if (dateStart >= lastWeekMonday && dateStart <= lastWeekSunday) {
      return `上周${WEEK_NAMES[date.getDay()]} ${time}`
    }

    // 5. 今年但早于上周
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getMonth() + 1}月${date.getDate()}号 ${time}`
    }

    // 6. 去年或更早
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}号 ${time}`
  } catch {
    return String(timestamp)
  }
}

export function summarizeContent(content: string, limit = 140): string {
  const normalized = content.replace(/\r\n/g, "\n")
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

export function withHaptic(action: () => void | Promise<void>) {
  return () => {
    playCaisHaptic()
    void action()
  }
}
