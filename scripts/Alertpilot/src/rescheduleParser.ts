export type RescheduleCommand = {
    reminderQuery: string
    targetTimeText: string
}

const commandPatterns = [
    /^(?:请)?把(?<query>.+?)(?:这个|那个)?提醒?(?:改到|改成|挪到|移到|推迟到|延到|顺延到)(?<time>.+)$/,
    /^(?:请)?提醒[“\"]?(?<query>.+?)[”\"]?(?:改到|改成|挪到|移到|推迟到|延到|顺延到)(?<time>.+)$/,
    /^(?:请)?把(?<query>.+?)(?:延后|推迟|顺延)(?<time>.+)$/
]

export function parseRescheduleCommand(rawText: string): RescheduleCommand | undefined {
    const text = String(rawText || "").trim()
    if (!text) return undefined

    for (const pattern of commandPatterns) {
        const match = text.match(pattern)
        const query = match?.groups?.query?.replace(/[“”"'‘’]/g, "").replace(/提醒事项|提醒/g, "").trim()
        const time = match?.groups?.time?.trim()
        if (query && time) {
            return {
                reminderQuery: query,
                targetTimeText: normalizeTimeText(time)
            }
        }
    }

    return undefined
}

function normalizeTimeText(value: string): string {
    return value
        .replace(/^到/, "")
        .replace(/^为/, "")
        .replace(/^一下/, "")
        .trim()
}
