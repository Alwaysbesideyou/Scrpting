export type HolidayCalendarSource = {
  id: string
  title: string
  url: string
  holidayDates: string[]
  holidayItems: Array<{
    id: string
    dateKey: string
    title: string
    kind: "off" | "work" | "unknown"
  }>
  lastSyncedAt: number | null
}

export type DayOverrideKind = "off" | "work"

export type CalendarState = {
  holidaySources: HolidayCalendarSource[]
  fixedOffWeekdays: number[]
  dayOverrides: Record<string, DayOverrideKind>
  dayNotes: Record<string, string>
}
