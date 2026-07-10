import { VStack, HStack, Text, Button, Spacer, Rectangle, Link, Image, ShapeStyle, Widget, gradient } from "scripting"
import { getDateInfo, isVersionGte, remindersNumCompare, remindersSortByDueDate } from "../components/model"
import { getReminderScheduleColor, loadReminderPageIndex } from "../components/store"
import { widgetReloadAll, CompleteReminderIntentWidget, startLiveActivityButton, openRemindersApp, nextReminderPage } from "../app_intents"

const stylePrimary: ShapeStyle = "label"
const styleSecondary: ShapeStyle = "secondaryLabel"

export async function WidgetView({
  recentlyCompletedReminders,
  reminders,
  useTomorrow,
}: {
  recentlyCompletedReminders: Reminder[]
  reminders: Reminder[]
  useTomorrow: boolean
}) {
  const isLatestSystem = isVersionGte(Device.systemVersion, "26.0.0")
  const now = new Date()
  const pageSize = 4
  const allDisplayReminders = remindersSortByDueDate([...recentlyCompletedReminders, ...reminders], recentlyCompletedReminders.length + reminders.length)
  const pageCount = Math.max(1, Math.ceil(allDisplayReminders.length / pageSize))
  const pageIndex = loadReminderPageIndex() % pageCount
  const displayReminders = allDisplayReminders.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize)
  const displayCount = displayReminders.length
  const getTitleLineLimit = (index: number) => {
    if (displayCount === 1) return 5
    if (displayCount === 2) return 2
    return 1
  }
  const shouldShowSeparator = displayCount === 2 || displayCount === 3
  const relativeTimeWords = useTomorrow ? "明天" : "今天"
  const dateInfo = useTomorrow
    ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
    : now
  const { day, weekday } = getDateInfo(dateInfo)
  const numTransition = remindersNumCompare(reminders.length)
  const widgetBackground = Widget.isTransparentBackground ? undefined : {
    // 柔和紫灰渐变方案A - 加大距离版（2026-07-09）
    dark: gradient("linear", {
      colors: ["#3E4048", "#12141C"], // 浅紫灰 → 深紫黑
      startPoint: "top",
      endPoint: "bottom",
    }),
    light: gradient("linear", {
      colors: ["#FFFFFF", "#D8D0E0"], // 纯白 → 柔紫灰
      startPoint: "top",
      endPoint: "bottom",
    })
  }
  const scheduleStyles = await Promise.all(
    displayReminders.map(r => getReminderScheduleColor(r.identifier, r.dueDateComponents?.date))
  )

  return (
    <VStack
      alignment={"leading"}
      frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: "topLeading" }}
      widgetBackground={widgetBackground}
    >
      {/* 固定标题栏 */}
      <HStack
        alignment={"center"}
        padding={{ top: 8, bottom: 6 }}
      >
        <HStack
          padding={{ leading: 10, top: 0, bottom: 0 }}
          frame={{ width: 96, alignment: "leading" }}
          contentShape="rect"
        >
          <Button
            intent={widgetReloadAll(undefined)}
            buttonStyle="plain"
          >
            <Text
              font={24}
              fontDesign={"rounded"}
              fontWeight={"semibold"}
              foregroundStyle={stylePrimary}
              frame={{ width: day.length === 1 ? 20 : 32, alignment: "center" }}
              allowsTightening={true}
              contentTransition={'numericTextCountsUp'}
            >
              {day}
            </Text>
            <Rectangle
              frame={{ width: 0.5, height: 20, alignment: "center" }}
              foregroundStyle={stylePrimary}
              opacity={0.3}
              padding={{ leading: -4, trailing: 0 }}
            />
          </Button>
          <Button
            intent={openRemindersApp("com.apple.reminders")}
            buttonStyle="plain"
          >
            <VStack spacing={2}>
              <Text font={10}
                fontDesign={"rounded"}
                fontWeight={"black"}
                foregroundStyle={useTomorrow ? stylePrimary : "systemTeal"}
                padding={{ leading: -4, trailing: -4, bottom: -1 }}
                frame={{ width: 4, alignment: "center" }}
              >
                {relativeTimeWords.charAt(0)}
              </Text>
              <Text font={10}
                fontDesign={"rounded"}
                fontWeight={"black"}
                foregroundStyle={useTomorrow ? stylePrimary : "systemTeal"}
                padding={{ leading: -4, trailing: -4, top: -1 }}
                frame={{ width: 4, alignment: "center" }}
              >
                {relativeTimeWords.charAt(1)}
              </Text>
            </VStack>
            <Rectangle
              frame={{ width: 0.5, height: 20, alignment: "center" }}
              foregroundStyle={stylePrimary}
              opacity={0.3}
              padding={{ leading: 4, trailing: 0 }}
            />
            <VStack spacing={2}>
              <Text font={10}
                fontDesign={"rounded"}
                fontWeight={"black"}
                foregroundStyle={"#FF3B30"}
                padding={{ leading: -4, trailing: -4, bottom: -1 }}
                frame={{ width: 10, alignment: "center" }}
              >
                {weekday.charAt(0)}
              </Text>
              <Text font={10}
                fontDesign={"rounded"}
                fontWeight={"black"}
                foregroundStyle={"#FF3B30"}
                padding={{ leading: -4, trailing: -4, top: -1 }}
                frame={{ width: 10, alignment: "center" }}
              >
                {weekday.charAt(1)}
              </Text>
            </VStack>
          </Button>
        </HStack>
        <Spacer />
        <Button
          title={`${reminders.length}`}
          intent={nextReminderPage(undefined)}
          foregroundStyle={stylePrimary}
          fontDesign={"rounded"}
          fontWeight={"bold"}
          font={24}
          padding={{ trailing: 10, top: 0, bottom: 0 }}
          buttonStyle="borderless"
          controlSize="regular"
          contentTransition={numTransition}
        />
      </HStack>
      {/* 限制显示最多三条提醒 */}
      {displayReminders.length !== 0 ? displayReminders.map((r, index) => {
        const scheduleStyle = scheduleStyles[index]
        return (
          <VStack key={r.identifier} alignment="leading" spacing={0} padding={{ leading: 10, top: index === 0 ? (isLatestSystem ? 2 : displayCount === 4 ? -10 : -4) : 0 }}>
            <HStack spacing={6} alignment="center"            >
              <Button
                padding={{ leading: 10, trailing: 6 }}
                frame={{ width: 24 }}
                title=''
                intent={CompleteReminderIntentWidget({ reminderId: r.identifier, isCompleted: r.isCompleted })}
                font={22}
                foregroundStyle={r.isCompleted ? "#FF3B30" : styleSecondary}
                systemImage={r.isCompleted ? "heart.circle.fill" : "circle"}
                contentTransition="symbolEffectScale"
                opacity={r.isCompleted ? 1 : 0.2}
                buttonStyle="borderless"
              />
              <Button
                padding={{ leading: 5, trailing: 5, top: 4, bottom: 4 }}
                frame={{ alignment: "leading", maxWidth: Infinity }}
                intent={startLiveActivityButton({ title: r.title, identifier: r.identifier, dueDate: String(r.dueDateComponents?.date), notes: r.notes ? r.notes : '' })}
                background={{
                  style: r.isCompleted
                    ? "rgba(142,142,147,0.18)"
                    : scheduleStyle,
                  shape: { type: 'rect', cornerRadius: 8 }
                }}
                opacity={r.isCompleted ? 0.8 : 1}
                buttonStyle="plain"
              >
                <Text
                  font={15}
                  foregroundStyle={r.isCompleted ? styleSecondary : stylePrimary}
                  lineLimit={getTitleLineLimit(index)}
                  truncationMode="tail"
                  fixedSize={{ horizontal: false, vertical: true }}
                >
                  {r.title}
                </Text>
              </Button>
              <Spacer />
              {(
                r.dueDateComponents?.date &&
                (r.dueDateComponents.date.getTime() - now.getTime()) <= 30 * 60 * 1000
              ) ? (
                <Link url={`x-apple-reminderkit://REMCDReminder/${r.identifier}/details`}>
                  <Image
                    frame={{ height: 28 }}
                    font={16}
                    systemName={"clock"}
                    symbolRenderingMode="multicolor"
                    padding={{ leading: -16, trailing: 6 }}
                  />
                </Link>
              ) : null}
            </HStack>
            {index < displayCount - 1 && shouldShowSeparator ? (
              <HStack padding={{ leading: 32, top: 7, bottom: 4 }}>
                <Rectangle
                  frame={{ height: 0.25 }}
                  stroke={{
                    shapeStyle: styleSecondary,
                    strokeStyle: { dash: [1.5, 1.5] }
                  }}
                  opacity={0.3}
                  padding={{ leading: 0, trailing: 10 }}
                />
                <Spacer />
              </HStack>
            ) : null}
          </VStack>
        )
      })
        : (
          <VStack alignment="leading" padding={{ leading: 10, top: 0 }}>
            <HStack alignment="center">
              <Text font={15}
                padding={{ leading: 6, trailing: 5, top: (isLatestSystem ? 2 : -6), bottom: 5 }}
                foregroundStyle={stylePrimary}
              >❤️没有提醒事项</Text>
              <Spacer />
            </HStack>
            <Spacer />
          </VStack>
        )}
      <Button
        intent={openRemindersApp("com.apple.reminders")}
        buttonStyle="plain"
        frame={{ maxWidth: Infinity, maxHeight: Infinity }}
      >
        <Rectangle
          fill="clear"
          frame={{ maxWidth: Infinity, maxHeight: Infinity }}
          contentShape="rect"
        />
      </Button>
    </VStack>
  )
}
