/**
 * RestDayDebugView - 调试页面
 *
 * 功能：
 * 1. 显示选中日期的休息/工作状态
 * 2. 显示下一个休息日和下一个工作日
 * 3. 提供快捷指令、直接调用、脚本输出的示例（点击代码区域右上角复制按钮复制）
 */
import {
  DatePicker,
  Form,
  HStack,
  Image,
  Markdown,
  Section,
  Text,
  useState,
  useEffect,
} from "scripting"

import type { DayOverrideKind, HolidayCalendarSource } from "../types"
import { getLatestRestDayInfo, getLatestWorkDayInfo, getRestDayInfo } from "../utils/is_rest_day"

function formatDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function startOfDayTimestamp(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime()
}

function latestRestDayText(dateKey: string, daysUntil: number): string {
  if (daysUntil === 0) return `${dateKey}（今天）`
  return `${dateKey}（${daysUntil} 天后）`
}

function latestWorkDayText(dateKey: string, daysUntil: number): string {
  if (daysUntil === 0) return `${dateKey}（今天）`
  return `${dateKey}（${daysUntil} 天后）`
}

const SHORTCUT_USAGE_EXAMPLE = `## 快捷指令调用示例

### 查询最近休息日

~~~json
{
  "action": "latest",
  "baseDate": "2026-05-16",
  "lookaheadDays": 370
}
~~~

### 查询下一个工作日

~~~json
{
  "action": "latestWork",
  "baseDate": "2026-05-16",
  "lookaheadDays": 370
}
~~~

### 判断指定日期是否休息

~~~json
{
  "action": "isRestDay",
  "date": "2026-05-16"
}
~~~

### 写入指定日期为休息日/工作日和备注

~~~json
{
  "action": "setRestDay",
  "date": "2026-05-16",
  "kind": "off",
  "note": "年假"
}
~~~

kind 可传 off/rest/休息日 或 work/工作日。
纯文本也支持：

~~~text
latest baseDate=2026-05-16 lookaheadDays=30
latestWork baseDate=2026-05-16 lookaheadDays=30
isRestDay date=2026-05-16
setRestDay date=2026-05-16 kind=work note=值班
~~~`

const DIRECT_API_USAGE_EXAMPLE = `## Scripting：在脚本中直接调用工具函数

### 查询最近休息日

~~~ts
import { getLatestRestDayInfo } from "../Off day/utils/is_rest_day"

const latest = await getLatestRestDayInfo({
  baseDate: "2026-05-16",
  lookaheadDays: 370,
})
~~~

### 查询下一个工作日

~~~ts
import { getLatestWorkDayInfo } from "../Off day/utils/is_rest_day"

const latestWork = await getLatestWorkDayInfo({
  baseDate: "2026-05-16",
  lookaheadDays: 370,
})
~~~

### 判断指定日期是否休息

~~~ts
import { getRestDayInfo, isRestDay } from "../Off day/utils/is_rest_day"

const info = await getRestDayInfo("2026-05-16")
const onlyBoolean = await isRestDay("2026-05-16")
~~~

### 写入指定日期状态和备注

~~~ts
import { setRestDayInfo } from "../Off day/utils/is_rest_day"

const saved = await setRestDayInfo("2026-05-16", {
  kind: "work",
  note: "值班",
})
~~~`

const SCRIPT_OUTPUT_EXAMPLE = `## 脚本输出示例

### 查询指定日期

~~~json
{
  "ok": true,
  "action": "isRestDay",
  "dateKey": "2026-05-16",
  "isRestDay": false,
  "kind": "work",
  "source": "manual",
  "note": "值班"
}
~~~

### 查询最近休息日

~~~json
{
  "ok": true,
  "action": "latest",
  "baseDateKey": "2026-05-16",
  "dateKey": "2026-05-17",
  "daysUntil": 1,
  "isRestDay": true,
  "kind": "off",
  "source": "fixed-weekday"
}
~~~

### 查询下一个工作日

~~~json
{
  "ok": true,
  "action": "latestWork",
  "baseDateKey": "2026-05-16",
  "dateKey": "2026-05-16",
  "daysUntil": 0,
  "isRestDay": false,
  "kind": "work",
  "source": "fixed-weekday"
}
~~~

### 写入指定日期

~~~json
{
  "ok": true,
  "action": "setRestDay",
  "dateKey": "2026-05-16",
  "isRestDay": true,
  "kind": "off",
  "source": "manual",
  "note": "年假"
}
~~~`


