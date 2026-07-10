import type { AlertpilotInput, AlertpilotConfig } from "./types"
import { getDefaultLocation, getDefaultTime, getDefaultWorkdayTime, getDefaultRestDayTime } from "./config"
// @ts-ignore Scripting can import from sibling script directories at runtime.
import type { HolidayCalendarSource } from "../../Off day/types"
import { chineseToNumber, nowHHmm, pad2 } from "./utils"
import type { Logger } from "./notifier"
// @ts-ignore Scripting can import from sibling script directories at runtime.
import { getRestDayInfo, getLatestRestDayInfo } from "../../Off day/utils/is_rest_day"
// @ts-ignore Scripting can import from sibling script directories at runtime.
import { loadCustomAlarmState } from "../../Off day/utils/storage"

export async function resolveDateTime(
    input: AlertpilotInput,
    config: AlertpilotConfig,
    logger: Logger,
    now = new Date()
) {
    const dateSet = new Date(now)
    const currentTime = nowHHmm(now)
    const hasExplicitTime = Boolean(input.rawTime || input.daypart)
    const smartScheduleDecision = (input as any).smartScheduleDecision

    function adaptiveTime(timeFunc: string) {
        if (!input.otherTime && !input.month && !input.week && currentTime >= Number(timeFunc)) {
            input.otherTime = "明天"
            logger.log({
                message: "自适应时间：指定时间已过，日期顺延到明天",
                currentTime,
                targetTime: timeFunc,
                otherTime: input.otherTime
            })
        }
    }

    function findMatchingTime(targetTime: number | string) {
        const timeCom = config["时间补全"]
        const keys = Object.keys(timeCom).sort((a, b) => Number(b) - Number(a))
        const key = keys.find(k => Number(targetTime) >= Number(k))
        return key ? timeCom[key] : undefined
    }

    function timeCompletion(timeFunc?: string, forceChangeLocation = false) {
        if (!timeFunc) {
            const arr = findMatchingTime(currentTime)

            if (/\d{3,4}/.test(arr?.[0] || "")) {
                input.time = arr?.[0] || getDefaultTime(config)
            } else {
                input.time = config["时间"][arr?.[0] || ""] || getDefaultTime(config)
            }

            input.location = arr?.[1] || findLocationKeyByValue(config, getDefaultLocation(config)) || ""

            input.otherTime = arr?.[2] || ""

            logger.log({
                message: "未提供明确时间，按当前时间段补全",
                currentTime,
                matchedCompletion: arr,
                result: {
                    time: input.time,
                    location: input.location,
                    otherTime: input.otherTime
                }
            })
        } else if (forceChangeLocation || !input.location) {
            logger.log({
                message: "已提供时间，按时间补全地点",
                time: timeFunc
            })
            const arr = findMatchingTime(timeFunc)
            input.location = arr?.[1] || findLocationKeyByValue(config, getDefaultLocation(config)) || ""

        }
    }

    if (input.festival && !input.month && !input.week && !input.otherTime) {
        const festivalDateKey = await findNextFestivalDateKey(input.festival, now)
        if (festivalDateKey) {
            const [year, month, day] = festivalDateKey.split("-")
            input.month = `${year}年${Number(month)}月${Number(day)}日`
            logger.log({
                message: "节假日日期已提前匹配",
                festival: input.festival,
                dateKey: festivalDateKey,
                month: input.month
            })
        } else {
            logger.log({
                message: "未在已同步节假日日历中找到匹配日期",
                festival: input.festival
            })
        }
    }

    if (input.isLatestRestDay) {
        const restDayTime = getDefaultRestDayTime(config)
        logger.debug("TRANSFORM", "休息模式启用：查找最近休息日", {
            reason: "文本包含休息关键词",
            defaultTime: restDayTime
        })
        input.time = restDayTime
    } else if (input.rawTime) {
        const zhTime = input.rawTime.match(/([上下]午|晚上)?([一二两三四五六七八九十]{1,3})[点时](([一二两三四五六七八九十]{1,3})分?)?/)

        if (zhTime) {
            const offset = zhTime[1] === "下午" || zhTime[1] === "晚上" ? 12 : 0
            const hour = chineseToNumber(zhTime[2]) + offset
            const minute = chineseToNumber(zhTime[4] || "")
            input.time = `${pad2(hour)}${pad2(minute)}`
        } else {
            input.time = input.rawTime.replace(/:/g, "")
        }

        adaptiveTime(input.time)
    } else if (input.daypart) {
        input.time = config["时间"][input.daypart]
        adaptiveTime(input.time)
    } else if (input.otherTime || input.month || input.week) {
        input.time = getDefaultTime(config)
    } else {
        input.time = ""
    }

    if (input.location && !input.time) {
        logger.log({
            message: "按地点补全时间",
            location: input.location
        })
        const [daypartComs, locComs] = config["自动补全"]
        const idx = locComs.findIndex(loc => input.location === loc)

        if (idx >= 0) {
            input.time = config["时间"][daypartComs[idx]]
            adaptiveTime(input.time)
        } else {
            timeCompletion()
        }
    } else if (smartScheduleDecision) {
        logger.log({
            message: "已存在智能调度结果，跳过通用时间补全，仅按时间补全地点",
            slot: smartScheduleDecision.slot,
            time: input.time || "未提供"
        })
        timeCompletion(input.time, true)
    } else {
        logger.log({
            message: "执行时间补全",
            time: input.time || "未提供"
        })
        timeCompletion(input.time)
    }

    if (input.month) {
        if (/^.+(?=[月\./])/.test(input.month)) {
            logger.log({
                message: "识别到明确日期，直接设置月日并清空周次",
                month: input.month
            })

            const m = input.month.match(/(([一二两三四五六七八九十]{2,4}|(20)?\d{2})[年\./])?([一二两三四五六七八九十]{1,2}|[01]?\d)?[月\./]([一二两三四五六七八九十]{1,3}|[0-3]?\d)[日号]?/)
            if (m) {
                input.month = m[2] ? `${m[2]}年${m[4]}月${m[5]}日` : `${m[4]}月${m[5]}日`
            }
        } else {
            logger.log({
                message: "仅识别到日期，推断最近月份并清空周次",
                month: input.month
            })
            const numeric = input.month.match(/\d+/)?.[0]
            const chinese = input.month.match(/[一二两三四五六七八九十]{1,3}/)?.[0]
            const dateNum = numeric ? Number(numeric) : chineseToNumber(chinese || "")

            dateSet.setMonth(dateSet.getMonth() + (dateNum > dateSet.getDate() ? 0 : 1))
            input.month = `${dateSet.getMonth() + 1}月${dateNum}日`
        }

        input.week = ""
    } else if (input.week) {
        logger.log({
            message: "识别到周次，清空月份",
            week: input.week
        })
        input.month = ""
    } else if (input.otherTime) {
        logger.log({
            message: "识别到附加时间",
            otherTime: input.otherTime
        })

        const waitMatch = /^(等)[下会]$/.exec(input.otherTime)
        const relativeMatch = input.otherTime.match(
            /^(?<operator>[\+加]|下+)?(?:(?<digits>\d+)|(?<zhDigits>[一二两三四五六七八九十]+))?(?:个|一个)?(?<unit>分钟|小时|天|周|星期|月|年)(?:后)?$/
        )

        if (waitMatch || relativeMatch) {
            const groups = (relativeMatch?.groups || {}) as {
                operator?: string
                digits?: string
                zhDigits?: string
                unit?: string
            }

            const operator = groups.operator || ""
            const isNextRelative = operator.startsWith("下")

            const addNumber = waitMatch
                ? 30
                : groups.digits
                    ? Number(groups.digits)
                    : groups.zhDigits
                        ? chineseToNumber(groups.zhDigits)
                        : isNextRelative
                            ? operator.length
                            : 1

            const timeUnit = groups.unit || (waitMatch ? "等" : "")

            switch (timeUnit || input.otherTime) {
                case "等":
                case "分钟":
                    dateSet.setMinutes(dateSet.getMinutes() + addNumber)
                    break
                case "小时":
                    dateSet.setHours(dateSet.getHours() + addNumber)
                    break
                case "天":
                    dateSet.setDate(dateSet.getDate() + addNumber)
                    break
                case "周":
                case "星期":
                    dateSet.setDate(dateSet.getDate() + addNumber * 7)
                    break
                case "月":
                    dateSet.setMonth(dateSet.getMonth() + addNumber)
                    break
                case "年":
                    dateSet.setFullYear(dateSet.getFullYear() + addNumber)
                    break
            }

            if (/分钟|小时|等/.test(timeUnit || "")) {
                input.time = `${dateSet.getHours()}${pad2(dateSet.getMinutes())}`
                timeCompletion(input.time, true)
            }

            input.month = `${dateSet.getMonth() + 1}月${dateSet.getDate()}日`
        } else {
            input.month = input.otherTime === "明天" && currentTime <= 300 ? "" : input.otherTime
        }

        input.week = ""
    } else {
        logger.log({
            message: "没有日期/周次/附加时间，使用今天",
            month: `${dateSet.getMonth() + 1}月${dateSet.getDate()}日`
        })
        input.month = `${dateSet.getMonth() + 1}月${dateSet.getDate()}日`
        input.week = ""
    }

    // ── 日期确定后，检查任务分类时间是否适用于指定日期 ──
    // 当智能调度提供了时间（基于任务分类），需要检查该时间槽是否适用于指定日期
    if (smartScheduleDecision && !hasExplicitTime) {
        const tempDate = buildFinalDate(input, config, now)
        const dayInfo = await getRestDayInfo(formatDateKey(tempDate))
        const slot = smartScheduleDecision.slot
        const isRestDay = dayInfo.isRestDay

        // 检查时间槽是否适用于该日期
        // work/morning → 只适用于工作日
        // restDay → 只适用于休息日
        // restTime/any → 适用于任何日期
        const slotApplies =
            (slot === "morning" && !isRestDay) ||
            (slot === "work" && !isRestDay) ||
            (slot === "restDay" && isRestDay) ||
            slot === "restTime" ||
            slot === "any"

        if (!slotApplies) {
            // 任务分类的时间在指定日期不适用，改用日期默认时间
            input.time = isRestDay
                ? getDefaultRestDayTime(config)
                : getDefaultWorkdayTime(config)
            logger.log({
                message: "任务分类时间在指定日期不适用，改用日期默认时间",
                category: smartScheduleDecision.category,
                slot,
                dateKey: dayInfo.dateKey,
                isRestDay,
                defaultTime: input.time,
                source: dayInfo.source
            })
        } else {
            logger.log({
                message: "任务分类时间适用于指定日期",
                category: smartScheduleDecision.category,
                slot,
                dateKey: dayInfo.dateKey,
                isRestDay,
                time: input.time,
                source: dayInfo.source
            })
        }
    }

    // ── 当用户指定了日期但没指定具体时间且无智能调度时，根据日期类型选择默认时间 ──
    if (!hasExplicitTime && !smartScheduleDecision) {
        const tempDate = buildFinalDate(input, config, now)
        const dayInfo = await getRestDayInfo(formatDateKey(tempDate))
        const defaultTimeForDay = dayInfo.isRestDay
            ? getDefaultRestDayTime(config)
            : getDefaultWorkdayTime(config)
        input.time = defaultTimeForDay
        logger.log({
            message: "根据日期类型选择默认时间",
            dateKey: dayInfo.dateKey,
            isRestDay: dayInfo.isRestDay,
            defaultTime: defaultTimeForDay,
            source: dayInfo.source
        })
    }

    if (input.festival && !hasExplicitTime && input.month && input.month !== `${now.getMonth() + 1}月${now.getDate()}日`) {
        // 节假日也根据当天是否休息日选择默认时间
        const festivalDate = buildFinalDate(input, config, now)
        const festivalDayInfo = await getRestDayInfo(formatDateKey(festivalDate))
        input.time = festivalDayInfo.isRestDay
            ? getDefaultRestDayTime(config)
            : getDefaultWorkdayTime(config)
        logger.log({
            message: "节假日未提供明确时间，根据日期类型选择默认时间",
            festival: input.festival,
            month: input.month,
            isRestDay: festivalDayInfo.isRestDay,
            time: input.time
        })
    }

    if (input.isLatestRestDay) {
        const restInfo = await getLatestRestDayInfo({
            baseDate: formatDateKey(now),
            lookbackDays: 30
        })
        input.finalDate = buildFinalDate(input, config, now)
        applyDateKey(input.finalDate, restInfo.dateKey)
        input.time = formatFinalDate(input.finalDate)
        input.location = findLocationKeyByValue(config, config.restLocation || getDefaultLocation(config)) || ""
        logger.log({
            message: "最近休息日提醒已应用",
            dateKey: restInfo.dateKey,
            baseDateKey: restInfo.baseDateKey,
            daysUntil: restInfo.daysUntil,
            source: restInfo.source,
            time: input.time
        })
        return
    }

    input.finalDate = buildFinalDate(input, config, now)
    const restInfo = await getRestDayInfo(formatDateKey(input.finalDate))
    if (restInfo.isRestDay) {
        input.location = findLocationKeyByValue(config, config.restLocation || getDefaultLocation(config)) || ""
        logger.log({
            message: "休息日地点已应用：最终日期为休息日",
            location: input.location,
            dateKey: restInfo.dateKey,
            source: restInfo.source
        })
    } else {
        logger.log({
            message: "非休息日：保持解析/补全得到的地点",
            dateKey: restInfo.dateKey,
            source: restInfo.source
        })
    }
    input.time = formatFinalDate(input.finalDate)
}

