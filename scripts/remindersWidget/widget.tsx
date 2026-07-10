import { VStack, Text, Widget } from "scripting"
import { getReminders, remindersSortByDueDate, isDueDateTomorrow, notification } from "./components/model"
import { WidgetView } from './view/widgetView'
import { config } from "./components/config"

const fileName = 'Widget'

export async function ReminderWidgetView() {
  try {
    const now = new Date()
    const recentlyDate = new Date(now.getTime() - 10 * 1000) // 最近10秒内完成的提醒，若误触可以撤销
    const todayReminders = await getReminders({ limit: 20, isCompleted: false })
    notification(fileName, `今天提醒: ${todayReminders.length}`, config.debug, true, { silent: true })
    const recentlyCompletedReminders = await getReminders({ limit: 20, isCompleted: true, startDate: recentlyDate, endDate: now })
    notification(fileName, `最近完成提醒: ${recentlyCompletedReminders.length}`, config.debug, true, { silent: true })
    // const mergedReminders = [...recentlyCompletedReminders, ...todayReminders] // 合并最近完成的提醒和今天的提醒

    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)
    const tomorrowReminders = await getReminders({ limit: 20, isCompleted: false, startDate: tomorrowStart, endDate: tomorrowEnd })
    notification(fileName, `明天提醒: ${tomorrowReminders.length}`, config.debug, true, { silent: true })
    const sortedReminders = remindersSortByDueDate([...recentlyCompletedReminders, ...(todayReminders.length === 0 ? tomorrowReminders : todayReminders)], 3) ?? [] // 如果所有今明两天都没有提醒，则返回空
    const firstReminder = sortedReminders[0]
    const firstReminderDueDate = firstReminder?.dueDateComponents?.date
    const useTomorrow =
      firstReminderDueDate instanceof Date &&
      isDueDateTomorrow(firstReminderDueDate) &&
      now.getHours() >= 20
    const reminders = useTomorrow ? tomorrowReminders : todayReminders

    return await WidgetView({
      recentlyCompletedReminders,
      reminders,
      useTomorrow,
    })
  } catch (err) {
    notification(fileName, `渲染异常: ${String(err)}`, config.debug, false)
    return (
      <VStack>
        <Text>加载失败</Text>
      </VStack>
    )
  }
}

(async () => {
  const view = await ReminderWidgetView()
  Widget.present(view, {
    policy: "after",
    date: new Date(Date.now() + 1000 * 60 * 5) //5分钟后刷新
  })
})()