export function RestDayDebugView(props: {
  source: HolidayCalendarSource | null
  fixedOffWeekdays: number[]
  dayOverrides: Record<string, DayOverrideKind>
}) {
  const [selectedDate, setSelectedDate] = useState(() => startOfDayTimestamp(new Date()))
  const selectedDateKey = formatDateKey(selectedDate)
  const [latestRestDayInfo, setLatestRestDayInfo] = useState<any>(null)
  const [latestWorkDayInfo, setLatestWorkDayInfo] = useState<any>(null)
  const [restDayInfo, setRestDayInfo] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const restDayOptions = {
    holidaySource: props.source ?? undefined,
    fixedOffWeekdays: props.fixedOffWeekdays,
    dayOverrides: props.dayOverrides,
  }

  useEffect(() => {
    async function loadInfo() {
      setLoading(true)
      try {
        const [latestRest, latestWork, info] = await Promise.all([
          getLatestRestDayInfo({
            ...restDayOptions,
            baseDate: selectedDateKey,
          }),
          getLatestWorkDayInfo({
            ...restDayOptions,
            baseDate: selectedDateKey,
          }),
          getRestDayInfo(selectedDateKey, restDayOptions),
        ])
        setLatestRestDayInfo(latestRest)
        setLatestWorkDayInfo(latestWork)
        setRestDayInfo(info)
      } catch (error) {
        console.error("加载休息日信息失败:", error)
      } finally {
        setLoading(false)
      }
    }
    loadInfo()
  }, [selectedDateKey, props.source, props.fixedOffWeekdays, props.dayOverrides])

  const isRestDay = restDayInfo?.isRestDay ?? false

  if (loading || !latestRestDayInfo || !latestWorkDayInfo || !restDayInfo) {
    return (
      <Form
        navigationTitle="调试"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
      >
        <Section>
          <Text>加载中...</Text>
        </Section>
      </Form>
    )
  }

  return (
    <Form
      navigationTitle="调试"
      navigationBarTitleDisplayMode="inline"
      formStyle="grouped"
    >
      <Section>
        <HStack spacing={12}>
          <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            休息
          </Text>
          <HStack spacing={6}>
            <Image
              systemName="circle.fill"
              foregroundStyle={isRestDay ? "#DCFCE7" : "#FEE2E2"}
              font="caption2"
            />
            <Text foregroundStyle="secondaryLabel">
              {isRestDay ? "休息日" : "工作日"}
            </Text>
          </HStack>
        </HStack>
        <HStack spacing={12}>
          <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            下一个休息
          </Text>
          <Text foregroundStyle="secondaryLabel">
            {latestRestDayText(latestRestDayInfo.dateKey, latestRestDayInfo.daysUntil)}
          </Text>
        </HStack>
        <HStack spacing={12}>
          <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            下一个工作
          </Text>
          <Text foregroundStyle="secondaryLabel">
            {latestWorkDayText(latestWorkDayInfo.dateKey, latestWorkDayInfo.daysUntil)}
          </Text>
        </HStack>
        <HStack spacing={12}>
          <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            日期
          </Text>
          <DatePicker
            title=""
            displayedComponents={["date"]}
            value={selectedDate}
            onChanged={(value) => setSelectedDate(startOfDayTimestamp(new Date(value)))}
          />
        </HStack>
      </Section>
      <Section header={<Text>快捷指令调用</Text>} footer={<Text>点击代码区域右上角的复制按钮可复制对应代码。</Text>}>
        <Markdown
          content={SHORTCUT_USAGE_EXAMPLE}
          theme="basic"
          useDefaultHighlighterTheme
          scrollable={false}
          onTapGesture={() => {}}
        />
      </Section>
      <Section header={<Text>Scripting：直接调用工具函数</Text>} footer={<Text>点击代码区域右上角的复制按钮可复制对应代码。</Text>}>
        <Markdown
          content={DIRECT_API_USAGE_EXAMPLE}
          theme="basic"
          useDefaultHighlighterTheme
          scrollable={false}
          onTapGesture={() => {}}
        />
      </Section>
      <Section header={<Text>脚本输出示例</Text>}>
        <Markdown
          content={SCRIPT_OUTPUT_EXAMPLE}
          theme="basic"
          useDefaultHighlighterTheme
          scrollable={false}
          onTapGesture={() => {}}
        />
      </Section>
    </Form>
  )
}
