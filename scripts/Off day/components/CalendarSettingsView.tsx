import {
  Form,
  HStack,
  Image,
  NavigationLink,
  NavigationStack,
  ProgressView,
  Section,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
  ZStack,
  Button,
  useColorScheme,
  useState,
} from "scripting"

import type { DayOverrideKind, HolidayCalendarSource } from "../types"
import { DEFAULT_HOLIDAY_SOURCE_ID } from "../utils/storage"
import { HolidayCalendarMonthView, WeekdayBlockCell, calendarPanelBackground, CALENDAR_PANEL_CORNER_RADIUS, DAY_CELL_GAP } from "./HolidayPreviewView"
import { RestDayDebugView } from "./RestDayDebugView"

const WEEKDAY_OPTIONS = [
  { label: "一", value: 1 },
  { label: "二", value: 2 },
  { label: "三", value: 3 },
  { label: "四", value: 4 },
  { label: "五", value: 5 },
  { label: "六", value: 6 },
  { label: "日", value: 0 },
]

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const min = String(date.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export function CalendarSettingsView(props: {
  sources: HolidayCalendarSource[]
  fixedOffWeekdays: number[]
  dayOverrides: Record<string, DayOverrideKind>
  dayNotes: Record<string, string>
  onToggleFixedOffWeekday: (weekday: number) => void
  onSetDayOverride: (dateKey: string, kind: DayOverrideKind | null) => void
  onSetDayNote: (dateKey: string, note: string) => void
  onRefreshHolidaySource: () => void
  embedded?: boolean
  isRefreshing?: boolean
}) {
  const colorScheme = useColorScheme()
  const [showFixedOffWeekdays, setShowFixedOffWeekdays] = useState(false)
  const source = props.sources.find((item) => item.id === DEFAULT_HOLIDAY_SOURCE_ID) ?? props.sources[0] ?? null
  const currentYear = new Date().getFullYear()
  const offCount = source
    ? new Set(
        source.holidayDates.filter((dateKey) => String(dateKey).startsWith(`${currentYear}-`))
      ).size
    : 0
  const workCount = source
    ? new Set(
        source.holidayItems
          .filter((item) => item.kind === "work" && String(item.dateKey).startsWith(`${currentYear}-`))
          .map((item) => item.dateKey)
      ).size
    : 0

  const content = (
    <ZStack>
      <Form
        navigationTitle="日历"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        toolbar={(
          <Toolbar>
            <ToolbarItem placement="topBarTrailing">
              <NavigationLink
                destination={(
                  <RestDayDebugView
                    source={source}
                    fixedOffWeekdays={props.fixedOffWeekdays}
                    dayOverrides={props.dayOverrides}
                  />
                )}
              >
                <Text foregroundStyle="#2563EB">调试</Text>
              </NavigationLink>
            </ToolbarItem>
          </Toolbar>
        )}
      >
          <Section header={<Text>固定休息日</Text>} footer={<Text>点击顶部按钮展开星期选择，绿色表示该星期为固定休息日。</Text>}>
            <Button
              buttonStyle="plain"
              action={() => setShowFixedOffWeekdays((current) => !current)}
            >
              <HStack
                spacing={12}
                padding={{ top: 8, bottom: 8 }}
                frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                contentShape="rect"
              >
                <Image
                  systemName="calendar.badge.checkmark"
                  foregroundStyle="#DCFCE7"
                  frame={{ width: 24, alignment: "center" as any }}
                />
                <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  {showFixedOffWeekdays ? "收起固定休息日" : "展开固定休息日"}
                </Text>
              </HStack>
            </Button>
            {showFixedOffWeekdays ? (
              <VStack
                spacing={10}
                padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }}
                background={{
                  style: calendarPanelBackground(colorScheme),
                  shape: { type: "rect", cornerRadius: CALENDAR_PANEL_CORNER_RADIUS },
                }}
              >
                <HStack
                  spacing={DAY_CELL_GAP}
                  frame={{ maxWidth: "infinity", alignment: "center" as any }}
                >
                  {WEEKDAY_OPTIONS.map((item) => {
                    const selected = props.fixedOffWeekdays.includes(item.value)
                    return (
                      <WeekdayBlockCell
                        key={`fixed-off-${item.value}`}
                        label={item.label}
                        isOff={selected}
                        colorScheme={colorScheme}
                        onPress={() => props.onToggleFixedOffWeekday(item.value)}
                      />
                    )
                  })}
                </HStack>
              </VStack>
            ) : null}
          </Section>

          <Section footer={<Text>点击日期可设置为工作日、休息日，也可以添加简短注释。浅色日期表示相邻月份。</Text>}>
            {source ? (
              <HolidayCalendarMonthView
                source={source}
                fixedOffWeekdays={props.fixedOffWeekdays}
                dayOverrides={props.dayOverrides}
                dayNotes={props.dayNotes}
                onSetDayOverride={props.onSetDayOverride}
                onSetDayNote={props.onSetDayNote}
              />
            ) : (
              <Text foregroundStyle="secondaryLabel">暂无可用日历数据。</Text>
            )}
          </Section>

          <Section header={
            <HStack spacing={8}>
              <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>中国节假日</Text>
              <Button
                buttonStyle="plain"
                action={props.onRefreshHolidaySource}
                padding={{ top: 3, bottom: 3, leading: 8, trailing: 8 }}
                background={{ style: "#2563EB", shape: { type: "rect", cornerRadius: 8 } }}
              >
                <HStack spacing={3}>
                  <Image systemName="arrow.clockwise" foregroundStyle="#FFFFFF" font="caption2" />
                  <Text font="caption" foregroundStyle="#FFFFFF">刷新</Text>
                </HStack>
              </Button>
            </HStack>
          }>
            <HStack spacing={12}>
              <Image systemName="calendar.badge.clock" foregroundStyle="#FF9500" />
              <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>数据源</Text>
              <Text foregroundStyle="secondaryLabel">{source?.title || "中国节假日"}</Text>
            </HStack>
            <HStack spacing={12}>
              <Image systemName="clock.arrow.circlepath" foregroundStyle="#2563EB" />
              <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>上次同步</Text>
              <Text foregroundStyle="secondaryLabel">{source?.lastSyncedAt ? formatDateTime(source.lastSyncedAt) : "尚未同步"}</Text>
            </HStack>
            <HStack spacing={12}>
              <Image systemName="sun.max.fill" foregroundStyle="#EA580C" />
              <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>休息日</Text>
              <Text foregroundStyle="secondaryLabel">{String(offCount)}</Text>
            </HStack>
            <HStack spacing={12}>
              <Image systemName="briefcase.fill" foregroundStyle="#2563EB" />
              <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>调班日</Text>
              <Text foregroundStyle="secondaryLabel">{String(workCount)}</Text>
            </HStack>
          </Section>
      </Form>

      {props.isRefreshing ? (
        <VStack
          spacing={12}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
          contentShape="rect"
        >
          <VStack
            spacing={12}
            padding={{ top: 20, bottom: 20, leading: 24, trailing: 24 }}
            shadow={{
              color: colorScheme === "dark" ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)",
              radius: 20,
              y: 8,
            }}
            background={{
              style: colorScheme === "dark" ? "#1F1F22" : "#FFFFFF",
              shape: { type: "rect", cornerRadius: 20 },
            }}
          >
            <ProgressView progressViewStyle="circular" />
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              正在刷新节假日日历...
            </Text>
          </VStack>
        </VStack>
      ) : null}
    </ZStack>
  )

  if (props.embedded) return content

  return (
    <NavigationStack>
      {content}
    </NavigationStack>
  )
}
