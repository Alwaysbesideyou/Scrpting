import type { AlertpilotConfig, AlertpilotInput, SpecifiedDayConstraint } from "./types"
import { getDefaultReminderList, getDefaultTime, getDefaultWorkdayTime, getDefaultRestDayTime } from "./config"
import type { Logger } from "./notifier"
import { getScheduledReminderWindows, rescheduleReminderWindow, type ScheduledReminderWindow } from "./reminders"
import { pad2 } from "./utils"
// @ts-ignore Scripting can import from sibling script directories at runtime.
import { getRestDayInfo, getLatestWorkDayInfo, getLatestRestDayInfo } from "../../Off day/utils/is_rest_day"

type TimeCompletionEntry = [string, string?, string?]

export type TaskCategory =
    | "work"
    | "shopping"
    | "housework"
    | "study"
    | "health"
    | "relationship"
    | "finance"
    | "leisure"
    | "general"
    | (string & {})

export type LearningCategory = string

export type TimeSlot = "morning" | "work" | "restTime" | "restDay" | "any"

/**
 * 所有任务类别的语义描述，供 AI 提示词使用。
 * 用户启用哪个任务，就直接把对应的解释放进提示词。
 */
export const SIMPLE_TASK_DESCRIPTIONS: Record<string, string> = {
    general: "无法明确归类到其他任务类别的事项，或你认为不适合放入特定类别的内容",
    shopping: "输入出现商品、购物、买、采购、超市等关键词，或你认为可归类到购物的事项",
    housework: "输入出现家务、打扫、清洁、做饭、洗、整理、收拾等关键词，或你认为可归类到家务的事项",
    study: "输入出现学习、复习、课程、练习、论文、笔记、教程等关键词，或你认为可归类到学习的事项",
    reading: "输入出现阅读、读书、看书等关键词，或你认为可归类到阅读的事项",
    exercise: "输入出现运动、跑步、健身、散步等关键词，或你认为可归类到运动的事项",
    health: "输入出现健康、体检、看病、医院、睡觉、冥想等关键词，或你认为可归类到健康的事项",
    work: "输入出现工作、项目、会议、邮件、代码、方案等关键词，或你认为可归类到工作的事项",
    social: "输入出现社交、朋友、同学、联系、聊天、问候等关键词，或你认为可归类到社交的事项",
    date: "输入出现约会、恋爱、对象等关键词，或你认为可归类到约会的事项",
    finance: "输入出现财务、缴费、还款、账单、报销、转账等关键词，或你认为可归类到财务的事项",
    leisure: "输入出现休闲、电影、游戏、音乐、旅行等关键词，或你认为可归类到休闲的事项",
    food: "输入出现饮食、吃饭、餐、菜、做饭等关键词，或你认为可归类到饮食的事项",
    medicine: "输入出现用药、吃药、药等关键词，或你认为可归类到用药提醒的事项",
    phone: "输入出现电话、打电话、通话等关键词，或你认为可归类到电话的事项",
    document: "输入出现文档、文件、资料等关键词，或你认为可归类到文档的事项",
    important: "输入出现重要、紧急等关键词，或你认为属于重要紧急的事项",
    reminder: "输入明确要求提醒、记住某事"
}

const DEFAULT_SIMPLE_TASK_PREFERENCES: Array<{
    id: string
    typeId: string
    modeKey: "shoppingMode" | "houseworkMode" | "studyMode" | "exerciseMode" | "generalMode"
    timeKey: "shoppingTime" | "houseworkTime" | "studyPreferredTime" | "exercisePreferredTime" | "generalPreferredTime"
    defaultMode: string
    defaultTime: string
}> = [
    { id: "simple-general", typeId: "general", modeKey: "generalMode", timeKey: "generalPreferredTime", defaultMode: "any", defaultTime: "2000" },
    { id: "simple-shopping", typeId: "shopping", modeKey: "shoppingMode", timeKey: "shoppingTime", defaultMode: "any", defaultTime: "2000" },
    { id: "simple-housework", typeId: "housework", modeKey: "houseworkMode", timeKey: "houseworkTime", defaultMode: "any", defaultTime: "2000" },
    { id: "simple-study", typeId: "study", modeKey: "studyMode", timeKey: "studyPreferredTime", defaultMode: "specified", defaultTime: "2100" },
    { id: "simple-reading", typeId: "reading", modeKey: "studyMode", timeKey: "studyPreferredTime", defaultMode: "specified", defaultTime: "2100" },
    { id: "simple-exercise", typeId: "exercise", modeKey: "exerciseMode", timeKey: "exercisePreferredTime", defaultMode: "specified", defaultTime: "1930" },
    { id: "simple-health", typeId: "health", modeKey: "exerciseMode", timeKey: "exercisePreferredTime", defaultMode: "specified", defaultTime: "1930" }
]

type ConfiguredSimpleTaskPreference = {
    id: string
    typeId: string
    title: string
    mode: string
    time: string
    specifiedTimes?: string[]
    specifiedDayConstraint?: SpecifiedDayConstraint
    workDayTimes?: string[]
    restDayTimes?: string[]
}

function normalizedSpecifiedTimes(time?: string, times?: string[]): string[] {
    const values = (times && times.length > 0 ? times : [time || "2000"])
        .map(item => toHHmm(item))
        .filter(Boolean)
    return values.length > 0 ? values : [toHHmm("2000")]
}

const SIMPLE_TASK_LABELS: Record<string, string> = {
    shopping: "购物",
    housework: "家务",
    study: "学习",
    reading: "阅读",
    exercise: "运动",
    health: "健康",
    work: "工作",
    social: "社交",
    date: "约会",
    finance: "财务",
    leisure: "休闲",
    food: "饮食",
    medicine: "用药",
    phone: "电话",
    document: "文档",
    important: "重要",
    reminder: "提醒",
    general: "一般"
}

export function simpleTaskLabel(typeId: string): string {
    return SIMPLE_TASK_LABELS[String(typeId || "").trim()] || String(typeId || "").trim() || "一般"
}

/** 迁移已废弃的 typeId 到新值 */
export function configuredSimpleTaskPreferences(config?: AlertpilotConfig): ConfiguredSimpleTaskPreference[] {
    const preferences = config?.userPreferences
    if (!preferences) return []
    const stored = preferences.simpleTaskPreferences || []
    const hiddenIds = new Set(preferences.hiddenSimpleTaskIds || [])
    const storedById = new Map(stored.map(item => [item.id, item]))
    const defaults = DEFAULT_SIMPLE_TASK_PREFERENCES
        .filter(item => !hiddenIds.has(item.id))
        .map(item => {
            const saved = storedById.get(item.id)
            const typeId = String(saved?.typeId || item.typeId || "").trim()
            return {
                id: item.id,
                typeId,
                title: simpleTaskLabel(typeId),
                mode: saved?.mode || preferences[item.modeKey] || item.defaultMode,
                time: saved?.time || preferences[item.timeKey] || item.defaultTime,
                specifiedTimes: normalizedSpecifiedTimes(saved?.time || preferences[item.timeKey] || item.defaultTime, saved?.specifiedTimes),
                specifiedDayConstraint: saved?.specifiedDayConstraint || "any",
                workDayTimes: saved?.workDayTimes,
                restDayTimes: saved?.restDayTimes
            }
        })
    const customs = (preferences.customSimpleTasks || []).map((item, index) => {
        const typeId = String(item.typeId || item.title || "").trim()
        return {
            id: String(item.id || `custom-${index}`),
            typeId,
            title: simpleTaskLabel(typeId),
            mode: item.mode || "any",
            time: item.time || "2000",
            specifiedTimes: normalizedSpecifiedTimes(item.time || "2000", item.specifiedTimes),
            specifiedDayConstraint: item.specifiedDayConstraint || "any",
            workDayTimes: item.workDayTimes,
            restDayTimes: item.restDayTimes
        }
    })
    return [...defaults, ...customs]
}

export function configuredSimpleTaskFromCategory(category: TaskCategory, config?: AlertpilotConfig): ConfiguredSimpleTaskPreference | undefined {
    const raw = String(category || "").trim()
    const lower = raw.toLowerCase()
    return configuredSimpleTaskPreferences(config).find(item => {
        return item.typeId === raw ||
            item.title === raw ||
            item.typeId.toLowerCase() === lower ||
            item.title.toLowerCase() === lower
    })
}