async function findNextFestivalDateKey(festival: string, now: Date): Promise<string | undefined> {
    const keyword = normalizeFestivalKeyword(festival)
    if (!keyword) return undefined

    try {
        const state = await loadCustomAlarmState()
        const nowKey = formatDateKey(now)
        const items = state.holidaySources
            .flatMap((source: HolidayCalendarSource) => source.holidayItems || [])
            .filter((item: HolidayCalendarSource["holidayItems"][number]) => item.kind === "off")
            .filter((item: HolidayCalendarSource["holidayItems"][number]) => item.dateKey >= nowKey)
            .filter((item: HolidayCalendarSource["holidayItems"][number]) => normalizeFestivalKeyword(item.title).includes(keyword))
            .sort((a: HolidayCalendarSource["holidayItems"][number], b: HolidayCalendarSource["holidayItems"][number]) => a.dateKey.localeCompare(b.dateKey))

        return items[0]?.dateKey
    } catch {
        return undefined
    }
}

function normalizeFestivalKeyword(text: string): string {
    return String(text || "")
        .replace(/放假|休假|休息|假期|快乐|节/g, "")
        .trim()
}

function formatDateKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function findLocationKeyByValue(config: AlertpilotConfig, value?: string): string | undefined {
    if (!value) return undefined
    return Object.entries(config["地点"] || {}).find(([, locationValue]) => locationValue === value)?.[0]
}

