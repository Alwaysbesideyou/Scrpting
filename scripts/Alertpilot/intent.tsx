import { Intent, Script } from "scripting"
import { runAlertpilotAction, resolveAlertpilotAction } from "./src/actionRouter"
import type { AlertpilotInput, LogLevel, ShortcutInput } from "./src/types"

const fallbackInput: AlertpilotInput = {
    action: "createReminder",
    shortcutInput: {
        rawText: "",
        inputUrl: "",
        webTitle: "",
        texts: [],
        urls: [],
        imageCount: 0,
        images: [],
        fileURLs: []
    },
    ai: {
        rawText: "",
        text: "",
        isSummary: false,
        classReminders: "",
        url: "",
        timeWord: "",
        note: ""
    }
}

const LOG_LEVELS: LogLevel[] = ["error", "warn", "info", "debug", "trace"]

function parseBooleanFlag(value: unknown): boolean | undefined {
    if (value === undefined || value === null || value === "") return undefined
    if (typeof value === "boolean") return value
    const text = String(value).trim().toLowerCase()
    if (["1", "true", "yes", "on"].includes(text)) return true
    if (["0", "false", "no", "off"].includes(text)) return false
    return undefined
}

function hasNoAiOption(value: Record<string, unknown> | undefined): boolean {
    if (!value) return false
    return parseBooleanFlag(value.noai) === true
}

function parseUseAiOption(value: Record<string, unknown> | undefined): boolean | undefined {
    if (!value) return undefined
    if (hasNoAiOption(value)) return false
    return parseBooleanFlag(value.useAI)
}

function parseLogLevel(value: unknown): LogLevel | undefined {
    const text = String(value ?? "").trim().toLowerCase() as LogLevel
    return LOG_LEVELS.includes(text) ? text : undefined
}

function toStringValue(value: unknown): string {
    if (value === undefined || value === null) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
}

function normalizeStrings(values: string[] | undefined): string[] {
    return (values || [])
        .map(value => String(value || "").trim())
        .filter(Boolean)
}

function parseJsonValue(value: unknown): unknown {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    if (!trimmed) return value

    try {
        return JSON.parse(trimmed)
    } catch {
        return value
    }
}

function firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
        const text = String(value ?? "").trim()
        if (text) return text
    }
    return ""
}

function buildShortcutInputFromIntent(): ShortcutInput {
    const shortcutParameter = Intent.shortcutParameter
    const parameterValue = parseJsonValue(shortcutParameter?.value)
    const maybeInput = parameterValue && typeof parameterValue === "object"
        ? parameterValue as Partial<AlertpilotInput> & Record<string, unknown>
        : undefined
    const maybeShortcutInput = maybeInput?.shortcutInput && typeof maybeInput.shortcutInput === "object"
        ? maybeInput.shortcutInput as ShortcutInput
        : undefined
    const texts = normalizeStrings(Intent.textsParameter)
    const urls = normalizeStrings(Intent.urlsParameter)
    const images = Intent.imagesParameter || []
    const shortcutParameterText = maybeShortcutInput?.rawText || maybeInput?.rawText || maybeInput?.text || maybeInput?.query || parameterValue
    const directShortcutParameter = maybeShortcutInput?.shortcutParameter && typeof maybeShortcutInput.shortcutParameter === "object"
        ? maybeShortcutInput.shortcutParameter
        : undefined

    return {
        ...(maybeShortcutInput || {}),
        rawText: firstNonEmptyString(maybeShortcutInput?.rawText, texts[0], shortcutParameterText),
        inputUrl: firstNonEmptyString(maybeShortcutInput?.inputUrl, urls[0], maybeInput?.inputUrl, maybeInput?.url),
        webTitle: firstNonEmptyString(maybeShortcutInput?.webTitle, maybeInput?.webTitle),
        texts: maybeShortcutInput?.texts || texts,
        urls: maybeShortcutInput?.urls || urls,
        imageCount: maybeShortcutInput?.imageCount ?? images.length,
        images: maybeShortcutInput?.images || images,
        fileURLs: maybeShortcutInput?.fileURLs || [],
        shortcutParameter: shortcutParameter
            ? {
                type: String(shortcutParameter.type),
                value: parameterValue
            }
            : directShortcutParameter
    }
}