/**
 * 构建供 AI 提示词使用的任务类别列表，仅包含用户已启用的任务。
 * 每个条目格式：`id/标签：语义解释`
 */
export function buildSimpleTaskCategoryPrompt(config?: AlertpilotConfig): string {
    const preferences = configuredSimpleTaskPreferences(config)
    if (preferences.length === 0) return "暂无已启用任务类型"
    return preferences.map(item => {
        const desc = SIMPLE_TASK_DESCRIPTIONS[item.typeId] || `${item.title}相关事项`
        return `${item.typeId} / ${item.title}：${desc}`
    }).join("\n\n")
}

function defaultSmartCategory(config?: AlertpilotConfig): TaskCategory {
    const configured = String(config?.userPreferences?.defaultSmartCategory || "").trim()
    if (configuredSimpleTaskFromCategory(configured, config)?.typeId) return configuredSimpleTaskFromCategory(configured, config)!.typeId
    const firstSimpleTask = configuredSimpleTaskPreferences(config)[0]
    return firstSimpleTask?.typeId || "general"
}

const URGENT_CONFLICT_LOOKAROUND_MINUTES = 60
const MAX_URGENT_MOVED_REMINDERS = 5

type SmartDecision = {
    category: TaskCategory
    slot: TimeSlot
    date: Date
    time: string
    reason: string
    deferredForQuietTime?: boolean
}

type DateDecision = {
    date: Date
    deferredForQuietTime: boolean
}

export function hasExplicitReminderTime(input: AlertpilotInput): boolean {
    const aiTimeWord = String(input.ai?.timeWord || "").trim()
    const normalizedAiTimeWord = aiTimeWord
        .replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, (_, y: string, m: string, d: string) => `${y}年${Number(m)}月${Number(d)}日`)

    const aiHasExplicitTime = Boolean(
        normalizedAiTimeWord && (
            /((([一二两三四五六七八九十]{2,4}|(20)?\d{2})[年\./])?([一二两三四五六七八九十]{1,2}|[01]?\d)?[月\./]([一二两三四五六七八九十]{1,3}|[0-3]?\d)[日号]?|([一二两三四五六七八九十]{1,3}|[0-3]?\d)[日号])/.test(normalizedAiTimeWord) ||
            /((周|星期)[一二三四五六七日天])/.test(normalizedAiTimeWord) ||
            /(大*[今昨明后]天|[\+加下]((\d+)|([一二两三四五六七八九十]+))个?(分钟|小时|天|周|星期|月|年)后?|[下两]星期|等[下会])/.test(normalizedAiTimeWord) ||
            /(?<!\d)((?:[01]?\d|2[0-3]):?[0-5]\d(?![\d年月日号\.\/-])|([上下]午|晚上)?[一二两三四五六七八九十]{1,3}[点时]([一二两三四五六七八九十]{1,3}分?)?)/.test(normalizedAiTimeWord) ||
            /([上中下][班午]|[早中晚][上饭餐]|现在)/.test(normalizedAiTimeWord)
        )
    )

    return Boolean(
        input.rawTime ||
        input.daypart ||
        input.otherTime ||
        input.month ||
        input.week ||
        input.isLatestRestDay ||
        aiHasExplicitTime
    )
}

