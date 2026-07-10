import { Notification, Script } from 'scripting'
import { config } from "./config"
import { loadCurrentRemindersNum, saveCurrentRemindersNum } from "../components/store"

const fileName = 'Model'

export async function getReminders(options: {
    startDate?: Date,
    endDate?: Date,
    limit?: number,
    isCompleted?: boolean,
    calendarNames?: string[],
    ignoreStartDate?: boolean,
    ignoreEndDate?: boolean
} = {}) {
    const { startDate, endDate, limit = 1, isCompleted = false, calendarNames, ignoreStartDate, ignoreEndDate } = options

    try {
        let calendars: Calendar[] = []

        // 获取指定日历或默认日历
        if (calendarNames && calendarNames.length > 0) {
            const allReminderCals = await Calendar.forReminders()
            calendars = allReminderCals.filter(c => calendarNames.includes(c.title))

            if (calendars.length === 0) {
                notification(fileName, "未找到匹配的日历名称，退回默认日历", config.debug, false)
                const defaultCal = await Calendar.defaultForReminders()
                if (defaultCal) calendars = [defaultCal]
            } else {
                notification(fileName, `根据名称找到的提醒事项日历: ${calendars.map(c => c.title).join(", ")}`, config.debug, true)
            }
        }
        // else {
        //     const defaultCal = await Calendar.defaultForReminders();
        //     if (defaultCal) calendars = [defaultCal];
        //     else notification(fileName, "未找到默认提醒事项日历", config.debug, false);
        // }

        const now = new Date()
        let all: Reminder[] = []

        if (isCompleted) {
            // 完成提醒使用 startDate 和 endDate
            const params: any = { calendars }
            if (!ignoreStartDate) params.startDate = startDate ?? new Date(now.getTime() - 1440 * 60000) // 默认1天前
            if (!ignoreEndDate) params.endDate = endDate ?? (() => {
                const tomorrow = new Date(now)
                tomorrow.setDate(now.getDate() + 1)
                tomorrow.setHours(3, 0, 0, 0)
                return tomorrow
            })()

            all = await Reminder.getCompleteds(params)
        } else {
            // 未完成提醒通常只用 endDate
            const params: any = { calendars }
            if (!ignoreEndDate) params.endDate = endDate ?? (() => {
                const tomorrow = new Date(now)
                tomorrow.setDate(now.getDate() + 1)
                tomorrow.setHours(3, 0, 0, 0)
                return tomorrow
            })()

            all = await Reminder.getIncompletes(params)
        }

        const remindersSorted = remindersSortByDueDate(all, limit)
        // notification(fileName, `[Model] 获取到提醒条数: ${remindersSorted.length}`, config.debug, true)
        return remindersSorted

    } catch (err) {
        notification(fileName, `[Model] 获取提醒异常: ${err}`, config.debug, false)
        return []
    }
}

export function remindersSortByDueDate(reminders: Reminder[], limit: number = 3) {
    const filtered = reminders.filter(r => r.dueDateComponents?.date) // 过滤有效日期提醒
    const sorted = filtered.sort((a, b) => // 按时间排序
        (a.dueDateComponents?.date?.getTime() ?? 0) - (b.dueDateComponents?.date?.getTime() ?? 0)
    )
    return sorted.slice(0, limit)
}

export function isDueDateTomorrow(dueDate: Date): boolean {
    if (isNaN(dueDate.getTime())) return false

    const now = new Date()
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

    return (
        dueDate.getFullYear() === tomorrow.getFullYear() &&
        dueDate.getMonth() === tomorrow.getMonth() &&
        dueDate.getDate() === tomorrow.getDate()
    )
}

export async function completedReminder(reminderId: string, isCompleted: boolean, startDate?: Date) {
    try {
        const reminders = await getReminders({ limit: 5, isCompleted: isCompleted, startDate: isCompleted ? undefined : startDate, ignoreEndDate: true })
        const targetR = reminders.find(r => r.identifier === reminderId)
        if (targetR) {
            targetR.isCompleted = !isCompleted
            await targetR.save() // 保存提醒状态
            return targetR
        } else {
            notification(fileName, `未找到提醒，ID: ${reminderId}`, config.debug, false)
        }
    } catch (err) {
        notification(fileName, `完成提醒异常: ${String(err)}`, config.debug, false)
    }
}

export async function postponeReminder(reminderId: string, minutes: number = 30) {
    try {
        const reminder = await Reminder.get(reminderId)
        if (!reminder) {
            notification(fileName, `未找到提醒，ID: ${reminderId}`, config.debug, false)
            return
        }

        const currentDueDate = reminder.dueDateComponents?.date
        const baseDate = currentDueDate instanceof Date && Number.isFinite(currentDueDate.getTime())
            ? currentDueDate
            : new Date()
        const newDueDate = new Date(baseDate.getTime() + minutes * 60_000)

        // 只把“延后 30 分钟”的结果写回系统提醒事项。
        // 后续灵动提醒不要直接使用 newDueDate，而是重新从 Reminder.get 读取系统保存后的 dueDate。
        reminder.dueDateComponents = DateComponents.fromDate(newDueDate)
        // reminder.dueDate = newDueDate
        // reminder.dueDateIncludesTime = true
        await reminder.save()

        const savedReminder = await Reminder.get(reminderId)
        const systemDueDate = savedReminder?.dueDateComponents?.date
        if (!(systemDueDate instanceof Date) || !Number.isFinite(systemDueDate.getTime())) {
            notification(fileName, `系统提醒事项未返回有效时间，ID: ${reminderId}`, config.debug, false)
        }

        return { reminder: savedReminder ?? reminder, systemDueDate }
    } catch (err) {
        notification(fileName, `延后提醒异常: ${String(err)}`, config.debug, false)
    }
}

