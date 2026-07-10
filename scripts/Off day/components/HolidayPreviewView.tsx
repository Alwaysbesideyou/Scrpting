import {
 Button,
 HStack,
 Image,
 Picker,
 Spacer,
 Text,
 TextField,
 VStack,
 ZStack,
 useColorScheme,
 useState,
 TabView,
} from "scripting"

import type { DayOverrideKind, HolidayCalendarSource } from "../types"
import { buildHolidayDayMap } from "../utils/holiday_calendar"

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"]
export const DAY_CELL_SIZE =43
export const DAY_CELL_GAP =4
const REST_FILL = "#DCFCE7"
const REST_TEXT = "#15803D"
const ADJUSTED_WORK_FILL = "#FEE2E2"
const ADJUSTED_WORK_TEXT = "#DC2626"
const DAY_CELL_BORDER = "#000000"
const TODAY_HIGHLIGHT_BORDER = "#FF3B30"
const DAY_CELL_CORNER_RADIUS =13
const DAY_CELL_INSET =1
const DAY_NUMBER_ROW_HEIGHT =16
const DAY_LABEL_ROW_HEIGHT =17
const DAY_TEXT_SPACING =2
export const CALENDAR_PANEL_CORNER_RADIUS =18
const MONTH_PAGE_CENTER =8
const MONTH_PAGE_OFFSETS = Array.from({ length: MONTH_PAGE_CENTER *2 +1 }, (_, index) => index - MONTH_PAGE_CENTER)

export function calendarPanelBackground(colorScheme: "light" | "dark") {
 return colorScheme === "dark" ? "#1C1C1E" : "#F2F2F7"
}

type DisplayKind = "off" | "work" | null

type DisplayDayInfo = {
 kind: DisplayKind
 label: string
}

type CalendarCell = {
 day: number
 dateKey: string
 kind: DisplayKind
 label: string
 note: string
 isCurrentMonth: boolean
 isAdjustedWork: boolean
 baseKind: DisplayKind
 baseIsAdjustedWork: boolean
 overrideKind: DayOverrideKind | null
}

function parseDateKey(key: string): Date | null {
 const match = String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/)
 if (!match) return null
 const date = new Date(Number(match[1]), Number(match[2]) -1, Number(match[3]),0,0,0,0)
 return Number.isNaN(date.getTime()) ? null : date
}

function formatDateKey(date: Date): string {
 const yyyy = date.getFullYear()
 const mm = String(date.getMonth() +1).padStart(2, "0")
 const dd = String(date.getDate()).padStart(2, "0")
 return `${yyyy}-${mm}-${dd}`
}

function monthTitle(year: number, month: number): string {
 return `${year}年${month}月`
}

function shiftMonth(year: number, month: number, offset: number): { year: number; month: number } {
 const date = new Date(year, month -1 + offset,1)
 return {
 year: date.getFullYear(),
 month: date.getMonth() +1,
 }
}

function mondayFirstWeekdayIndex(date: Date): number {
 return (date.getDay() +6) %7
}

function inferDefaultKind(date: Date, fixedOffWeekdays: number[]): DisplayKind {
 return fixedOffWeekdays.includes(date.getDay()) ? "off" : "work"
}

function labelForKind(kind: DisplayKind): string {
 return kind === "off" ? "休" : kind === "work" ? "班" : ""
}

function buildDisplayDayMap(
 source: HolidayCalendarSource,
 year: number,
 month: number,
 fixedOffWeekdays: number[],
 dayOverrides: Record<string, DayOverrideKind>
): Map<string, DisplayDayInfo> {
 const map = new Map<string, DisplayDayInfo>()
 const holidayMap = buildHolidayDayMap(source)

 const lastDay = new Date(year, month,0).getDate()
 for (let day =1; day <= lastDay; day +=1) {
 const date = new Date(year, month -1, day,0,0,0,0)
 const dateKey = formatDateKey(date)
 const overrideKind = dayOverrides[dateKey]
 if (overrideKind) {
 map.set(dateKey, {
 kind: overrideKind,
 label: labelForKind(overrideKind),
 })
 continue
 }

 const holidayInfo = holidayMap.get(dateKey)
 if (holidayInfo && holidayInfo.kind !== "unknown") {
 map.set(dateKey, {
 kind: holidayInfo.kind,
 label: labelForKind(holidayInfo.kind),
 })
 continue
 }

 const defaultKind = inferDefaultKind(date, fixedOffWeekdays)
 map.set(dateKey, {
 kind: defaultKind,
 label: labelForKind(defaultKind),
 })
 }

 return map
}