export async function applySmartScheduleDecision(
    input: AlertpilotInput,
    config: AlertpilotConfig,
    logger: Logger,
    now = new Date()
): Promise<void> {
    const preferences = config.userPreferences
    if (!preferences?.enabled) return

    // 用户指定了明确时间（rawTime 或 daypart）或休息日模式 → 完全跳过
    if (input.rawTime || input.daypart || input.isLatestRestDay) return

    // 用户指定了日期（month/week/otherTime）但没有指定时间 → 用任务分类确定时间，保留用户日期
    if (input.month || input.week || input.otherTime) {
        const aiCategory = isTaskCategory(input.ai?.smartCategory, config) ? input.ai.smartCategory : undefined
        const category = aiCategory || defaultSmartCategory(config)
        let { time, slot } = getTimeForTaskCategory(category, config)
        
        // 解析目标日期
        let targetDate: Date | undefined
        if (input.week) {
            // 解析周几
            const weekDayMap: Record<string, number> = { '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 0, '周天': 0 }
            const weekDay = weekDayMap[input.week]
            if (weekDay !== undefined) {
                const today = new Date(now)
                const currentDay = today.getDay()
                let daysToAdd = weekDay - currentDay
                if (daysToAdd <= 0) daysToAdd += 7
                targetDate = new Date(today)
                targetDate.setDate(today.getDate() + daysToAdd)
            }
        }
        
        // 如果目标日期是休息日，使用休息日的时间配置
        if (targetDate) {
            const targetDateInfo = await getRestDayInfo(formatDateKey(targetDate))
            logger.debug("SCHEDULE", "Off day 判断结果（用户指定日期）", {
                dateKey: formatDateKey(targetDate),
                isRestDay: targetDateInfo.isRestDay,
                isHoliday: targetDateInfo.isHoliday,
                isAdjustedWorkday: targetDateInfo.isAdjustedWorkday,
                source: targetDateInfo.source,
                category,
                slot,
                time
            })
            
            // 如果目标日期是休息日，且当前slot是restTime，使用restDay的时间配置
            if (targetDateInfo.isRestDay && slot === "restTime") {
                time = toHHmm(config.userPreferences?.weekendDefaultTime || "1000")
                logger.debug("SCHEDULE", "休息日使用weekendDefaultTime", {
                    originalTime: time,
                    newTime: time,
                    weekendDefaultTime: config.userPreferences?.weekendDefaultTime
                })
            }
        }

        input.rawTime = `${time.slice(0, 2)}:${time.slice(2, 4)}`
        ;(input as any).smartScheduleDecision = {
            category,
            slot,
            reason: `任务分类「${simpleTaskLabel(category)}」的配置时间`,
            deferredForQuietTime: false
        }

        logger.trace("SCHEDULE", "任务分类时间已应用（用户指定了日期）", {
            category,
            slot,
            time: input.rawTime,
            date: input.month || input.week || input.otherTime
        })
        return
    }

    // 无明确日期和时间 → 完整智能调度（确定日期+时间）
    const text = input.ai?.text || input.ai?.rawText || input.shortcutInput?.rawText || input.finalText || ""
    const decision = await decideSmartScheduleDecision(input, config, now, logger)
    if (!decision) return

    input.rawTime = `${decision.time.slice(0, 2)}:${decision.time.slice(2, 4)}`
    input.month = `${decision.date.getFullYear()}年${decision.date.getMonth() + 1}月${decision.date.getDate()}日`
    ;(input as any).smartScheduleDecision = {
        category: decision.category,
        slot: decision.slot,
        reason: decision.reason,
        deferredForQuietTime: decision.deferredForQuietTime
    }

    logger.trace("SCHEDULE", "智能默认提醒已应用", {
        text,
        category: decision.category,
        slot: decision.slot,
        date: input.month,
        time: input.rawTime,
        reason: decision.reason,
        deferredForQuietTime: decision.deferredForQuietTime
    })
}

export async function avoidReminderTimeConflicts(
    input: AlertpilotInput,
    config: AlertpilotConfig,
    logger: Logger
): Promise<void> {
    const preferences = config.userPreferences
    if (!preferences?.enabled || !input.finalDate) return

    const maxConcurrentTasks = Math.max(1, Math.floor(Number(preferences.maxConcurrentTasks || 2)))
    const conflictDeferMinutes = roundDuration(preferences.conflictDeferMinutes || 30)
    const taskDurationMinutes = durationForTask(input, config)
    const originalStart = new Date(input.finalDate)
    const urgentTask = isUrgentTask(input)
    let start = new Date(originalStart)
    let end = addMinutes(start, taskDurationMinutes)

    // 紧急/高优先级任务只处理其开始时间附近的冲突，避免把后续几天的任务卷入重排。
    // 普通任务仍按当天窗口判断，保持原有“为新任务找空档”的行为。
    const queryStart = urgentTask ? addMinutes(start, -URGENT_CONFLICT_LOOKAROUND_MINUTES) : startOfDay(start)
    const queryEnd = urgentTask ? addMinutes(start, URGENT_CONFLICT_LOOKAROUND_MINUTES + taskDurationMinutes) : endOfDay(addMinutes(start, 24 * 60))
    let existing: ScheduledReminderWindow[] = []

    try {
        existing = await getScheduledReminderWindows(
            queryStart,
            queryEnd,
            reminder => durationForReminder(reminder.title || "", reminder.calendar?.title || "", Number(reminder.priority || 0), config)
        )
    } catch (error) {
        logger.warn("SCHEDULE", "读取提醒事项列表用于冲突判断失败，已跳过重排", {
            error: String(error)
        })
        return
    }

    let moved = false
    const reasons: string[] = []
    let movedExistingCount = 0

    if (urgentTask) {
        const inserted = await makeRoomForUrgentTask(
            existing,
            start,
            end,
            priorityValueForInput(input),
            taskDurationMinutes,
            logger
        )
        movedExistingCount = inserted.movedCount
        reasons.push(...inserted.reasons)

        // 高优先级任务必须保留用户指定的开始时间；只允许顺延开始时间附近的低优先级冲突项。
        logger.warn("SCHEDULE", movedExistingCount > 0 ? "⏰高优先级提醒已保留原时间，附近冲突提醒已顺延" : "高优先级提醒已保留原时间，无冲突", {
            urgentTime: formatScheduledDate(start),
            movedExistingCount,
            reason: reasons[reasons.length - 1] || "用户设置了高优先级，冲突处理范围限制在开始时间附近约 1 小时",
            checkedReminderCount: existing.length,
            conflictLookaroundMinutes: URGENT_CONFLICT_LOOKAROUND_MINUTES,
            maxMovedReminders: MAX_URGENT_MOVED_REMINDERS,
            deferredByMinutes: taskDurationMinutes
        })
        return
    }

    for (let guard = 0; guard < 96; guard += 1) {
        const overflowStart = await nextTaskWindowStartAfterBoundary(input, start, end, config, priorityValueForInput(input) > 0)
        if (overflowStart) {
            reasons.push(`顺延后预计完成时间会超过当前可用时间窗口，已改到下一次可开始 ${formatScheduledDate(overflowStart)}`)
            start = overflowStart
            end = addMinutes(start, taskDurationMinutes)
            moved = true
            continue
        }

        const overlaps = existing.filter(item => rangesOverlap(start, end, item.start, item.end))
        const conflictBufferMinutes = preferences?.conflictBufferMinutes || 10
        if (overlaps.length > 0) {
            logger.warn("SCHEDULE", "⏰时间范围重叠冲突检测", {
                新任务: `${formatScheduledDate(start)} ~ ${formatScheduledDate(end)}`,
                重叠数: overlaps.length,
                并发上限: maxConcurrentTasks,
                重叠任务: overlaps.map(item => `${item.title}(${formatScheduledDate(item.start)} ~ ${formatScheduledDate(item.end)})`).join(", ")
            })
        }
        if (overlaps.length < maxConcurrentTasks) break

        // 找到所有重叠任务中最晚的结束时间，加上缓冲
        const latestEnd = overlaps.reduce((max, item) => item.end > max ? item.end : max, overlaps[0].end)
        start = addMinutes(latestEnd, conflictBufferMinutes)
        end = addMinutes(start, taskDurationMinutes)
        moved = true
    }

    if (!moved || sameMinute(originalStart, start)) {
        if (movedExistingCount > 0) {
            logger.warn("SCHEDULE", "⏰紧急提醒已优先插队，原有提醒已顺延", {
                urgentTime: formatScheduledDate(start),
                movedExistingCount,
                reason: reasons[reasons.length - 1] || "用户输入感叹号，按紧急任务处理",
                checkedReminderCount: existing.length
            })
        }
        return
    }

    input.finalDate = start
    input.time = formatScheduledDate(start)
    input.rawTime = `${pad2(start.getHours())}:${pad2(start.getMinutes())}`
    input.month = `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日`

    logger.warn("SCHEDULE", "⏰提醒时间冲突已重排，时间已调整", {
        originalTime: formatScheduledDate(originalStart),
        adjustedTime: input.time,
        durationMinutes: taskDurationMinutes,
        maxConcurrentTasks,
        conflictDeferMinutes,
        reason: reasons[reasons.length - 1] || "同一时间任务冲突",
        checkedReminderCount: existing.length,
        movedExistingCount
    })
}

async function makeRoomForUrgentTask(
    existing: ScheduledReminderWindow[],
    urgentStart: Date,
    urgentEnd: Date,
    urgentPriority: number,
    taskDurationMinutes: number,
    logger: Logger
): Promise<{ movedCount: number; reasons: string[] }> {
    let movedCount = 0
    const reasons: string[] = []

    const nearbyConflicts = existing
        .filter(item =>
            item.reminder &&
            priorityValueForReminder(item) < urgentPriority &&
            isNearUrgentStart(item.start, urgentStart) &&
            (sameMinute(item.start, urgentStart) || rangesOverlap(urgentStart, urgentEnd, item.start, item.end))
        )
        .sort((a, b) => priorityValueForReminder(a) - priorityValueForReminder(b) || a.start.getTime() - b.start.getTime())

    const conflictLimit = Math.min(MAX_URGENT_MOVED_REMINDERS, nearbyConflicts.length)

    for (const victim of nearbyConflicts.slice(0, conflictLimit)) {
        const newStart = addMinutes(victim.start, taskDurationMinutes)

        try {
            await rescheduleReminderWindow(victim, newStart)
            movedCount += 1
            reasons.push(`高优先级任务占用 ${formatScheduledDate(urgentStart)}，已将附近冲突提醒“${victim.title}”顺延一个任务时长到 ${formatScheduledDate(newStart)}`)
        } catch (error) {
            logger.warn("SCHEDULE", "高优先级任务插队时顺延附近提醒失败，跳过该提醒", {
                title: victim.title,
                error: String(error)
            })
        }
    }

    return { movedCount, reasons }
}

function isNearUrgentStart(date: Date, urgentStart: Date): boolean {
    return Math.abs(date.getTime() - urgentStart.getTime()) <= URGENT_CONFLICT_LOOKAROUND_MINUTES * 60 * 1000
}

function findNextAvailableStartForWindow(
    window: ScheduledReminderWindow,
    others: ScheduledReminderWindow[],
    earliestStart: Date,
    maxConcurrentTasks: number,
    conflictDeferMinutes: number
): Date {
    let start = new Date(Math.max(window.start.getTime(), earliestStart.getTime()))
    let end = addMinutes(start, window.durationMinutes)

    for (let guard = 0; guard < 96; guard += 1) {
        const sameStartConflicts = others.filter(item => sameMinute(item.start, start))
        const overlaps = others.filter(item => rangesOverlap(start, end, item.start, item.end))
        if (sameStartConflicts.length === 0 && overlaps.length < maxConcurrentTasks) return start

        start = addMinutes(start, conflictDeferMinutes)
        end = addMinutes(start, window.durationMinutes)
    }

    return start
}

export function learnFromExplicitSchedule(
    input: AlertpilotInput,
    config: AlertpilotConfig,
    logger: Logger
): boolean {
    const preferences = config.userPreferences
    if (!preferences?.enabled || !preferences.autoLearn) return false
    if (!hasExplicitReminderTime(input)) return false
    if ((input as any).smartScheduleDecision) return false

    const reminderListCategory = reminderListLearningCategory(input, config)
    const taskCategory = isTaskCategory(input.ai?.smartCategory, config) ? input.ai!.smartCategory! : defaultSmartCategory(config)
    const slot = inferSlotFromInput(input, config)
    if (!taskCategory || !slot) return false

    const learning = preferences.learning || {}
    const taskStat = bumpLearningStat(learning[taskCategory], slot)
    learning[taskCategory] = taskStat
    preferences.learning = learning

    const learningByList = preferences.learningByList || {}
    const listStat = bumpLearningStat(learningByList[reminderListCategory], slot)
    learningByList[reminderListCategory] = listStat
    preferences.learningByList = learningByList

    logger.debug("SCHEDULE", "已记录用户显式时间偏好（本地学习，不消耗 AI token）", {
        category: taskCategory,
        reminderListCategory,
        slot,
        stat: taskStat,
        listStat
    })
    return true
}

function decideSmartScheduleDecision(input: AlertpilotInput, config: AlertpilotConfig, now: Date, logger?: Logger): Promise<SmartDecision | null> {
    return decideSmartScheduleDecisionAsync(input, config, now, logger)
}

async function decideSmartScheduleDecisionAsync(input: AlertpilotInput, config: AlertpilotConfig, now: Date, logger?: Logger): Promise<SmartDecision | null> {
    const preferences = config.userPreferences
    if (!preferences?.enabled) return null

    const aiCategory = isTaskCategory(input.ai?.smartCategory, config) ? input.ai.smartCategory : undefined
    const category = aiCategory || defaultSmartCategory(config)
    // 暂停：自学习样本仍在积累阶段，暂不让 learning / learningByList 控制时间槽。
    // 后续样本足够稳定后，可再恢复：learnedTaskSlot(category, config) || learnedListSlot(reminderListCategory, config)
    const learned: TimeSlot | undefined = undefined
    const slot = defaultSlot(category, config)
    
    // 输出 Off day 判断日志
    if (logger) {
        const todayInfo = await getRestDayInfo(formatDateKey(now))
        logger.debug("SCHEDULE", "Off day 判断结果", {
            dateKey: formatDateKey(now),
            isRestDay: todayInfo.isRestDay,
            isHoliday: todayInfo.isHoliday,
            isAdjustedWorkday: todayInfo.isAdjustedWorkday,
            source: todayInfo.source
        })
    }
    
    const specified = await specifiedTaskDecision(category, config, now, hasPriority(input))
    const time = specified?.time || timeForSlot(slot, category, config)
    const dateResult = specified?.dateResult || await nextDateForSlot(slot, time, config, now, hasPriority(input))
    const scheduledTime = `${pad2(dateResult.date.getHours())}${pad2(dateResult.date.getMinutes())}`
    const boundaryLabel = slot === "work" ? "工作时间" : "停止处理事项时间"
    const baseReason = input.ai?.smartReason
        ? `${input.ai.smartReason}；${reasonFor(category, slot, Boolean(learned), false, config)}`
        : reasonFor(category, slot, Boolean(learned), false, config)
    const reason = `${baseReason}${dateResult.deferredForQuietTime ? `；因预计完成会超过${boundaryLabel}，已顺延到下一次合适时间` : ""}`

    return {
        category,
        slot,
        date: dateResult.date,
        time: scheduledTime,
        reason,
        deferredForQuietTime: dateResult.deferredForQuietTime
    }
}

function bumpLearningStat(stat: any, slot: TimeSlot) {
    const next = stat || { morning: 0, work: 0, restTime: 0, restDay: 0, any: 0, total: 0 }
    next[slot] = (next[slot] || 0) + 1
    next.total = (next.total || 0) + 1
    return next
}

export function reminderListLearningCategory(input: AlertpilotInput, config: AlertpilotConfig): LearningCategory {
    return normalizeReminderListCategory(input.classReminders || input.ai?.classReminders || "", config)
}

export function normalizeReminderListCategory(value: string, config: AlertpilotConfig): LearningCategory {
    const raw = String(value || "").trim()
    const lists = config["提醒列表"] || {}
    const defaultList = getDefaultReminderList(config)

    if (!raw || raw.toLowerCase() === "general") return defaultList
    if (lists[raw]) return lists[raw]

    const matchedValue = Object.values(lists).find(listName => String(listName).trim() === raw)
    if (matchedValue) return matchedValue

    // 兼容系统/中文默认列表名，以及 AI 偶尔返回的大小写差异。
    if (raw === "提醒事项") return "Reminders"
    const lowerMatchedValue = Object.values(lists).find(listName => String(listName).trim().toLowerCase() === raw.toLowerCase())
    return lowerMatchedValue || raw || defaultList
}

function isTaskCategory(value: unknown, config?: AlertpilotConfig): value is TaskCategory {
    const raw = String(value || "").trim()
    if (!raw) return false
    return ["work", "shopping", "housework", "study", "health", "relationship", "finance", "leisure", "general"].includes(raw) || Boolean(configuredSimpleTaskFromCategory(raw, config)?.typeId)
}

function isTimeSlot(value: unknown): value is TimeSlot {
    return ["morning", "work", "restTime", "restDay", "any", "evening", "rest", "weekend"].includes(String(value))
}

function learnedTaskSlot(category: TaskCategory, config: AlertpilotConfig): TimeSlot | undefined {
    return learnedSlot(config.userPreferences?.learning?.[category])
}

function learnedListSlot(category: LearningCategory, config: AlertpilotConfig): TimeSlot | undefined {
    return learnedSlot(config.userPreferences?.learningByList?.[category])
}

function learnedSlot(stat: any): TimeSlot | undefined {
    if (!stat || (stat.total || 0) < 3) return undefined

    const legacyRestTime = Number(stat.restTime || 0) + Number(stat.evening || 0) + Number(stat.rest || 0)
    const slots = [
        { slot: "morning" as TimeSlot, count: Number(stat.morning || 0) },
        { slot: "work" as TimeSlot, count: Number(stat.work || 0) },
        { slot: "restTime" as TimeSlot, count: legacyRestTime },
        { slot: "restDay" as TimeSlot, count: Number(stat.restDay || 0) + Number(stat.weekend || 0) },
        { slot: "any" as TimeSlot, count: Number(stat.any || 0) }
    ]
    const best = slots.sort((a, b) => b.count - a.count)[0]

    return best.count >= 2 ? best.slot : undefined
}

export function defaultSlot(category: TaskCategory, config: AlertpilotConfig): TimeSlot {
    const preferences = config.userPreferences
    const configuredTask = configuredSimpleTaskFromCategory(category, config)
    if (configuredTask) {
        return modeToSlot(configuredTask.mode) || "any"
    }
    switch (category) {
        case "work":
            return "work"
        case "shopping":
            return modeToSlot(preferences?.shoppingMode) || "any"
        case "housework":
            return modeToSlot(preferences?.houseworkMode) || "any"
        case "study":
            return modeToSlot(preferences?.studyMode) || timeTextToSlot(preferences?.studyPreferredTime) || "restTime"
        case "health":
            return modeToSlot(preferences?.exerciseMode) || timeTextToSlot(preferences?.exercisePreferredTime) || "restTime"
        case "relationship":
        case "finance":
            return "restTime"
        case "leisure":
            return "restDay"
        default:
            return "any"
    }
}

function modeToSlot(mode?: string): TimeSlot | undefined {
    if (mode === "work") return "work"
    if (mode === "restDay" || mode === "weekend") return "restDay"
    if (mode === "restTime" || mode === "evening") return "restTime"
    if (mode === "any") return "any"
    if (mode === "specified") return "any"
    return undefined
}

function timeTextToSlot(time?: string): TimeSlot | undefined {
    const n = Number(String(time || "").replace(/\D/g, ""))
    if (!n) return undefined
    if (n < 1200) return "morning"
    if (n < 1800) return "work"
    if (n < 2300) return "restTime"
    return undefined
}

function timeForSlot(slot: TimeSlot, category: TaskCategory, config: AlertpilotConfig): string {
    const preferences = config.userPreferences
    const workStart = toHHmm(preferences?.workStart || "0830")
    const workEnd = toHHmm(preferences?.workEnd || "1730")
    const important = toHHmm(preferences?.importantTaskTime || "1000")

    if (category === "work") {
        return clampTime(important, workStart, workEnd)
    }

    const specifiedTime = specifiedTaskTimes(category, config).times[0]
    if (specifiedTime) return specifiedTime

    if (slot === "morning") return important
    if (slot === "work") return clampTime(important, workStart, workEnd)
    if (slot === "restTime") return toHHmm(preferences?.dailyTaskStart || "2000")
    if (slot === "restDay") return toHHmm(preferences?.weekendDefaultTime || "1000")
    return toHHmm(getDefaultTime(config))
}

/** 获取任务分类对应的配置时间和时间槽，用于用户指定日期但未指定时间的场景 */
export function getTimeForTaskCategory(category: TaskCategory, config: AlertpilotConfig): { time: string; slot: TimeSlot } {
    const slot = defaultSlot(category, config)
    const time = timeForSlot(slot, category, config)
    return { time, slot }
}

function specifiedTaskTimes(category: TaskCategory, config: AlertpilotConfig): { times: string[]; dayConstraint: SpecifiedDayConstraint; workDayTimes?: string[]; restDayTimes?: string[] } {
    const preferences = config.userPreferences
    const configuredTask = configuredSimpleTaskFromCategory(category, config)
    if (configuredTask?.mode === "specified") {
        return {
            times: normalizedSpecifiedTimes(configuredTask.time || preferences?.dailyTaskStart || "2000", configuredTask.specifiedTimes),
            dayConstraint: configuredTask.specifiedDayConstraint || "any",
            workDayTimes: configuredTask.workDayTimes,
            restDayTimes: configuredTask.restDayTimes
        }
    }
    if (!preferences) return { times: [], dayConstraint: "any" }
    if (category === "shopping" && preferences.shoppingMode === "specified") return { times: [toHHmm(preferences.shoppingTime || preferences.dailyTaskStart || "2000")], dayConstraint: "any" }
    if (category === "housework" && preferences.houseworkMode === "specified") return { times: [toHHmm(preferences.houseworkTime || preferences.dailyTaskStart || "2000")], dayConstraint: "any" }
    if (category === "study" && (preferences.studyMode || "specified") === "specified") return { times: [toHHmm(preferences.studyPreferredTime || "2100")], dayConstraint: "any" }
    if (category === "health" && (preferences.exerciseMode || "specified") === "specified") return { times: [toHHmm(preferences.exercisePreferredTime || "1930")], dayConstraint: "any" }
    return { times: [], dayConstraint: "any" }
}

async function specifiedTaskDecision(category: TaskCategory, config: AlertpilotConfig, now: Date, priorityOverride = false): Promise<{ time: string; dateResult: DateDecision } | undefined> {
    const specified = specifiedTaskTimes(category, config)
    return specified.times.length > 0
        ? await nextSpecifiedTimeDecision(specified.times, specified.dayConstraint, config, now, priorityOverride, specified.workDayTimes, specified.restDayTimes)
        : undefined
}

async function nextSpecifiedTimeDecision(times: string[], dayConstraint: SpecifiedDayConstraint, config: AlertpilotConfig, now: Date, priorityOverride = false, workDayTimes?: string[], restDayTimes?: string[]): Promise<{ time: string; dateResult: DateDecision } | undefined> {
    const decisions = await Promise.all(times.map(async time => ({
        time,
        dateResult: await nextSpecifiedDate(dayConstraint, time, config, now, priorityOverride, workDayTimes, restDayTimes)
    })))
    return decisions.sort((a, b) => a.dateResult.date.getTime() - b.dateResult.date.getTime())[0]
}

function clampTime(value: string, min: string, max: string): string {
    const n = Number(toHHmm(value))
    const minN = Number(toHHmm(min))
    const maxN = Number(toHHmm(max))
    if (n < minN) return toHHmm(min)
    if (n > maxN) return toHHmm(max)
    return toHHmm(value)
}

async function nextDateForSlot(slot: TimeSlot, time: string, config: AlertpilotConfig, now: Date, priorityOverride = false, disableFloatingDailySlot = false): Promise<DateDecision> {
    switch (slot) {
        case "work":
        case "morning":
            return await nextWorkDate(config, now, priorityOverride)
        case "restTime":
            return await nextRestTimeDate(config, now, priorityOverride)
        case "restDay":
            return await nextRestDayDate(config, now, priorityOverride)
        default:
            return await nextAnyDate(config, now, priorityOverride)
    }
}

async function nextWorkDate(config: AlertpilotConfig, now: Date, priorityOverride: boolean): Promise<DateDecision> {
    // [2026-06-17 修改] 改为使用开始时间+偏移量调度，原代码注释保留
    const preferences = config.userPreferences
    const workStartHHmm = toHHmm(preferences?.workStart || "0830")
    const workEndHHmm = toHHmm(preferences?.workEnd || "1730")
    const offsetMinutes = preferences?.floatingTaskDelayMinutes || 10
    const durationMinutes = generalDurationMinutes(config)

    // 1. 获取今天的工作日信息
    const todayInfo = await getRestDayInfo(formatDateKey(now))
    const currentHHmm = nowHHmmNumber(now)

    // 如果今天是工作日，尝试安排在今天
    if (!todayInfo.isRestDay) {
        let candidateHHmm: number
        if (currentHHmm < Number(workStartHHmm)) {
            // 当前时间 < 开始时间，使用开始时间
            candidateHHmm = Number(workStartHHmm)
        } else {
            // 当前时间 >= 开始时间，使用当前时间 + offset
            candidateHHmm = addMinutesToHHmm(currentHHmm, offsetMinutes)
        }

        // 检查候选时间是否在工作时间范围内
        if (candidateHHmm < Number(workEndHHmm)) {
            const candidate = dateAtHHmm(now, pad4(candidateHHmm))
            if (priorityOverride || !exceedsBoundary(candidate, durationMinutes, Number(workEndHHmm))) {
                return { date: candidate, deferredForQuietTime: false }
            }
        }
    }

    // 2. 今天不行，获取下一个工作日
    const workDay = await getLatestWorkDayInfo({ baseDate: addDays(now, 1) })
    const workDayDate = parseDateKeyToDate(workDay.dateKey)
    const candidate = dateAtHHmm(workDayDate, workStartHHmm)
    if (priorityOverride || !exceedsBoundary(candidate, durationMinutes, Number(workEndHHmm))) {
        return { date: candidate, deferredForQuietTime: true }
    }

    // 3. 兜底
    return { date: dateAtHHmm(workDayDate, workStartHHmm), deferredForQuietTime: true }

    /* ── 原代码（2026-06-17 之前）──
    // 1. 先在今天的工作时间范围内找
    const todayInfo = await getRestDayInfo(formatDateKey(now))
    if (!todayInfo.isRestDay) {
        const candidate = await findCompletionInSlot(now, "work", config, now)
        if (candidate && (priorityOverride || !exceedsBoundary(candidate, durationMinutes, workEnd))) {
            return { date: candidate, deferredForQuietTime: false }
        }
    }

    // 2. 今天不行，直接获取下一个工作日
    const workDay = await getLatestWorkDayInfo({ baseDate: addDays(now, 1) })
    const workDayDate = parseDateKeyToDate(workDay.dateKey)
    const candidate = await findCompletionInSlot(workDayDate, "work", config, now)
    if (candidate && (priorityOverride || !exceedsBoundary(candidate, durationMinutes, workEnd))) {
        return { date: candidate, deferredForQuietTime: false }
    }

    // 3. 兜底：下一个工作日的 workStart
    return { date: dateAtHHmm(workDayDate, toHHmm(config.userPreferences?.workStart || "0830")), deferredForQuietTime: false }
    ── 结束 ── */
}

async function nextRestTimeDate(config: AlertpilotConfig, now: Date, priorityOverride: boolean): Promise<DateDecision> {
    // 休息时间(restTime)逻辑：
    // - 工作日：在 dailyTaskStart ~ quietAfter 范围内补全
    // - 休息日：按照休息日的补全规则来（复用 nextRestDayDate）
    
    const preferences = config.userPreferences
    const dailyTaskStartHHmm = toHHmm(preferences?.dailyTaskStart || "2000")
    const quietAfterHHmm = toHHmm(preferences?.quietAfter || "2200")
    const offsetMinutes = preferences?.floatingTaskDelayMinutes || 10
    const durationMinutes = generalDurationMinutes(config)

    // 1. 获取今天的休息日信息
    const todayInfo = await getRestDayInfo(formatDateKey(now))
    const currentHHmm = nowHHmmNumber(now)
    
    // 休息日：按照休息日的补全规则来（复用 nextRestDayDate）
    if (todayInfo.isRestDay) {
        return await nextRestDayDate(config, now, priorityOverride)
    }

    // 工作日：在 dailyTaskStart ~ quietAfter 范围内
    const boundary = getRestTimeBoundary(false, config)
    let candidateHHmm: number
    if (currentHHmm < Number(dailyTaskStartHHmm)) {
        candidateHHmm = Number(dailyTaskStartHHmm)
    } else {
        candidateHHmm = addMinutesToHHmm(currentHHmm, offsetMinutes)
    }

    // 检查候选时间是否在休息时间范围内
    if (candidateHHmm < Number(quietAfterHHmm)) {
        const candidate = dateAtHHmm(now, pad4(candidateHHmm))
        if (priorityOverride || boundary === undefined || !exceedsBoundary(candidate, durationMinutes, boundary)) {
            return { date: candidate, deferredForQuietTime: false }
        }
    }

    // 2. 今天不行，从明天开始逐日尝试（最多 7 天）
    for (let offset = 1; offset <= 7; offset += 1) {
        const day = addDays(now, offset)
        const dayInfo = await getRestDayInfo(formatDateKey(day))
        
        // 休息日：按照休息日的补全规则来（复用 nextRestDayDate）
        // 注意：day 来自 addDays(now, offset)，保留了原始时间分量（如 22:41）。
        // 必须归零到当天 00:00，否则 nextRestDayDate 内部 nowHHmmNumber 取到 22:41
        // 导致跳过 weekendDefaultTime 分支，错误地用 22:41+偏移量而非 10:00。
        if (dayInfo.isRestDay) {
            return await nextRestDayDate(config, dateAtHHmm(day, "0000"), priorityOverride)
        }
        
        // 工作日：使用dailyTaskStart
        const dayBoundary = getRestTimeBoundary(false, config)
        const candidate = dateAtHHmm(day, dailyTaskStartHHmm)
        if (priorityOverride || dayBoundary === undefined || !exceedsBoundary(candidate, durationMinutes, dayBoundary)) {
            return { date: candidate, deferredForQuietTime: offset > 1 }
        }
    }

    // 3. 兜底
    return { date: dateAtHHmm(addDays(now, 1), dailyTaskStartHHmm), deferredForQuietTime: true }

    /* ── 原代码（2026-06-17 之前）──
    // 1. 先在今天的休息时间范围内找
    const todayInfo = await getRestDayInfo(formatDateKey(now))
    const boundary = getRestTimeBoundary(todayInfo.isRestDay, config)
    const candidate = await findCompletionInSlot(now, "restTime", config, now)
    if (candidate && (priorityOverride || boundary === undefined || !exceedsBoundary(candidate, durationMinutes, boundary))) {
        return { date: candidate, deferredForQuietTime: false }
    }

    // 2. 今天不行，从明天开始逐日尝试（最多 7 天）
    for (let offset = 1; offset <= 7; offset += 1) {
        const day = addDays(now, offset)
        const dayInfo = await getRestDayInfo(formatDateKey(day))
        const dayBoundary = getRestTimeBoundary(dayInfo.isRestDay, config)
        const next = await findCompletionInSlot(day, "restTime", config, now)
        if (next && (priorityOverride || dayBoundary === undefined || !exceedsBoundary(next, durationMinutes, dayBoundary))) {
            return { date: next, deferredForQuietTime: offset > 1 }
        }
    }

    // 3. 兜底
    const isTodayRest = todayInfo.isRestDay
    const fallbackTime = isTodayRest ? getDefaultRestDayTime(config) : toHHmm(config.userPreferences?.dailyTaskStart || "2000")
    return { date: dateAtHHmm(addDays(now, 1), fallbackTime), deferredForQuietTime: true }
    ── 结束 ── */
}

async function nextRestDayDate(config: AlertpilotConfig, now: Date, priorityOverride: boolean): Promise<DateDecision> {
    // [2026-06-17 修改] 改为使用开始时间+偏移量调度，原代码注释保留
    const preferences = config.userPreferences
    const weekendDefaultTimeHHmm = toHHmm(preferences?.weekendDefaultTime || "1000")
    const offsetMinutes = preferences?.floatingTaskDelayMinutes || 10
    const durationMinutes = generalDurationMinutes(config)

    // 1. 获取今天的休息日信息
    const todayInfo = await getRestDayInfo(formatDateKey(now))
    const currentHHmm = nowHHmmNumber(now)

    // 如果今天是休息日
    if (todayInfo.isRestDay) {
        let candidateHHmm: number
        if (currentHHmm < Number(weekendDefaultTimeHHmm)) {
            candidateHHmm = Number(weekendDefaultTimeHHmm)
        } else {
            candidateHHmm = addMinutesToHHmm(currentHHmm, offsetMinutes)
        }
        const candidate = dateAtHHmm(now, pad4(candidateHHmm))
        if (priorityOverride || !exceedsBoundary(candidate, durationMinutes, undefined)) {
            return { date: candidate, deferredForQuietTime: false }
        }
    }

    // 2. 今天不行，获取下一个休息日
    const restDay = await getLatestRestDayInfo({ baseDate: addDays(now, 1) })
    const restDayDate = parseDateKeyToDate(restDay.dateKey)
    const candidate = dateAtHHmm(restDayDate, weekendDefaultTimeHHmm)
    if (priorityOverride || !exceedsBoundary(candidate, durationMinutes, undefined)) {
        return { date: candidate, deferredForQuietTime: true }
    }

    // 3. 兜底
    return { date: dateAtHHmm(restDayDate, weekendDefaultTimeHHmm), deferredForQuietTime: true }

    /* ── 原代码（2026-06-17 之前）──
    // 1. 先在今天的休息日全天找（如果今天是休息日）
    const todayInfo = await getRestDayInfo(formatDateKey(now))
    if (todayInfo.isRestDay) {
        const candidate = await findCompletionInSlot(now, "restDay", config, now)
        if (candidate && (priorityOverride || !exceedsBoundary(candidate, durationMinutes, undefined))) {
            return { date: candidate, deferredForQuietTime: false }
        }
    }

    // 2. 今天不行，直接获取下一个休息日
    const restDay = await getLatestRestDayInfo({ baseDate: addDays(now, 1) })
    const restDayDate = parseDateKeyToDate(restDay.dateKey)
    const candidate = await findCompletionInSlot(restDayDate, "restDay", config, now)
    if (candidate && (priorityOverride || !exceedsBoundary(candidate, durationMinutes, undefined))) {
        return { date: candidate, deferredForQuietTime: true }
    }

    // 3. 兜底
    return { date: dateAtHHmm(restDayDate, getDefaultRestDayTime(config)), deferredForQuietTime: true }
    ── 结束 ── */
}

async function nextAnyDate(config: AlertpilotConfig, now: Date, priorityOverride: boolean): Promise<DateDecision> {
    // [2026-06-17 修改] 改为使用开始时间+偏移量调度，原代码注释保留
    const preferences = config.userPreferences
    const generalPreferredTimeHHmm = toHHmm(preferences?.generalPreferredTime || "2000")
    const offsetMinutes = preferences?.floatingTaskDelayMinutes || 10
    const durationMinutes = generalDurationMinutes(config)

    // 1. 今天
    const currentHHmm = nowHHmmNumber(now)
    let candidateHHmm: number
    if (currentHHmm < Number(generalPreferredTimeHHmm)) {
        candidateHHmm = Number(generalPreferredTimeHHmm)
    } else {
        candidateHHmm = addMinutesToHHmm(currentHHmm, offsetMinutes)
    }
    const candidate = dateAtHHmm(now, pad4(candidateHHmm))
    if (priorityOverride || !exceedsBoundary(candidate, durationMinutes, undefined)) {
        return { date: candidate, deferredForQuietTime: false }
    }

    // 2. 今天不行，从明天开始逐日尝试（最多 7 天）
    for (let offset = 1; offset <= 7; offset += 1) {
        const day = addDays(now, offset)
        const next = dateAtHHmm(day, generalPreferredTimeHHmm)
        if (priorityOverride || !exceedsBoundary(next, durationMinutes, undefined)) {
            return { date: next, deferredForQuietTime: offset > 1 }
        }
    }

    // 3. 兜底
    return { date: dateAtHHmm(addDays(now, 1), generalPreferredTimeHHmm), deferredForQuietTime: true }

    /* ── 原代码（2026-06-17 之前）──
    // 1. 先在今天找
    const candidate = await findCompletionInSlot(now, "any", config, now)
    if (candidate && (priorityOverride || !exceedsBoundary(candidate, durationMinutes, undefined))) {
        return { date: candidate, deferredForQuietTime: false }
    }

    // 2. 明天开始逐日尝试（最多 7 天）
    for (let offset = 1; offset <= 7; offset += 1) {
        const day = addDays(now, offset)
        const next = await findCompletionInSlot(day, "any", config, now)
        if (next && (priorityOverride || !exceedsBoundary(next, durationMinutes, undefined))) {
            return { date: next, deferredForQuietTime: offset > 1 }
        }
    }

    // 3. 兜底
    return { date: dateAtHHmm(addDays(now, 1), getDefaultTime(config)), deferredForQuietTime: true }
    ── 结束 ── */
}

async function nextSpecifiedDate(dayConstraint: SpecifiedDayConstraint, time: string, config: AlertpilotConfig, now: Date, priorityOverride = false, workDayTimes?: string[], restDayTimes?: string[]): Promise<DateDecision> {
    if (dayConstraint === "split") {
        const normalizedWorkTimes = normalizedSpecifiedTimes(time, workDayTimes)
        const normalizedRestTimes = normalizedSpecifiedTimes(time, restDayTimes)
        const decisions = await Promise.all([
            ...normalizedWorkTimes.map(t => nextSpecifiedDate("work", t, config, now, priorityOverride)),
            ...normalizedRestTimes.map(t => nextSpecifiedDate("rest", t, config, now, priorityOverride))
        ])
        return decisions.sort((a, b) => a.date.getTime() - b.date.getTime())[0]
    }
    if (dayConstraint === "work") return await nextDateForSpecificClockTime(time, config, now, { allowedDays: "work" }, priorityOverride)
    if (dayConstraint === "rest") return await nextDateForSpecificClockTime(time, config, now, { allowedDays: "rest" }, priorityOverride)
    return await nextDateForSpecificClockTime(time, config, now, { allowedDays: "any" }, priorityOverride)
}

// ── 共享子函数 ──────────────────────────────────────────────

function generalDurationMinutes(config: AlertpilotConfig): number {
    return Math.max(0, Number(config.userPreferences?.generalTaskDurationMinutes || 30))
}

function parseDateKeyToDate(dateKey: string): Date {
    const [y, m, d] = dateKey.split("-").map(Number)
    return new Date(y, m - 1, d, 0, 0, 0, 0)
}

/** 在指定日期的补全表中，找第一个符合 slot 约束的候选时间 */
async function findCompletionInSlot(day: Date, slot: TimeSlot, config: AlertpilotConfig, now: Date): Promise<Date | undefined> {
    const completions = sortedTimeCompletions(config)
    const isToday = sameDay(day, now)
    const currentHHmm = nowHHmmNumber(now)
    const isRestDay = (await getRestDayInfo(formatDateKey(day))).isRestDay
    const workStart = Number(toHHmm(config.userPreferences?.workStart || "0830"))
    const workEnd = Number(toHHmm(config.userPreferences?.workEnd || "1730"))
    const dailyTaskStart = Number(toHHmm(config.userPreferences?.dailyTaskStart || "2000"))
    const quietAfter = Number(toHHmm(config.userPreferences?.quietAfter || "2200"))

    for (const completion of completions) {
        const candidate = completionCandidateDate(day, completion, config)
        if (!candidate) continue
        const hhmm = nowHHmmNumber(candidate)
        if (isToday && hhmm <= currentHHmm) continue
        if (!isTimeInSlotRange(slot, hhmm, isRestDay, workStart, workEnd, dailyTaskStart, quietAfter)) continue
        return candidate
    }
    return undefined
}

/** 判断候选时间是否在 slot 允许的范围内 */
function isTimeInSlotRange(slot: TimeSlot, hhmm: number, isRestDay: boolean, workStart: number, workEnd: number, dailyTaskStart: number, quietAfter: number): boolean {
    if (slot === "morning") return !isRestDay && hhmm < 1200
    if (slot === "work") return !isRestDay && hhmm >= workStart && hhmm < workEnd
    if (slot === "restDay") return isRestDay
    if (slot === "restTime") {
        if (isRestDay) return true
        return hhmm >= dailyTaskStart && hhmm < quietAfter
    }
    return true // any
}

/** restTime 的边界：工作日晚上有 quietAfter，休息日无边界 */
function getRestTimeBoundary(isRestDay: boolean, config: AlertpilotConfig): number | undefined {
    if (isRestDay) return undefined
    return Number(toHHmm(config.userPreferences?.quietAfter || "2200"))
}

/** 检查候选时间 + 任务时长是否超过边界 */
function exceedsBoundary(start: Date, durationMinutes: number, boundary: number | undefined): boolean {
    if (boundary === undefined) return false
    return endsAfterQuietTime(start, durationMinutes, boundary)
}

async function nextDateForSpecificClockTime(time: string, config: AlertpilotConfig, now: Date, options: { allowedDays: "work" | "rest" | "any" }, priorityOverride = false): Promise<DateDecision> {
    const durationMinutes = Math.max(0, Number(config.userPreferences?.generalTaskDurationMinutes || 30))
    let deferredForQuietTime = false
    const hhmm = toHHmm(time)

    for (let offset = 0; offset < 30; offset += 1) {
        const day = new Date(now)
        day.setDate(now.getDate() + offset)
        day.setHours(0, 0, 0, 0)
        const isRestDay = await isRestDate(day)
        if (options.allowedDays === "work" && isRestDay) continue
        if (options.allowedDays === "rest" && !isRestDay) continue

        const candidate = dateAtHHmm(day, hhmm)
        if (offset === 0 && candidate.getTime() <= now.getTime()) continue

        const boundary = options.allowedDays === "work"
            ? undefined
            : (!isRestDay ? Number(toHHmm(config.userPreferences?.quietAfter || "2200")) : undefined)

        if (!priorityOverride && typeof boundary === "number" && endsAfterQuietTime(candidate, durationMinutes, boundary)) {
            deferredForQuietTime = true
            continue
        }

        return { date: candidate, deferredForQuietTime }
    }

    const fallback = new Date(now)
    fallback.setDate(now.getDate() + 1)
    fallback.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4)), 0, 0)
    return { date: fallback, deferredForQuietTime }
}