function extractActionFromIntentValue(value: unknown): AlertpilotInput["action"] | undefined {
    const parameterValue = parseJsonValue(value)
    if (!parameterValue || typeof parameterValue !== "object") return undefined
    return resolveAlertpilotAction((parameterValue as Record<string, unknown>).action)
}

function buildInputFromIntent(): AlertpilotInput {
    const parameterValue = parseJsonValue(Intent.shortcutParameter?.value)
    const parameterAction = extractActionFromIntentValue(Intent.shortcutParameter?.value)
    
    // 检查是否是重排提醒的精简格式
    if (parameterAction === "rescheduleReminder" && parameterValue && typeof parameterValue === "object") {
        const maybeInput = parameterValue as Record<string, unknown>
        if (maybeInput.rawText && typeof maybeInput.rawText === "string") {
            // 重排提醒的精简格式：只需要rawText
            return {
                action: "rescheduleReminder",
                shortcutInput: {
                    rawText: maybeInput.rawText as string
                },
                ai: fallbackInput.ai,
                useAI: false,
                skipProfileMemory: true,
                skipProfileAnalysis: true,
                skipAutoMemory: true
            }
        }
    }
    
    if (parameterValue && typeof parameterValue === "object") {
        const maybeInput = parameterValue as Partial<AlertpilotInput>
        if (maybeInput.shortcutInput || maybeInput.ai) {
            const debug = parseBooleanFlag(maybeInput.debug) === true
            const shortcutUseAI = maybeInput.shortcutInput && typeof maybeInput.shortcutInput === "object"
                ? parseUseAiOption(maybeInput.shortcutInput as Record<string, unknown>)
                : undefined
            const useAI = parseUseAiOption(maybeInput as Record<string, unknown>) ?? shortcutUseAI
            const skipProfileAnalysis = debug || useAI === false || parseBooleanFlag(maybeInput.skipProfileAnalysis) === true || parseBooleanFlag(maybeInput.skipProfileMemory) === true
            const skipAutoMemory = debug || useAI === false || parseBooleanFlag(maybeInput.skipAutoMemory) === true || parseBooleanFlag(maybeInput.skipProfileMemory) === true
            return {
                action: parameterAction || "createReminder",
                shortcutInput: {
                    ...buildShortcutInputFromIntent(),
                    ...(maybeInput.shortcutInput || {})
                },
                ai: maybeInput.ai || fallbackInput.ai,
                useAI,
                debug,
                saveLogs: parseBooleanFlag(maybeInput.saveLogs),
                logLevel: parseLogLevel(maybeInput.logLevel),
                skipProfileMemory: skipProfileAnalysis || skipAutoMemory,
                skipProfileAnalysis,
                skipAutoMemory
            }
        }
    }

    const fallbackObject = parameterValue && typeof parameterValue === "object"
        ? parameterValue as Partial<AlertpilotInput>
        : undefined
    const debug = parseBooleanFlag(fallbackObject?.debug) === true
    const useAI = parseUseAiOption(fallbackObject as Record<string, unknown> | undefined)

    return {
        action: parameterAction || "createReminder",
        shortcutInput: buildShortcutInputFromIntent(),
        ai: fallbackInput.ai,
        useAI,
        debug,
        saveLogs: parseBooleanFlag(fallbackObject?.saveLogs),
        logLevel: parseLogLevel(fallbackObject?.logLevel),
        skipProfileMemory:
            debug
            || useAI === false
            || parseBooleanFlag(fallbackObject?.skipProfileMemory) === true
            || parseBooleanFlag(fallbackObject?.skipProfileAnalysis) === true
            || parseBooleanFlag(fallbackObject?.skipAutoMemory) === true,
        skipProfileAnalysis:
            debug
            || useAI === false
            || parseBooleanFlag(fallbackObject?.skipProfileAnalysis) === true
            || parseBooleanFlag(fallbackObject?.skipProfileMemory) === true,
        skipAutoMemory:
            debug
            || useAI === false
            || parseBooleanFlag(fallbackObject?.skipAutoMemory) === true
            || parseBooleanFlag(fallbackObject?.skipProfileMemory) === true
    }
}

async function main() {
    const input = buildInputFromIntent()
    const result = await runAlertpilotAction(input)

    Script.exit(Intent.json(result))
}

main().catch(error => {
    Script.exit(Intent.json({
        error: true,
        message: String(error?.message || error)
    }))
})