function cellForDate(
 date: Date,
 isCurrentMonth: boolean,
 fixedOffWeekdays: number[],
 dayOverrides: Record<string, DayOverrideKind>,
 dayNotes: Record<string, string>,
 holidayMap: Map<string, { kind: "off" | "work" | "unknown" }>
): CalendarCell {
 const dateKey = formatDateKey(date)
 const defaultKind = inferDefaultKind(date, fixedOffWeekdays)
 const holidayKind = holidayMap.get(dateKey)?.kind
 const effectiveHolidayKind = holidayKind && holidayKind !== "unknown" ? holidayKind : null
 const baseKind = effectiveHolidayKind ?? defaultKind
 const overrideKind = dayOverrides[dateKey]
 const kind = overrideKind ?? baseKind
 const baseIsAdjustedWork = baseKind === "work" && (defaultKind === "off" || effectiveHolidayKind === "off")
 const isAdjustedWork = kind === "work" && (defaultKind === "off" || effectiveHolidayKind === "off")
 return {
 day: date.getDate(),
 dateKey,
 kind,
 label: labelForKind(kind),
 note: dayNotes[dateKey] ?? "",
 isCurrentMonth,
 isAdjustedWork,
 baseKind,
 baseIsAdjustedWork,
 overrideKind: overrideKind ?? null,
 }
}

function buildCells(
 source: HolidayCalendarSource,
 year: number,
 month: number,
 fixedOffWeekdays: number[],
 dayOverrides: Record<string, DayOverrideKind>,
 dayNotes: Record<string, string>
): CalendarCell[] {
 const firstDay = new Date(year, month -1,1)
 const lastDay = new Date(year, month,0)
 const leading = mondayFirstWeekdayIndex(firstDay)
 const totalDays = lastDay.getDate()
 const holidayMap = buildHolidayDayMap(source)
 const cells: CalendarCell[] = []

 for (let i = leading; i >0; i -=1) {
 const date = new Date(year, month -1,1 - i,0,0,0,0)
 cells.push(cellForDate(date, false, fixedOffWeekdays, dayOverrides, dayNotes, holidayMap))
 }

 for (let day =1; day <= totalDays; day +=1) {
 const date = new Date(year, month -1, day,0,0,0,0)
 cells.push(cellForDate(date, true, fixedOffWeekdays, dayOverrides, dayNotes, holidayMap))
 }

 let trailingOffset =1
 while (cells.length %7 !==0) {
 const date = new Date(year, month, trailingOffset,0,0,0,0)
 cells.push(cellForDate(date, false, fixedOffWeekdays, dayOverrides, dayNotes, holidayMap))
 trailingOffset +=1
 }

 return cells
}

function dayCellFill(kind: DisplayKind, isAdjustedWork: boolean, colorScheme: "light" | "dark") {
 if (kind === "off") return REST_FILL
 if (isAdjustedWork) return ADJUSTED_WORK_FILL
 return colorScheme === "dark" ? "#3A3A3C" : "#E5E5EA"
}

function dayCellTextColor(kind: DisplayKind, isAdjustedWork: boolean, isCurrentMonth: boolean, colorScheme: "light" | "dark") {
 const color = kind === "off"
 ? REST_TEXT
 : isAdjustedWork
 ? ADJUSTED_WORK_TEXT
 : colorScheme === "dark" ? "#FFFFFF" : "#1C1C1E"
 if (isCurrentMonth) return color
 if (kind === "off") return "#4ADE80"
 if (isAdjustedWork) return "#F87171"
 return colorScheme === "dark" ? "#8E8E93" : "#8A8A8E"
}

function calendarGridHeightForCellCount(cellCount: number): number {
 const weekCount = Math.ceil(cellCount /7)
 return DAY_CELL_SIZE * weekCount + DAY_CELL_GAP * Math.max(0, weekCount -1)
}

