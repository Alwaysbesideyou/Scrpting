import type { AlertpilotInput, AlertpilotOutput, AlertpilotConfig } from "./types"

import type { Logger } from "./notifier"
import { getDefaultReminderList } from "./config"

const LOOKBEHIND = "(?<!-)"
const priorityList: Record<number, string> = {
    0: "None",
    1: "Low",
    2: "Medium",
    3: "High"
}

export function parseInput(
    input: AlertpilotInput,
    output: AlertpilotOutput,
    config: AlertpilotConfig,
    logger?: Logger
) {
    let text = input.ai?.rawText || input.shortcutInput?.rawText || ""
    const originalText = text
    const restDayKeyword = /(休息日|休息|放假|假日|off\s*day)/i

    // 检测是否是快捷指令分享（包含 webTitle 或 inputUrl）
    const isShortcutShare = Boolean(input.shortcutInput?.webTitle || input.shortcutInput?.inputUrl)

    const matchText = (re: RegExp, source = text) => {
        const m = source.match(re)
        return m ? m[0].trim() : ""
    }

    const removeMatchedText = (matchedText?: string) => {
        if (matchedText) {
            text = text.replace(matchedText, " ")
        }
    }

    // ── 基础解析（总是执行）───────────────────────────────
    input.url =
        input.ai?.url ||
        input.shortcutInput?.inputUrl ||
        matchText(/(^https?:\/\/.+$)/m)
    removeMatchedText(input.url)

    input.note =
        input.ai?.note ||
        (input.shortcutInput?.webTitle && input.shortcutInput?.inputUrl ? input.shortcutInput.webTitle : "") ||
        matchText(/(?:\n)(.+$)/sm).replace(input.url || "", "")
    removeMatchedText(input.note)

    input.misMatch = matchText(/(?<=[\(（]).+?(?=[\)）])/)
    removeMatchedText(input.misMatch)

    input.parentReminder = matchText(/@(.+($|&))/m)
    input.classReminders = matchText(/(^.+)(?=[:：]{2})/m)
    input.location = matchText(new RegExp(`${LOOKBEHIND}((实验|寝)室|家)`, "m"))

    // 标签解析（总是执行）
    input.tag =
        input.ai?.url || input.shortcutInput?.inputUrl
            ? "📖Reading"
            : matchText(new RegExp(`${LOOKBEHIND}#(.+)#`, "m"))

    input.finalText = input.ai?.text || ""

    // ── 时间相关解析 ───────────────────────────────────────
    // 快捷指令分享时跳过：webTitle 可能包含时间关键字（如"明天下午3点"）会被误判为提醒时间
    if (!isShortcutShare) {
        const rawTimeText = input.ai?.timeWord || text
        // 将 AI 返回的 ISO 日期格式（如 2026-06-13）转换为自然语言格式（2026年6月13日），
        // 以便后续正则匹配。仅转换看起来像完整日期的模式，避免误伤其他文本。
        const timeText = rawTimeText.replace(
            /(\d{4})-(\d{1,2})-(\d{1,2})/g,
            (_, y: string, m: string, d: string) => `${y}年${Number(m)}月${Number(d)}日`
        )

        input.festival = text.match(new RegExp(`${LOOKBEHIND}(.{2}节|春节|元旦)`, "m"))?.[0] || ""
        const restKeywordMatched = restDayKeyword.test(timeText)
        input.isLatestRestDay = restKeywordMatched
        logger?.log({
            message: "输入解析完成",
            sourceText: originalText,
            timeText,
            matched: {
                url: input.url,
                note: input.note,
                classReminders: input.classReminders || input.ai?.classReminders || getDefaultReminderList(config),
                location: input.location,
                tag: input.tag,
                festival: input.festival,
                restMode: input.isLatestRestDay,
                restReason: restKeywordMatched ? "文本包含休息关键词" : "未命中"
            }
        })

        if (input.isLatestRestDay) {
            input.month = ""
            input.week = ""
            input.otherTime = ""
        } else {
            input.month = matchText(
                new RegExp(
                    `${LOOKBEHIND}((([一二两三四五六七八九十]{2,4}|(20)?\\d{2})[年\\./])?([一二两三四五六七八九十]{1,2}|[01]?\\d)?[月\\./]([一二两三四五六七八九十]{1,3}|[0-3]?\\d)[日号]?|([一二两三四五六七八九十]{1,3}|[0-3]?\\d)[日号])`,
                    "m"
                ),
                timeText
            )

            input.week = matchText(new RegExp(`${LOOKBEHIND}((周|星期)[一二三四五六七日天])`, "m"), timeText)

            input.otherTime = matchText(
                new RegExp(
                    `${LOOKBEHIND}(大*[今昨明后]天|(?:[\\+加下])?((\\d+)|([一二两三四五六七八九十]+))个?(分钟|小时|天|周|星期|月|年)后?|下+个?(分钟|小时|天|周|星期|月|年)|[下两]星期|等[下会])`,
                    "m"
                ),
                timeText
            )
        }

        const timeSearchText = input.month ? timeText.replace(input.month, " ") : timeText

        input.rawTime = matchText(
            /(?<!\d)((?:[01]?\d|2[0-3]):?[0-5]\d(?![\d年月日号\.\/-])|([上下]午|晚上)?[一二两三四五六七八九十]{1,3}[点时]([一二两三四五六七八九十]{1,3}分?)?)/m,
            timeSearchText
        )

        input.daypart = matchText(
            new RegExp(`${LOOKBEHIND}([上中下][班午]|[早中晚][上饭餐]|现在)`, "m"),
            timeText
        )

        const priority = matchText(new RegExp(`${LOOKBEHIND}[\\!！]{1,3}`, "m"))
        input.priority = priority ? priorityList[priority.length] : ""
    } else {
        // 快捷指令分享时，跳过时间解析，设置默认值
        input.festival = ""
        input.isLatestRestDay = false
        input.month = ""
        input.week = ""
        input.otherTime = ""
        input.rawTime = ""
        input.daypart = ""
        input.priority = ""
        logger?.log({
            message: "快捷指令分享输入，跳过时间解析",
            sourceText: originalText,
            matched: {
                url: input.url,
                note: input.note,
                classReminders: input.classReminders || input.ai?.classReminders || getDefaultReminderList(config),
                location: input.location,
                tag: input.tag
            }
        })
    }

    // ── 写入输出 ───────────────────────────────────────────
    output.url = input.url
    output.note = input.note
    output.priority = input.priority
    output.classReminders =
        input.classReminders ||
        input.ai?.classReminders ||
        getDefaultReminderList(config)

    logger?.log({
        message: "解析字段写入完成",
        dateParts: {
            month: input.month,
            week: input.week,
            otherTime: input.otherTime,
            rawTime: input.rawTime,
            daypart: input.daypart,
            priority: input.priority
        },
        output: {
            url: output.url,
            note: output.note,
            priority: output.priority,
            classReminders: output.classReminders
        }
    })
}
