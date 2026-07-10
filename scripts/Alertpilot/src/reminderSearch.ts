import { pad2 } from "./utils"
import { getReminderCalendar } from "./reminders"

export type ReminderCandidate = {
    id: string
    title: string
    listName?: string
    dueDate?: string
    reminder: Reminder
}

export async function findReminderCandidates(query: string): Promise<ReminderCandidate[]> {
    const normalizedQuery = normalizeText(query)
    if (!normalizedQuery) return []

    const calendars = await Calendar.forReminders()
    const allCandidates = await Promise.all(calendars.map(async calendar => {
        const reminders = await Reminder.getIncompletes({ calendars: [calendar] })
        return reminders.map(reminder => toCandidate(reminder, calendar.title))
    }))

    const candidates = allCandidates.flat().filter(Boolean) as ReminderCandidate[]
    const scored = candidates
        .map(candidate => ({
            candidate,
            score: scoreCandidate(candidate.title, normalizedQuery)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title, "zh-Hans-CN"))

    if (!scored.length) return []
    const bestScore = scored[0].score
    return scored
        .filter(item => item.score === bestScore || (bestScore >= 80 && item.score >= bestScore - 5))
        .map(item => item.candidate)
}

export async function getAllIncompleteReminders(): Promise<ReminderCandidate[]> {
    const calendars = await Calendar.forReminders()
    const allCandidates = await Promise.all(calendars.map(async calendar => {
        const reminders = await Reminder.getIncompletes({ calendars: [calendar] })
        return reminders.map(reminder => toCandidate(reminder, calendar.title))
    }))

    return allCandidates.flat().filter(Boolean) as ReminderCandidate[]
}

export async function updateReminderDueDate(reminderId: string, targetDate: Date): Promise<ReminderCandidate | undefined> {
    const calendars = await Calendar.forReminders()
    for (const calendar of calendars) {
        const reminders = await Reminder.getIncompletes({ calendars: [calendar] })
        const reminder = reminders.find(item => String((item as any).identifier || (item as any).id || "") === reminderId)
        if (!reminder) continue

        reminder.dueDateComponents = DateComponents.fromDate(targetDate)
        reminder.dueDate = targetDate
        reminder.dueDateIncludesTime = true
        await reminder.save()
        return toCandidate(reminder, calendar.title)
    }
    return undefined
}

function toCandidate(reminder: Reminder, calendarTitle?: string): ReminderCandidate {
    return {
        id: String((reminder as any).identifier || (reminder as any).id || ""),
        title: String(reminder.title || "提醒事项"),
        listName: calendarTitle,
        dueDate: formatReminderDate(reminder.dueDateComponents?.date || reminder.dueDate),
        reminder
    }
}

function scoreCandidate(title: string, normalizedQuery: string): number {
    const normalizedTitle = normalizeText(title)
    if (!normalizedTitle) return 0
    if (normalizedTitle === normalizedQuery) return 100
    if (normalizedTitle.startsWith(normalizedQuery)) return 90
    if (normalizedTitle.includes(normalizedQuery)) return 80
    if (normalizedQuery.includes(normalizedTitle)) return 70

    const overlap = longestCommonSubstring(normalizedTitle, normalizedQuery)
    if (overlap >= Math.min(normalizedTitle.length, normalizedQuery.length, 2)) {
        return 50 + overlap
    }
    return 0
}

function normalizeText(value: string): string {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s"“”'‘’]/g, "")
}

function longestCommonSubstring(a: string, b: string): number {
    let max = 0
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1
                if (dp[i][j] > max) max = dp[i][j]
            }
        }
    }
    return max
}

function formatReminderDate(date?: Date | null): string | undefined {
    if (!date) return undefined
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}