function sortedTimeCompletions(config: AlertpilotConfig): Array<{ startHHmm: number; entry: TimeCompletionEntry }> {
    const completions = config["时间补全"] || {}
    return Object.keys(completions)
        .map(key => ({ startHHmm: Number(String(key).replace(/\D/g, "") || 0), entry: completions[key] as TimeCompletionEntry }))
        .sort((a, b) => a.startHHmm - b.startHHmm)
}

function completionCandidateDate(day: Date, completion: { startHHmm: number; entry: TimeCompletionEntry }, config: AlertpilotConfig): Date | undefined {
    const raw = completion.entry?.[0] || ""
    const hhmm = /^\d{3,4}$/.test(raw)
        ? toHHmm(raw)
        : toHHmm(config["时间"]?.[raw] || getDefaultTime(config))
    if (!hhmm) return undefined
    return dateAtHHmm(day, hhmm)
}



function dateAtHHmm(day: Date, hhmm: string): Date {
    const next = new Date(day)
    next.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4)), 0, 0)
    return next
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date)
    next.setDate(next.getDate() + days)
    return next
}

function sameDay(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

function endsAfterQuietTime(start: Date, durationMinutes: number, quietAfter: number): boolean {
    const finish = new Date(start)
    finish.setMinutes(finish.getMinutes() + durationMinutes)
    if (finish.getFullYear() !== start.getFullYear() || finish.getMonth() !== start.getMonth() || finish.getDate() !== start.getDate()) return true
    return nowHHmmNumber(finish) > quietAfter
}

async function nextTaskWindowStartAfterBoundary(input: AlertpilotInput, start: Date, end: Date, config: AlertpilotConfig, priorityOverride = false): Promise<Date | null> {
    if (priorityOverride) return null

    const slot = (input as any).smartScheduleDecision?.slot
    if (slot === "work") return await nextWorkWindowStartAfterBoundary(start, end, config)
    if (slot === "restTime") return await nextRestTimeWindowStartAfterBoundary(start, end, config)
    return null
}

async function nextWorkWindowStartAfterBoundary(start: Date, end: Date, config: AlertpilotConfig): Promise<Date | null> {
    const workStart = toHHmm(config.userPreferences?.workStart || "0830")
    const workEnd = Number(toHHmm(config.userPreferences?.workEnd || "1730"))
    const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))

    if (!endsAfterQuietBoundary(start, end, workEnd)) return null

    for (let offset = 1; offset <= 30; offset += 1) {
        const next = new Date(start)
        next.setDate(start.getDate() + offset)
        if (await isRestDate(next)) continue
        setTimeFromHHmm(next, workStart)
        if (!endsAfterQuietTime(next, durationMinutes, workEnd)) return next
    }

    return null
}

