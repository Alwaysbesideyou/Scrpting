import { NavigationStack, Text, useEffect, useState } from "scripting"

import type { DayOverrideKind, HolidayCalendarSource } from "../types"
import { CalendarSettingsView } from "./CalendarSettingsView"
import { syncHolidayCalendarSource } from "../utils/holiday_calendar"
import {
  DEFAULT_HOLIDAY_SOURCE_ID,
  loadCustomAlarmState,
  saveCustomAlarmState,
} from "../utils/storage"

export function HomeView() {
  const [initialState, setInitialState] = useState<any>(null)
  const [holidaySources, setHolidaySources] = useState<HolidayCalendarSource[]>([])
  const [fixedOffWeekdays, setFixedOffWeekdays] = useState<number[]>([])
  const [dayOverrides, setDayOverrides] = useState<Record<string, DayOverrideKind>>({})
  const [dayNotes, setDayNotes] = useState<Record<string, string>>({})
  const [calendarRefreshing, setCalendarRefreshing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadState() {
      try {
        const state = await loadCustomAlarmState()
        setInitialState(state)
        setHolidaySources(state.holidaySources)
        setFixedOffWeekdays(state.fixedOffWeekdays)
        setDayOverrides(state.dayOverrides)
        setDayNotes(state.dayNotes)
      } catch (error) {
        console.error("加载状态失败:", error)
      } finally {
        setLoading(false)
      }
    }
    loadState()
  }, [])

  async function persistState(next: {
    holidaySources?: HolidayCalendarSource[]
    fixedOffWeekdays?: number[]
    dayOverrides?: Record<string, DayOverrideKind>
    dayNotes?: Record<string, string>
  }) {
    await saveCustomAlarmState({
      holidaySources: next.holidaySources ?? holidaySources,
      fixedOffWeekdays: next.fixedOffWeekdays ?? fixedOffWeekdays,
      dayOverrides: next.dayOverrides ?? dayOverrides,
      dayNotes: next.dayNotes ?? dayNotes,
    })
  }

  useEffect(() => {
    if (loading) return
    const today = new Date()
    const isJanFirst = today.getMonth() === 0 && today.getDate() === 1
    if (!isJanFirst) return

    const source = holidaySources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? holidaySources[0] ?? null
    if (!source) return

    const lastSyncedAt = source.lastSyncedAt ? new Date(source.lastSyncedAt) : null
    const alreadySyncedToday = Boolean(
      lastSyncedAt
      && lastSyncedAt.getFullYear() === today.getFullYear()
      && lastSyncedAt.getMonth() === today.getMonth()
      && lastSyncedAt.getDate() === today.getDate()
    )

    if (!alreadySyncedToday) {
      void refreshBuiltinHolidayCalendar({ showLoading: false })
    }
  }, [holidaySources, loading])

  async function refreshBuiltinHolidayCalendar(options?: { showLoading?: boolean }) {
    const source = holidaySources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? holidaySources[0] ?? null
    if (!source) return

    if (options?.showLoading !== false) setCalendarRefreshing(true)
    try {
      const synced = await syncHolidayCalendarSource(source)
      const nextSources = holidaySources.map((item) => (item.id === synced.id ? synced : item))
      setHolidaySources(nextSources)
      await persistState({ holidaySources: nextSources })
    } catch (error: any) {
      await (globalThis as any).alert(String(error?.message ?? error))
    } finally {
      if (options?.showLoading !== false) setCalendarRefreshing(false)
    }
  }

  if (loading) {
    return (
      <NavigationStack>
        <Text>加载中...</Text>
      </NavigationStack>
    )
  }

  return (
    <NavigationStack>
      <CalendarSettingsView
        embedded
        sources={holidaySources}
        fixedOffWeekdays={fixedOffWeekdays}
        dayOverrides={dayOverrides}
        dayNotes={dayNotes}
        onToggleFixedOffWeekday={async (weekday) => {
          setFixedOffWeekdays((current) => {
            const next = current.includes(weekday)
              ? current.filter((item) => item !== weekday)
              : [...current, weekday].sort((a, b) => a - b)
            return next
          })
          await persistState({ fixedOffWeekdays: fixedOffWeekdays.includes(weekday)
            ? fixedOffWeekdays.filter((item) => item !== weekday)
            : [...fixedOffWeekdays, weekday].sort((a, b) => a - b)
          })
        }}
        onSetDayOverride={async (dateKey, kind) => {
          const next = { ...dayOverrides }
          if (kind) next[dateKey] = kind
          else delete next[dateKey]
          setDayOverrides(next)
          await persistState({ dayOverrides: next })
        }}
        onSetDayNote={async (dateKey, note) => {
          const next = { ...dayNotes }
          const trimmed = note.trim()
          if (trimmed) next[dateKey] = trimmed.slice(0, 20)
          else delete next[dateKey]
          setDayNotes(next)
          await persistState({ dayNotes: next })
        }}
        onRefreshHolidaySource={() => void refreshBuiltinHolidayCalendar()}
        isRefreshing={calendarRefreshing}
      />
    </NavigationStack>
  )
}