export function WeekdayBlockCell(props: {
 label: string
 isOff: boolean
 colorScheme: "light" | "dark"
 onPress?: () => void
}) {
 const fill = props.isOff ? REST_FILL : dayCellFill("work", false, props.colorScheme)
 const textColor = props.isOff ? REST_TEXT : dayCellTextColor("work", false, true, props.colorScheme)
 const content = (
 <ZStack
 frame={{ width: DAY_CELL_SIZE, height: DAY_CELL_SIZE, alignment: "center" as any }}
 background={{ style: DAY_CELL_BORDER, shape: { type: "rect", cornerRadius: DAY_CELL_CORNER_RADIUS +1 } }}
 >
 <VStack
 spacing={DAY_TEXT_SPACING}
 frame={{ width: DAY_CELL_SIZE - DAY_CELL_INSET, height: DAY_CELL_SIZE - DAY_CELL_INSET, alignment: "center" as any }}
 padding={{ top:3, bottom:3, leading:2, trailing:2 }}
 background={{ style: fill, shape: { type: "rect", cornerRadius: DAY_CELL_CORNER_RADIUS } }}
 >
 <Text
 font="caption"
 foregroundStyle={textColor}
 frame={{ maxWidth: "infinity", height: DAY_NUMBER_ROW_HEIGHT, alignment: "center" as any }}
 >
 {props.label}
 </Text>
 <Text
 font="caption2"
 foregroundStyle={textColor}
 frame={{ maxWidth: "infinity", height: DAY_LABEL_ROW_HEIGHT, alignment: "center" as any }}
 >
 {props.isOff ? "休" : "班"}
 </Text>
 </VStack>
 </ZStack>
 )

 if (!props.onPress) return content

 return (
 <Button
 buttonStyle="plain"
 action={props.onPress}
 padding={0}
 >
 {content}
 </Button>
 )
}

function dayCellOverrideBadgeFill(overrideKind: DayOverrideKind | null, isCurrentMonth: boolean): string | null {
 if (!overrideKind) return null
 if (overrideKind === "off") return isCurrentMonth ? REST_TEXT : "#4ADE80"
 return isCurrentMonth ? ADJUSTED_WORK_TEXT : "#F87171"
}

function DayCell(props: {
 cell: CalendarCell
 isSelected: boolean
 isToday: boolean
 colorScheme: "light" | "dark"
 onSelect: (dateKey: string | null) => void
}) {
 const backgroundStyle = dayCellFill(props.cell.baseKind, props.cell.baseIsAdjustedWork, props.colorScheme)
 const textColor = dayCellTextColor(props.cell.baseKind, props.cell.baseIsAdjustedWork, props.cell.isCurrentMonth, props.colorScheme)
 const overrideBadgeFill = dayCellOverrideBadgeFill(props.cell.overrideKind, props.cell.isCurrentMonth)
 const innerSize = props.isSelected || props.isToday ? DAY_CELL_SIZE -4 : DAY_CELL_SIZE - DAY_CELL_INSET
 return (
 <Button
 buttonStyle="plain"
 action={() => props.onSelect(props.isSelected ? null : props.cell.dateKey)}
 padding={0}
 >
 <ZStack
 frame={{ width: DAY_CELL_SIZE, height: DAY_CELL_SIZE, alignment: "center" as any }}
 background={{ style: props.isSelected ? "#FFFFFF" : props.isToday ? TODAY_HIGHLIGHT_BORDER : DAY_CELL_BORDER, shape: { type: "rect", cornerRadius: DAY_CELL_CORNER_RADIUS +1 } }}
 >
 <ZStack
 alignment="top"
 frame={{
 width: innerSize,
 height: innerSize,
 alignment: "center" as any,
 }}
 background={{ style: backgroundStyle, shape: { type: "rect", cornerRadius: props.isSelected ?10 : DAY_CELL_CORNER_RADIUS } }}
 >
 <VStack
 spacing={DAY_TEXT_SPACING}
 frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
 padding={{ top:3, bottom:3, leading:2, trailing:2 }}
 >
 <Text
 font="caption"
 foregroundStyle={textColor}
 frame={{ maxWidth: "infinity", height: DAY_NUMBER_ROW_HEIGHT, alignment: "center" as any }}
 >
 {String(props.cell.day)}
 </Text>
 {props.cell.overrideKind && overrideBadgeFill ? (
 <Text
 font="caption2"
 foregroundStyle="#FFFFFF"
 frame={{ width: DAY_LABEL_ROW_HEIGHT, height: DAY_LABEL_ROW_HEIGHT, alignment: "center" as any }}
 background={{ style: overrideBadgeFill as any, shape: { type: "capsule", style: "continuous" } }}
 >
 {props.cell.label}
 </Text>
 ) : (
 <Text
 font="caption2"
 foregroundStyle={textColor}
 frame={{ maxWidth: "infinity", height: DAY_LABEL_ROW_HEIGHT, alignment: "center" as any }}
 >
 {props.cell.note ? props.cell.note.slice(0,2) : props.cell.label}
 </Text>
 )}
 </VStack>
 </ZStack>
 </ZStack>
 </Button>
 )
}

