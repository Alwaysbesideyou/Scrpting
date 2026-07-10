import { Intent, Script } from "scripting"
import { startLiveActivity, notification, getReminders } from "./components/model"
import { config } from "./components/config"
import { parseReminderBridgeNote, upsertReminderScheduleMeta } from "./components/store"

const fileName = 'Intent'

async function run() {
 if (Intent.shortcutParameter) {
 const param = Intent.shortcutParameter.value as unknown as {
 body: string
 subtitle: string
 nameOfReminder: string
 classReminders: string
 }
 // 获取该日历所有未完成提醒（不限制条数，或加个大点的 limit）
 let reminders = await getReminders({ limit:20, isCompleted: false, calendarNames: [param.classReminders], ignoreEndDate: true })

 // 名称匹配（忽略大小写和前后空格）
 const isReminder = (reminder: Reminder): boolean =>
 reminder.title.trim().toLowerCase() === param.nameOfReminder.trim().toLowerCase()

 const r = reminders.find(isReminder)
 if (r) {
 const identifier = r.identifier
 const parsedBridge = parseReminderBridgeNote(r.notes)
 let finalNote = r.notes ?? ''

 if (parsedBridge.metadata) {
 const metadata = {
 ...parsedBridge.metadata,
 note: parsedBridge.cleanNote,
 dueDate: r.dueDateComponents?.date instanceof Date ? r.dueDateComponents.date.toISOString() : (parsedBridge.metadata.dueDate ?? null),
 }
 upsertReminderScheduleMeta(identifier, metadata)
 finalNote = parsedBridge.cleanNote
 if ((r.notes ?? '') !== finalNote) {
 r.notes = finalNote
 await r.save()
 }
 }

 if (r.dueDateComponents) { // 有截止日期，且剩余一小时就启动实时活动
 const nowDate = new Date()
 nowDate.setHours(nowDate.getHours() +1)
 const dueDate = new Date(String(r.dueDateComponents.date))
 if (dueDate <= nowDate && config.isAutoLiveActivity) await startLiveActivity({ title: r.title, identifier, dueDate: String(r.dueDateComponents?.date), notes: finalNote })
 }

 notification(
 param.subtitle,
 param.body,
 true,
 true,
 {
 title: 'Alertpilot',
 interruptionLevel: "timeSensitive",
 userInfo: { identifier },
 customUI: false,
 tapAction: { type: "openURL", url: `x-apple-reminderkit://REMCDReminder/${identifier}/details` },
 actions: [{
 title: "修改提醒事项",
 scriptName: Script.name,
 parameters: { url: `x-apple-reminderkit://REMCDReminder/${identifier}/details` }
 },
 {
 title: "启动实时活动",
 scriptName: Script.name,
 parameters: { title: r.title, identifier, dueDate: String(r.dueDateComponents?.date), notes: finalNote, startLiveActivity: true }
 },
 ]
 }
 )
 } else { notification(fileName, `未找到匹配的提醒:\n名称：${param.nameOfReminder}\n列表：${param.classReminders}`, true, false) }
 }

 Script.exit(Intent.text("处理完成"))
 return
}

run()
