export type LanguagePack = {
    url: string
    list: string
    note: string
    PR: string
}

export function pad2(n: number): string {
    return String(n).padStart(2, "0")
}

export function formatDateKey(date = new Date()): string {
    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate())
    ].join("-")
}

export function formatDateTime(date = new Date()): string {
    return `${formatDateKey(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export function getErrorDetail(error: unknown): string {
    return error instanceof Error ? error.stack || error.message : String(error)
}

export function nowHHmm(date = new Date()): number {
    return Number(`${date.getHours()}${pad2(date.getMinutes())}`)
}

export function chineseToNumber(str = ""): number {
    const chnNumChar: Record<string, number> = {
        零: 0,
        一: 1,
        二: 2,
        两: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9
    }

    const chnNameValue: Record<string, number> = {
        十: 10
    }

    let section = 0
    let number = 1

    for (let i = 0; i < str.length; i++) {
        const char = str.charAt(i)
        const num = chnNumChar[char]

        if (typeof num !== "undefined") {
            number = num
            if (i === str.length - 1) {
                section += number
            }
        } else {
            const unit = chnNameValue[char]
            if (unit) {
                section += number * unit
                number = 0
            }
        }
    }

    return section
}

export function stripDecorators(text = ""): string {
    return text.replace(/[-#:：]/gm, "")
}

export function languagePack(): LanguagePack {
    const lang = typeof Device !== "undefined" ? Device.systemLanguageCode : "zh"
    const settings: Record<string, LanguagePack> = {
        zh: { url: "链接", list: "列表", note: "备注", PR: "主提醒" },
        en: { url: "URL", list: "List", note: "Note", PR: "PR" }
    }

    return settings[lang] || settings.zh
}

export function safeJsonParse<T>(value: unknown, fallback: T): T {
    if (typeof value === "object" && value !== null) return value as T
    if (typeof value !== "string") return fallback

    try {
        return JSON.parse(value) as T
    } catch {
        return fallback
    }
}