export function remindersNumCompare(currentNum: number) {
    const previousRemindersNum = loadCurrentRemindersNum() ?? 0
    saveCurrentRemindersNum(currentNum)
    if (previousRemindersNum > currentNum) return 'numericTextCountsDown'
    if (previousRemindersNum < currentNum) return 'numericTextCountsUp'
    return 'numericText'
}

export function formatTime(date?: Date) {
    if (!date) return ""
    return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes()
        .toString()
        .padStart(2, "0")}`
}

export async function notification(
    subtitle: string,
    body: string,
    debug: boolean = false, // 是否仅打印日志
    isOK: boolean = true, // 是否成功
    options?: {
        title?: string,
        actions?: { title: string, scriptName: string, parameters?: Record<string, any>, destructive?: boolean }[], // 操作按钮
        trigger?: any, // 可传入时间/日历/位置触发器
        silent?: boolean,
        userInfo?: Record<string, any>,
        interruptionLevel?: "active" | "passive" | "timeSensitive",
        customUI?: boolean,
        tapAction?: "none" | { type: "runScript", scriptName: string } | { type: "openURL", url: string }
    }
) {
    const {
        actions = [],
        trigger = null,
        silent = false,
        interruptionLevel,
        userInfo,
        customUI,
        tapAction
    } = options ?? {}

    const OK = isOK ? "✅" : "❌"

    if (!debug) {
        // 非调试模式下打印日志
        console.log(`${subtitle}: ${OK}${body}`)
    } else {
        // 调试模式下发送通知
        await Notification.schedule({
            title: options?.title ?? config.name,
            subtitle: options?.title ? subtitle : `${OK}${subtitle}`,
            body,
            threadIdentifier: subtitle,
            silent,
            interruptionLevel,
            trigger,
            userInfo,
            customUI,
            tapAction,
            actions: actions.map(a => ({
                title: a.title,
                url: Script.createRunURLScheme(a.scriptName, a.parameters ?? {}),
                destructive: a.destructive
            }))
        })
    }
}

export async function startLiveActivity(params: { title: string; identifier: string; dueDate: string; notes?: string }) {
    try {
        // notification(fileName, `尝试启动实时活动: ${params.title}`, config.debug, true)
        const dueDateObj = normalizeDueDate(params.dueDate)
        const liveActivity = await import("./liveActivityFun") // 动态导入
        await liveActivity.startReminderActivity(params.title!, params.identifier!, dueDateObj.toISOString(), params.notes)
    } catch (err) {
        notification(fileName, `执行实时活动提醒异常: ${String(err)}`, config.debug, false)
    }
}

export function getDateInfo(date: Date) {
    // 公历日
    const day = date.getDate().toString()
    // 星期
    const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]
    // // 农历（这里先写死，后面可接入 API）
    // const lunar = "初二"
    return { day, weekday }
}

export function isVersionGte(current: string, target: string): boolean {
    const curParts = current.split('.').map(Number)
    const tarParts = target.split('.').map(Number)
    const maxLen = Math.max(curParts.length, tarParts.length)

    for (let i = 0; i < maxLen; i++) {
        const cur = curParts[i] || 0
        const tar = tarParts[i] || 0
        if (cur > tar) return true
        if (cur < tar) return false
    }
    return true // 完全相等时返回 true
}

export function str2TimeText(dueDate: string) {
    const d = new Date(dueDate)
    const hh = String(d.getHours()).padStart(2, "0")
    const mm = String(d.getMinutes()).padStart(2, "0")
    return `${hh}:${mm}`
}

export function normalizeDueDate(dueDate: string) {
    const now = new Date(String(dueDate))
    const defaultDueDate = new Date(now.getTime() + 30 * 60_000)
    let dueDateObj: Date
    if (dueDate) {
        dueDateObj = typeof dueDate === 'string' ? new Date(dueDate) : dueDate
        if (isNaN(dueDateObj.getTime())) dueDateObj = defaultDueDate
    } else {
        dueDateObj = defaultDueDate
    }
    if (dueDateObj < now) { dueDateObj = defaultDueDate } // 由于 TimerIntervalLabel 参数需要时间未到
    return dueDateObj
}

export function exTimeRange(time?: Date, rangeSec: number = 10) {
    return time instanceof Date && !isNaN(time.getTime())
        ? new Date(time.getTime() - rangeSec * 1000)
        : undefined
}



// export async function clearUnreferencedLiveActivities() { // 如果手动清理的话,需要在App Intents中注册LiveActivityIntent,加载很慢,另外这个功能用处不是很大,在此禁用.
//     try {
//         const liveActivityIds = await LiveActivity.getAllActivitiesIds()
//         notification(fileName, `当前活动ID: ${liveActivityIds.join(", ")}`, config.debug, true)
//         let records = loadRecords()
//         const dRecord = records.filter(r => !liveActivityIds.includes(r.liveActivityId)) // 下面改成了saveRecords，这里的逻辑要注意
//         notification(fileName,
//             dRecord.length > 0 ?
//                 `需要清理实时活动\n数量：${dRecord.length}\nID: ${dRecord.map(r => r.liveActivityId).join(", ")}`
//                 : `无需清理实时活动`
//             , config.debug, true)
//         if (dRecord.length) saveRecords(dRecord)
//     } catch (err) {
//         notification(fileName, `清理未引用实时活动异常: ${String(err)}`, config.debug, false)
//     }
// }
