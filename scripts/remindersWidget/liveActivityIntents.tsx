import { AppIntentManager, AppIntentProtocol, Intent, Script, Widget } from "scripting"
import { completedReminder, normalizeDueDate, notification, postponeReminder } from "./components/model"
import { config } from "./components/config"

const fileName = "Live Activity Intents"

export const CompleteReminderIntentLiveActivity = AppIntentManager.register({
    name: "CompleteReminderIntentLiveActivity",
    protocol: AppIntentProtocol.LiveActivityIntent,
    perform: async (params: { reminderId: string; isCompleted: boolean }) => {
        let exitText = "实时活动提醒状态已更新"

        try {
            const targetR = await completedReminder(params.reminderId, params.isCompleted)
            notification(fileName, `[LiveActivity]提醒状态已更新: ${targetR?.title}`, config.debug, true)

            if (targetR) {
                const liveActivity = await import("./components/liveActivityFun")
                if (targetR.isCompleted) {
                    await liveActivity.endActivityByIdentifier(
                        targetR.title,
                        params.reminderId,
                        targetR.notes ?? ""
                    )
                } else {
                    const rawDueDate = targetR.dueDateComponents?.date
                    const dueDateObj = normalizeDueDate(rawDueDate instanceof Date ? rawDueDate.toISOString() : "")
                    await liveActivity.startReminderActivity(targetR.title, targetR.identifier, dueDateObj.toISOString(), targetR.notes || "")
                }
            }
        } catch (err) {
            exitText = `执行完成提醒异常: ${String(err)}`
            notification(fileName, exitText, config.debug, false)
        } finally {
            Widget.reloadAll()
            Script.exit(Intent.text(exitText))
        }
    }
})

export const PostponeReminderIntentLiveActivity = AppIntentManager.register({
    name: "PostponeReminderIntentLiveActivity",
    protocol: AppIntentProtocol.LiveActivityIntent,
    perform: async (params: { reminderId: string }) => {
        let exitText = "实时活动提醒已延后"

        try {
            const result = await postponeReminder(params.reminderId, 30)
            const targetR = result?.reminder
            notification(fileName, `[LiveActivity]提醒已延后30分钟: ${targetR?.title}`, config.debug, true)

            if (targetR && result?.systemDueDate) {
                const liveActivity = await import("./components/liveActivityFun")
                await liveActivity.startReminderActivity(targetR.title, targetR.identifier, result.systemDueDate.toISOString(), targetR.notes || "")
            }
        } catch (err) {
            exitText = `执行延后提醒异常: ${String(err)}`
            notification(fileName, exitText, config.debug, false)
        } finally {
            Widget.reloadAll()
            Script.exit(Intent.text(exitText))
        }
    }
})
