export type ScheduledReminderWindow = {
    title: string
    start: Date
    end: Date
    durationMinutes: number
    priority: number
    calendarTitle?: string
    reminder?: Reminder
}

export async function getReminderCalendar(title?: string) {
    const calendars = await Calendar.forReminders()

    if (title) {
        const normalizedTitle = title === "Reminders" ? "提醒事项" : title
        const matched = calendars.find(cal => cal.title === normalizedTitle || cal.title === title)
        if (matched) return matched
    }

    const defaultCal = await Calendar.defaultForReminders()
    if (defaultCal) return defaultCal

    if (calendars.length > 0) return calendars[0]

    throw new Error("未找到可用的提醒事项列表")
}

export async function createOrFindParentReminder(
    parentReminder: string,
    classReminders?: string
) {
    const cal = await getReminderCalendar(classReminders)

    const reminders = await Reminder.getIncompletes({
        calendars: [cal]
    })

    let reminder = reminders.find(r => r.title === parentReminder)

    if (!reminder) {
        reminder = new Reminder()
        reminder.title = parentReminder
        reminder.calendar = cal
        await reminder.save()
    }

    return {
        parentReminder,
        calForReminders: cal.title,
        pReminderDate: String((reminder as any).creationDate || "")
    }
}

export async function getScheduledReminderWindows(
    startDate: Date,
    endDate: Date,
    durationForReminder: (reminder: Reminder) => number
): Promise<ScheduledReminderWindow[]> {
    const reminders = await Reminder.getIncompletes({
        startDate,
        endDate
    })

    return reminders.reduce<ScheduledReminderWindow[]>((windows, reminder) => {
        const start = reminder.dueDateComponents?.date || reminder.dueDate
        if (!start) return windows

        const durationMinutes = Math.max(10, durationForReminder(reminder))
        const end = new Date(start)
        end.setMinutes(end.getMinutes() + durationMinutes)

        windows.push({
            title: reminder.title || "提醒事项",
            start,
            end,
            durationMinutes,
            priority: Number(reminder.priority || 0),
            calendarTitle: reminder.calendar?.title,
            reminder
        })

        return windows
    }, [])
}

export async function rescheduleReminderWindow(
    window: ScheduledReminderWindow,
    start: Date
): Promise<void> {
    if (!window.reminder) {
        throw new Error(`提醒事项“${window.title}”缺少可修改对象`)
    }

    const end = new Date(start)
    end.setMinutes(end.getMinutes() + window.durationMinutes)
    const reminder = window.reminder
    const oldStart = window.start
    const offsetMs = start.getTime() - oldStart.getTime()

    reminder.dueDateComponents = DateComponents.fromDate(start)
    reminder.dueDate = start
    reminder.dueDateIncludesTime = true

    if (Array.isArray(reminder.alarms)) {
        for (const alarm of reminder.alarms) {
            if (alarm.absoluteDate) {
                alarm.absoluteDate = new Date(alarm.absoluteDate.getTime() + offsetMs)
            }
        }
    }

    await reminder.save()

    window.start = start
    window.end = end
}