async function nextRestTimeWindowStartAfterBoundary(start: Date, end: Date, config: AlertpilotConfig): Promise<Date | null> {
    if (await isRestDate(start)) return null

    const quietAfter = Number(toHHmm(config.userPreferences?.quietAfter || "2200"))
    if (!endsAfterQuietBoundary(start, end, quietAfter)) return null

    const dailyTaskStart = toHHmm(config.userPreferences?.dailyTaskStart || "2000")
    for (let offset = 1; offset <= 30; offset += 1) {
        const next = new Date(start)
        next.setDate(start.getDate() + offset)
        if (await isRestDate(next)) {
            next.setHours(0, 0, 0, 0)
            return next
        }
        setTimeFromHHmm(next, dailyTaskStart)
        const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
        if (!endsAfterQuietTime(next, durationMinutes, quietAfter)) return next
    }

    return null
}

function endsAfterQuietBoundary(start: Date, end: Date, quietAfter: number): boolean {
    if (end.getFullYear() !== start.getFullYear() || end.getMonth() !== start.getMonth() || end.getDate() !== start.getDate()) return true
    return nowHHmmNumber(end) > quietAfter
}

function setTimeFromHHmm(date: Date, hhmm: string) {
    date.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4)), 0, 0)
}

function inferSlotFromInput(input: AlertpilotInput, config: AlertpilotConfig): TimeSlot | undefined {
    if (input.isLatestRestDay) return "restDay"
    if (input.week && /[六日天]/.test(input.week)) return "restDay"
    if (input.daypart) {
        if (/早|上午/.test(input.daypart)) return "morning"
        if (/上班|下午|中午/.test(input.daypart)) return "work"
        if (/晚|下班|夜/.test(input.daypart)) return "restTime"
    }

    const time = input.rawTime || input.time || ""
    const n = Number(time.replace(/\D/g, "").padStart(4, "0"))
    if (!n) return undefined
    if (n < 1200) return "morning"
    if (n >= Number(toHHmm(config.userPreferences?.quietAfter || "2200"))) return "restTime"
    if (n >= Number(toHHmm(config.userPreferences?.dailyTaskStart || "2000"))) return "restTime"
    if (n >= Number(toHHmm(config.userPreferences?.workStart || "0830")) && n <= Number(toHHmm(config.userPreferences?.workEnd || "1730"))) return "work"
    return "any"
}