function formatFinalDate(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function applyDateKey(date: Date, dateKey: string) {
    const [year, month, day] = dateKey.split("-").map(Number)
    date.setFullYear(year, month - 1, day)
}

function buildFinalDate(input: AlertpilotInput, config: AlertpilotConfig, now: Date): Date {
    const date = new Date(now)
    const timeText = (input.time || "").replace(/\D/g, "").padStart(4, "0")
    const hour = Number(timeText.slice(0, 2)) || 0
    const minute = Number(timeText.slice(2, 4)) || 0

    date.setHours(hour, minute, 0, 0)
    applyDatePart(date, input, config, now)

    return date
}

function applyDatePart(date: Date, input: AlertpilotInput, config: AlertpilotConfig, now: Date) {
    const relativeDay = getAdditionalDayOffset(input.month || input.otherTime || "", config)
    if (typeof relativeDay === "number") {
        date.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
        date.setDate(date.getDate() + relativeDay)
        return
    }

    if (input.month) {
        applyMonthDay(date, input.month, now)
        return
    }

    if (input.week) {
        const offset = parseWeekOffset(input.week, now)
        if (typeof offset === "number") {
            date.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
            date.setDate(date.getDate() + offset)
        }
    }
}

function applyMonthDay(date: Date, monthText: string, now: Date) {
    const m = monthText.match(/(?:(\d{2,4}|[一二两三四五六七八九十]{2,4})年)?(\d{1,2}|[一二两三四五六七八九十]{1,2})月(\d{1,2}|[一二两三四五六七八九十]{1,3})日/)
    if (!m) return

    const year = m[1] ? normalizeYear(parseNumberLike(m[1])) : now.getFullYear()
    const month = parseNumberLike(m[2])
    const day = parseNumberLike(m[3])
    date.setFullYear(year, month - 1, day)

    if (!m[1] && date.getTime() < now.getTime()) {
        date.setFullYear(date.getFullYear() + 1)
    }
}

function normalizeYear(year: number): number {
    if (year < 100) return 2000 + year
    return year
}

function parseNumberLike(text: string): number {
    const numeric = text.match(/\d+/)?.[0]
    return numeric ? Number(numeric) : chineseToNumber(text)
}

function getAdditionalDayOffset(text: string, config: AlertpilotConfig): number | undefined {
    if (!text) return undefined

    const additionalTime = config["附加时间"] || {}
    if (additionalTime[text] !== undefined) return Number(additionalTime[text])

    const repeatedLaterDay = text.match(/^(大*)后天$/)
    if (repeatedLaterDay) {
        const base = Number(additionalTime["后天"] ?? 2)
        return base + repeatedLaterDay[1].length
    }

    const repeatedBeforeDay = text.match(/^(大*)前天$/)
    if (repeatedBeforeDay) {
        const base = Number(additionalTime["前天"] ?? -2)
        return base - repeatedBeforeDay[1].length
    }

    return undefined
}

function parseWeekOffset(weekText: string, now: Date): number | undefined {
    const weekMap: Record<string, number> = {
        日: 0,
        天: 0,
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6
    }
    const weekChar = weekText.match(/[日天一二三四五六]/)?.[0]
    if (!weekChar) return undefined

    const target = weekMap[weekChar]
    const current = now.getDay()
    let offset = target - current
    if (offset <= 0) offset += 7
    return offset
}