function MonthGridPanel(props: {
 pageTag: number
 year: number
 month: number
 cells: CalendarCell[]
 selectedDateKey: string | null
 todayDateKey: string
 gridHeight: number
 colorScheme: "light" | "dark"
 onSelect: (dateKey: string | null) => void
}) {
 const weeks = Array.from({ length: Math.ceil(props.cells.length /7) }, (_, index) => {
 return props.cells.slice(index *7, index *7 +7)
 })

 return (
 <VStack
 tag={props.pageTag}
 spacing={DAY_CELL_GAP}
 frame={{ maxWidth: "infinity", height: props.gridHeight, alignment: "top" as any }}
 >
 {weeks.map((week, index) => (
 <HStack
 key={`${props.year}-${props.month}-week-${index}`}
 spacing={DAY_CELL_GAP}
 frame={{ maxWidth: "infinity", alignment: "center" as any }}
 >
 {week.map((cell, cellIndex) => (
 <DayCell
 key={`${props.year}-${props.month}-${index}-${cellIndex}-${cell.dateKey}`}
 cell={cell}
 isSelected={cell.dateKey === props.selectedDateKey}
 isToday={cell.dateKey === props.todayDateKey}
 colorScheme={props.colorScheme}
 onSelect={props.onSelect}
 />
 ))}
 </HStack>
 ))}
 </VStack>
 )
}