function categoryDisplayName(category: TaskCategory, config?: AlertpilotConfig): string {
    const builtInNames: Record<string, string> = {
        work: "工作",
        shopping: config?.userPreferences?.simpleTaskNames?.shopping || "购物/下单",
        housework: config?.userPreferences?.simpleTaskNames?.housework || "家务/整理",
        study: config?.userPreferences?.simpleTaskNames?.study || "学习/阅读",
        health: config?.userPreferences?.simpleTaskNames?.health || "健康/运动",
        relationship: "亲友沟通",
        finance: "财务/缴费",
        leisure: "休闲",
        general: "普通"
    }
    const configuredTask = configuredSimpleTaskFromCategory(category, config)
    if (configuredTask) return configuredTask.title
    return builtInNames[category] || category
}

function reasonFor(category: TaskCategory, slot: TimeSlot, learned: boolean, deferredForQuietTime = false, config?: AlertpilotConfig): string {
    const deferredReason = deferredForQuietTime ? "；因预计完成会超过停止处理事项时间，已顺延到下一次合适时间" : ""
    const categoryName = categoryDisplayName(category, config)
    if (learned) return `根据你过去对“${categoryName}”类事项的显式时间选择，优先安排到 ${slot}${deferredReason}`
    const slotName: Record<TimeSlot, string> = {
        morning: "上午",
        work: "工作时间",
        restTime: "休息时间",
        restDay: "休息日",
        any: "任何时间"
    }
    return `${categoryName}类事项默认更适合安排在${slotName[slot]}${deferredReason}`
}

