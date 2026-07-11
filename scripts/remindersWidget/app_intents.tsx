import { AppIntentManager, AppIntentProtocol, Widget, LiveActivity } from "scripting"
import { getReminders, notification, startLiveActivity, completedReminder, postponeReminder, normalizeDueDate } from "./components/model"
import { config } from "./components/config"
import { nextReminderPageIndex } from "./components/store"

const fileName = 'App Intents'

export const testNotify = AppIntentManager.register({
    name: "notify",
    protocol: AppIntentProtocol.AppIntent,
    perform: async (content: string) => {
        try {
            notification(fileName, content, config.debug, true)
            Widget.reloadAll()
        } catch (err) {
            notification(fileName, String(err), config.debug, false)
        }
    }
})

export const widgetReloadAll = AppIntentManager.register({
    name: "widgetReloadAll",
    protocol: AppIntentProtocol.AppIntent, // 使用LiveActivityIntent加载很慢,如果只刷新小组件可以使用AppIntent
    perform: async (params: undefined) => {
        try {
            Widget.reloadAll()
            notification(fileName, "小组件已重载", config.debug, true)
        } catch (err) {
            notification(fileName, `执行小组件重载异常: ${String(err)}`, config.debug, false)
        }
    }
})

export const openRemindersApp = AppIntentManager.register({
    name: "openRemindersApp",
    protocol: AppIntentProtocol.AppIntent,
    perform: async (bundleID: string) => {
        try {
            console.log("Open app:", bundleID)
            Widget.openApp(bundleID)
        } catch (err) {
            notification(fileName, `打开 App 异常: ${String(err)}`, config.debug, false)
        }
    }
})

export const nextReminderPage = AppIntentManager.register({
    name: "nextReminderPage",
    protocol: AppIntentProtocol.AppIntent,
    perform: async (params: undefined) => {
        try {
            nextReminderPageIndex()
            Widget.reloadAll()
        } catch (err) {
            notification(fileName, `切换提醒页异常: ${String(err)}`, config.debug, false)
        }
    }
})

export const CompleteReminderIntentWidget = AppIntentManager.register({
    name: "CompleteReminderIntentWidget",
    protocol: AppIntentProtocol.AppIntent,
    perform: async (params: { reminderId: string; isCompleted: boolean, startDate?: Date }) => {
        try {
            const targetR = await completedReminder(params.reminderId, params.isCompleted, params.startDate)
            notification(fileName, `[Widget]提醒状态已更新: ${targetR?.title}`, config.debug, true)
        } catch (err) {
            notification(fileName, `执行完成提醒异常: ${String(err)}`, config.debug, false)
        }
        Widget.reloadAll()
        setTimeout(() => Widget.reloadAll(), 10 * 1000)
    }
})

export const CompleteReminderIntentLiveActivity = AppIntentManager.register({
    name: "CompleteReminderIntentLiveActivity",
    protocol: AppIntentProtocol.LiveActivityIntent,
    perform: async (params: { reminderId: string; isCompleted: boolean }) => {
        try {
            const targetR = await completedReminder(params.reminderId, params.isCompleted)
            notification(fileName, `[LiveActivity]提醒状态已更新: ${targetR?.title}`, config.debug, true)
            if (targetR) {
                const liveActivity = await import("./components/liveActivityFun") // 动态导入
                if (targetR.isCompleted) {
                    await liveActivity.endActivityByIdentifier(
                        targetR.title,
                        params.reminderId,
                        targetR.notes ?? ""
                    )
                } else {
                    const dueDateObj = normalizeDueDate(targetR.dueDateComponents?.date ? targetR.dueDateComponents?.date.toISOString() : "")
                    await liveActivity.startReminderActivity(targetR.title, targetR.identifier, dueDateObj.toISOString(), targetR.notes || "")
                }
            }
        } catch (err) {
            notification(fileName, `执行完成提醒异常: ${String(err)}`, config.debug, false)
        }
        Widget.reloadAll()
    }
})

export const PostponeReminderIntentLiveActivity = AppIntentManager.register({
    name: "PostponeReminderIntentLiveActivity",
    protocol: AppIntentProtocol.LiveActivityIntent,
    perform: async (params: { reminderId: string }) => {
        try {
            const result = await postponeReminder(params.reminderId, 30)
            const targetR = result?.reminder
            notification(fileName, `[LiveActivity]提醒已延后30分钟: ${targetR?.title}`, config.debug, true)
            if (targetR && result?.systemDueDate) {
                const liveActivity = await import("./components/liveActivityFun") // 动态导入
                await liveActivity.startReminderActivity(targetR.title, targetR.identifier, result.systemDueDate.toISOString(), targetR.notes || "")
            }
        } catch (err) {
            notification(fileName, `执行延后提醒异常: ${String(err)}`, config.debug, false)
        }
        Widget.reloadAll()
    }
})

export const startLiveActivityButton = AppIntentManager.register({
    name: "startLiveActivityButton",
    protocol: AppIntentProtocol.LiveActivityIntent,
    perform: async (params: { title: string; identifier: string; dueDate: string; notes?: string }) => {
        try {
            // 点击按钮时重新从系统提醒事项读取，避免小组件未刷新导致 dueDate 仍是旧值。
            const latestReminder = await Reminder.get(params.identifier)
            const latestDueDate = latestReminder?.dueDateComponents?.date

            if (!(latestDueDate instanceof Date) || !Number.isFinite(latestDueDate.getTime())) {
                notification(fileName, `系统提醒事项未返回有效时间: ${params.title}`, config.debug, false)
                return
            }

            const latestParams = {
                title: latestReminder?.title ?? params.title,
                identifier: latestReminder?.identifier ?? params.identifier,
                dueDate: latestDueDate.toISOString(),
                notes: latestReminder?.notes ?? params.notes ?? "",
            }

            await startLiveActivity(latestParams)
            notification(fileName, `尝试启动实时活动: ${latestParams.title}`, config.debug, true)
        } catch (err) {
            notification(fileName, `启动实时活动按钮异常: ${String(err)}`, config.debug, false)
        }
        Widget.reloadAll()
    }
})