export function HolidayCalendarMonthView(props: {
 source: HolidayCalendarSource
 fixedOffWeekdays: number[]
 dayOverrides: Record<string, DayOverrideKind>
 dayNotes: Record<string, string>
 onSetDayOverride: (dateKey: string, kind: DayOverrideKind | null) => void
 onSetDayNote: (dateKey: string, note: string) => void
}) {
 const colorScheme = useColorScheme()
 const now = new Date()
 const currentYear = now.getFullYear()
 const currentMonth = now.getMonth() +1
 const todayDateKey = formatDateKey(now)
 const [pageIndex, setPageIndex] = useState(MONTH_PAGE_CENTER)
 const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)
 const visibleMonth = shiftMonth(currentYear, currentMonth, pageIndex - MONTH_PAGE_CENTER)
 const year = visibleMonth.year
 const month = visibleMonth.month
 const cells = buildCells(props.source, year, month, props.fixedOffWeekdays, props.dayOverrides, props.dayNotes)
 const selectedCell = selectedDateKey ? cells.find((cell) => cell.dateKey === selectedDateKey) ?? null : null
 const calendarGridHeight = calendarGridHeightForCellCount(cells.length)

 function step(offset: number) {
 setSelectedDateKey(null)
 setPageIndex((current) => Math.max(0, Math.min(MONTH_PAGE_OFFSETS.length -1, current + offset)))
 }

 function handlePageIndexChanged(index: number) {
 setSelectedDateKey(null)
 setPageIndex(index)
 }

 function jumpToCurrentMonth() {
 setSelectedDateKey(null)
 setPageIndex(MONTH_PAGE_CENTER)
 }

 return (
 <VStack
 spacing={10}
 padding={{ top:4, bottom:2 }}
 frame={{ maxWidth: "infinity", alignment: "leading" as any }}
 >
 <HStack
 spacing={8}
 padding={{ top:4, bottom:4, leading:2, trailing:2 }}
 >
 <Button
 title=""
 systemImage="chevron.left"
 buttonStyle="plain"
 action={() => step(-1)}
 />
 <Spacer />
 <VStack spacing={2}>
 <Text font="headline">{monthTitle(year, month)}</Text>
 <Text font="caption" foregroundStyle="secondaryLabel">
 左右滑动切换月份，也可点上方箭头切换
 </Text>
 </VStack>
 <Spacer />
 <Button
 title=""
 systemImage="chevron.right"
 buttonStyle="plain"
 action={() => step(1)}
 />
 </HStack>

 <VStack
 spacing={8}
 padding={{ top:10, bottom:10, leading:6, trailing:6 }}
 frame={{ maxWidth: "infinity", alignment: "leading" as any }}
 shadow={{
 color: colorScheme === "dark" ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.06)",
 radius: colorScheme === "dark" ?10 :14,
 y: colorScheme === "dark" ?4 :6,
 }}
 background={{
 style: calendarPanelBackground(colorScheme),
 shape: { type: "rect", cornerRadius: CALENDAR_PANEL_CORNER_RADIUS },
 }}
 >
 <HStack spacing={0}>
 {WEEKDAY_LABELS.map((label) => (
 <Text
 key={`${year}-${month}-${label}`}
 font="caption"
 foregroundStyle="secondaryLabel"
 frame={{ maxWidth: "infinity", alignment: "center" as any }}
 >
 {label}
 </Text>
 ))}
 </HStack>

 <TabView
 tabIndex={pageIndex}
 onTabIndexChanged={handlePageIndexChanged}
 tabViewStyle="pageNeverDisplayIndex"
 indexViewStyle="pageBackgroundNeverDisplay"
 frame={{ maxWidth: "infinity", height: calendarGridHeight, alignment: "center" as any }}
 >
 {MONTH_PAGE_OFFSETS.map((offset) => {
 const pageTag = offset + MONTH_PAGE_CENTER
 const pageMonth = shiftMonth(currentYear, currentMonth, offset)
 const pageCells = buildCells(props.source, pageMonth.year, pageMonth.month, props.fixedOffWeekdays, props.dayOverrides, props.dayNotes)
 const isVisiblePage = offset === pageIndex - MONTH_PAGE_CENTER
 return (
 <MonthGridPanel
 key={`month-page-${offset}`}
 pageTag={pageTag}
 year={pageMonth.year}
 month={pageMonth.month}
 cells={pageCells}
 selectedDateKey={isVisiblePage ? selectedDateKey : null}
 todayDateKey={todayDateKey}
 colorScheme={colorScheme}
 gridHeight={calendarGridHeight}
 onSelect={isVisiblePage ? setSelectedDateKey : () => setPageIndex(pageTag)}
 />
 )
 })}
 </TabView>
 </VStack>

 {selectedCell ? (
 <VStack
 spacing={10}
 padding={{ top:12, bottom:12, leading:12, trailing:12 }}
 frame={{ maxWidth: "infinity", alignment: "leading" as any }}
 background={{
 style: colorScheme === "dark" ? "#1C1C1E" : "#FFFFFF",
 shape: { type: "rect", cornerRadius:16 },
 }}
 >
 <Text font="headline">编辑 {selectedCell.dateKey}</Text>
 <HStack spacing={8}>
 <Picker
 title="日期类型"
 pickerStyle="segmented"
 value={selectedCell.kind === "off" ? "off" : "work"}
 onChanged={(value: string) => props.onSetDayOverride(selectedCell.dateKey, value as DayOverrideKind)}
 >
 <Text tag="off">休息日</Text>
 <Text tag="work">工作日</Text>
 </Picker>
 <Button
 buttonStyle="plain"
 action={() => props.onSetDayOverride(selectedCell.dateKey, null)}
 padding={{ top:8, bottom:8, leading:10, trailing:10 }}
 background={{ style: selectedCell.overrideKind ? "#636366" : "#3A3A3C", shape: { type: "rect", cornerRadius:8 } }}
 >
 <Text font="caption" foregroundStyle={selectedCell.overrideKind ? "#FFFFFF" : "secondaryLabel"}>还原</Text>
 </Button>
 </HStack>
 <TextField
 title="注释"
 prompt="例如：年假、值班、出行"
 value={props.dayNotes[selectedCell.dateKey] ?? ""}
 onChanged={(value) => props.onSetDayNote(selectedCell.dateKey, value)}
 />
 <Text font="caption" foregroundStyle="secondaryLabel">
 当前有效状态：{selectedCell.kind === "off" ? "休息日" : "工作日"}。手动设置只会改变日期格第二行“休/班”的文字和颜色，背景仍按节假日/固定休息日规则显示。
 </Text>
 </VStack>
 ) : null}

 <HStack
 spacing={16}
 padding={{ top:2, bottom:2, leading:4, trailing:4 }}
 frame={{ maxWidth: "infinity", height:30, alignment: "leading" as any }}
 >
 <HStack spacing={6}>
 <Image systemName="circle.fill" foregroundStyle={REST_FILL} font="caption2" />
 <Text font="caption" foregroundStyle="secondaryLabel">休息日</Text>
 </HStack>
 <HStack spacing={6}>
 <Image systemName="circle.fill" foregroundStyle={dayCellFill("work", false, colorScheme)} font="caption2" />
 <Text font="caption" foregroundStyle="secondaryLabel">工作日</Text>
 </HStack>
 <HStack spacing={6}>
 <Image systemName="circle.fill" foregroundStyle={ADJUSTED_WORK_FILL} font="caption2" />
 <Text font="caption" foregroundStyle="secondaryLabel">手动</Text>
 </HStack>
 <Spacer />
 {(year !== currentYear || month !== currentMonth) ? (
 <Button
 buttonStyle="plain"
 action={jumpToCurrentMonth}
 padding={{ top:2, bottom:2, leading:6, trailing:6 }}
 background={{ style: "#2563EB", shape: { type: "rect", cornerRadius:7 } }}
 >
 <Text font="caption" foregroundStyle="#FFFFFF">回到本月</Text>
 </Button>
 ) : null}
 </HStack>
 </VStack>
 )
}