function hasPriority(input: AlertpilotInput): boolean {
    const priority = String(input.priority || "").toLowerCase()
    if (priority && priority !== "none") return true
    const text = `${input.ai?.rawText || ""} ${input.ai?.text || ""} ${input.shortcutInput?.rawText || ""}`
    return /(?<!-)[!！]{1,3}/.test(text)
}

function durationForTask(input: AlertpilotInput, config: AlertpilotConfig): number {
    const text = `${input.ai?.rawText || ""} ${input.ai?.text || ""} ${input.shortcutInput?.rawText || ""} ${input.finalText || ""}`
    if (isImportantTask(text, input.priority)) {
        return roundDuration(config.userPreferences?.importantTaskDurationMinutes || 60)
    }

    return roundDuration(config.userPreferences?.generalTaskDurationMinutes || 30)
}

function durationForReminder(title: string, calendarTitle: string, priority: number, config: AlertpilotConfig): number {
    const text = `${title} ${calendarTitle}`
    if (isImportantTask(text, priority)) {
        return roundDuration(config.userPreferences?.importantTaskDurationMinutes || 60)
    }

    return roundDuration(config.userPreferences?.generalTaskDurationMinutes || 30)
}

function isImportantTask(text: string, priority?: string | number): boolean {
    return normalizeReminderPriority(priority) >= 2 || /重要|紧急|优先|必须|务必|尽快|马上|立刻|!|！/.test(text)
}

function priorityValueForInput(input: AlertpilotInput): number {
    const priority = String(input.priority || "").toLowerCase()
    if (priority === "high") return 3
    if (priority === "medium") return 2
    if (priority === "low") return 1

    const text = `${input.ai?.rawText || ""} ${input.ai?.text || ""} ${input.shortcutInput?.rawText || ""} ${input.finalText || ""}`
    const marker = text.match(/(?<!-)[!！]{1,3}/)?.[0] || ""
    return Math.min(3, marker.length)
}

function priorityValueForReminder(window: ScheduledReminderWindow): number {
    return normalizeReminderPriority(window.priority)
}

function normalizeReminderPriority(priority: string | number | undefined): number {
    const value = String(priority || "").toLowerCase()
    if (value === "high") return 3
    if (value === "medium") return 2
    if (value === "low") return 1

    const numeric = Number(priority || 0)
    if (numeric <= 0) return 0

    // iOS/EventKit Reminder priority uses 1 = High, 5 = Medium, 9 = Low.
    // Some callers may still pass 1/2/3, so handle both ranges conservatively.
    if (numeric === 1) return 3
    if (numeric === 2 || numeric === 5) return 2
    if (numeric === 3 || numeric >= 9) return 1
    return 1
}

function isUrgentTask(input: AlertpilotInput): boolean {
    return priorityValueForInput(input) > 0
}

function roundDuration(value: number): number {
    return Math.max(10, Math.ceil(Number(value || 0) / 10) * 10)
}

function rangesOverlap(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
    return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime()
}

function sameMinute(a: Date, b: Date): boolean {
    return Math.abs(a.getTime() - b.getTime()) < 60 * 1000
}

function addMinutes(date: Date, minutes: number): Date {
    const next = new Date(date)
    next.setMinutes(next.getMinutes() + minutes)
    return next
}

function startOfDay(date: Date): Date {
    const next = new Date(date)
    next.setHours(0, 0, 0, 0)
    return next
}

function endOfDay(date: Date): Date {
    const next = new Date(date)
    next.setHours(23, 59, 59, 999)
    return next
}

function formatScheduledDate(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function toHHmm(value: string): string {
    const digits = String(value || "").replace(/\D/g, "").padStart(4, "0").slice(-4)
    return `${digits.slice(0, 2)}${digits.slice(2, 4)}`
}

function nowHHmmNumber(date: Date): number {
    return Number(`${pad2(date.getHours())}${pad2(date.getMinutes())}`)
}

function addMinutesToHHmm(hhmm: number, minutes: number): number {
    const hours = Math.floor(hhmm / 100)
    const mins = hhmm % 100
    const totalMinutes = hours * 60 + mins + minutes
    const newHours = Math.floor(totalMinutes / 60) % 24
    const newMins = totalMinutes % 60
    return newHours * 100 + newMins
}

function pad4(n: number): string {
    return String(n).padStart(4, '0')
}

function formatDateKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

async function isRestDate(date: Date): Promise<boolean> {
    try {
        return (await getRestDayInfo(formatDateKey(date))).isRestDay
    } catch {
        const day = date.getDay()
        return day === 0 || day === 6
    }
}
