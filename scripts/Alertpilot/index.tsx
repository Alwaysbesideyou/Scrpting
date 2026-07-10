import { Script } from "scripting"
import { runAlertpilotAction, resolveAlertpilotAction } from "./src/actionRouter"
import { runConfigUI } from "./src/config-ui"
import type { AlertpilotInput, LogLevel, ShortcutInput } from "./src/types"

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

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value.map(item => String(item || "").trim()).filter(Boolean)
}

function firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
        const text = String(value ?? "").trim()
        if (text) return text
    }
    return ""
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

function shortcutInputFromContext(value: unknown): ShortcutInput {
    const parsed = parseJsonValue(value)
    if (!parsed || typeof parsed !== "object") return {}

    const context = parsed as Record<string, unknown>
    const parameter = context.shortcutParameter && typeof context.shortcutParameter === "object"
        ? context.shortcutParameter as Record<string, unknown>
        : undefined
    const parameterValue = parameter ? parseJsonValue(parameter.value) : undefined
    const parameterObject = parameterValue && typeof parameterValue === "object"
        ? parameterValue as Record<string, unknown>
        : undefined
    const nestedShortcutInput = parameterObject?.shortcutInput && typeof parameterObject.shortcutInput === "object"
        ? parameterObject.shortcutInput as ShortcutInput
        : undefined

    return {
        ...(nestedShortcutInput || {}),
        rawText: String(nestedShortcutInput?.rawText || context.text || parameterObject?.rawText || parameterObject?.text || parameterObject?.query || ""),
        inputUrl: String(nestedShortcutInput?.inputUrl || normalizeStringArray(context.urls)[0] || parameterObject?.inputUrl || parameterObject?.url || ""),
        webTitle: String(nestedShortcutInput?.webTitle || parameterObject?.webTitle || ""),
        texts: nestedShortcutInput?.texts || normalizeStringArray(context.texts),
        urls: nestedShortcutInput?.urls || normalizeStringArray(context.urls),
        imageCount: Number(nestedShortcutInput?.imageCount ?? context.imageCount ?? 0) || 0,
        images: nestedShortcutInput?.images || (Array.isArray(context.images) ? context.images : []),
        fileURLs: nestedShortcutInput?.fileURLs || normalizeStringArray(context.fileURLs),
        shortcutParameter: parameter
            ? {
                type: String(parameter.type || ""),
                value: parameterValue
            }
            : nestedShortcutInput?.shortcutParameter
    }
}

function extractActionFromQueryParameters(): AlertpilotInput["action"] | undefined {
    const params = Script.queryParameters || {}
    const parsedAlertpilotInput = parseJsonValue(params.alertpilotInput)
    const parsedAlertpilotInputObject = parsedAlertpilotInput && typeof parsedAlertpilotInput === "object"
        ? parsedAlertpilotInput as Record<string, unknown>
        : undefined
    return resolveAlertpilotAction(params.action) || resolveAlertpilotAction(parsedAlertpilotInputObject?.action)
}

function buildCallableInput(): AlertpilotInput {
    const params = Script.queryParameters || {}
    const parsedAlertpilotInput = parseJsonValue(params.alertpilotInput)
    const parsedAlertpilotInputObject = parsedAlertpilotInput && typeof parsedAlertpilotInput === "object"
        ? parsedAlertpilotInput as Record<string, unknown>
        : undefined
    const action = resolveAlertpilotAction(params.action) || resolveAlertpilotAction(parsedAlertpilotInputObject?.action) || "createReminder"
    
    // 重排提醒使用精简格式
    if (action === "rescheduleReminder") {
        const rawText = String(
            params.rawText ||
            params.text ||
            params.query ||
            (parsedAlertpilotInputObject?.rawText as string) ||
            (parsedAlertpilotInputObject?.shortcutInput && typeof parsedAlertpilotInputObject.shortcutInput === "object"
                ? (parsedAlertpilotInputObject.shortcutInput as Record<string, unknown>).rawText
                : "") ||
            ""
        ).trim()
        return {
            action: "rescheduleReminder",
            shortcutInput: { rawText },
            ai: { rawText: "", text: "", isSummary: false, classReminders: "", url: "", timeWord: "", note: "" },
            useAI: false,
            skipProfileMemory: true,
            skipProfileAnalysis: true,
            skipAutoMemory: true
        }
    }
    
    const contextInput = shortcutInputFromContext(params.shortcutContext || params.shortcutContextJson || params.alertpilotInput)
    const rawText = firstNonEmptyString(
        params.rawText,
        params.text,
        params.query,
        parsedAlertpilotInputObject?.shortcutInput && typeof parsedAlertpilotInputObject.shortcutInput === "object"
            ? (parsedAlertpilotInputObject.shortcutInput as Record<string, unknown>).rawText
            : undefined,
        contextInput.rawText
    )
    const inputUrl = firstNonEmptyString(
        params.inputUrl,
        params.url,
        parsedAlertpilotInputObject?.shortcutInput && typeof parsedAlertpilotInputObject.shortcutInput === "object"
            ? (parsedAlertpilotInputObject.shortcutInput as Record<string, unknown>).inputUrl
            : undefined,
        contextInput.inputUrl,
        contextInput.urls?.[0]
    )
    const webTitle = firstNonEmptyString(
        params.webTitle,
        parsedAlertpilotInputObject?.shortcutInput && typeof parsedAlertpilotInputObject.shortcutInput === "object"
            ? (parsedAlertpilotInputObject.shortcutInput as Record<string, unknown>).webTitle
            : undefined,
        contextInput.webTitle
    )
    const useAI = parseUseAiOption(params) ?? parseUseAiOption(parsedAlertpilotInputObject) ?? contextInput.useAI
    const debug = parseBooleanFlag(params.debug) === true
    const skipProfileAnalysis = debug || useAI === false
        ? true
        : parseBooleanFlag(params.skipProfileAnalysis) === true || parseBooleanFlag(params.skipProfileMemory) === true
    const skipAutoMemory = debug || useAI === false
        ? true
        : parseBooleanFlag(params.skipAutoMemory) === true || parseBooleanFlag(params.skipProfileMemory) === true

    return {
        action,
        shortcutInput: {
            ...contextInput,
            ...(parsedAlertpilotInputObject?.shortcutInput && typeof parsedAlertpilotInputObject.shortcutInput === "object"
                ? parsedAlertpilotInputObject.shortcutInput as ShortcutInput
                : {}),
            rawText,
            inputUrl,
            webTitle,
            useAI
        },
        ai: {
            rawText: "",
            text: "",
            isSummary: false,
            classReminders: "",
            url: "",
            timeWord: "",
            note: ""
        },
        useAI,
        debug,
        saveLogs: parseBooleanFlag(params.saveLogs),
        logLevel: parseLogLevel(params.logLevel),
        skipProfileMemory: skipProfileAnalysis || skipAutoMemory,
        skipProfileAnalysis,
        skipAutoMemory
    }
}

async function main() {
    const action = extractActionFromQueryParameters()

    if (action) {
        try {
            const result = await runAlertpilotAction(buildCallableInput())
            Script.exit(result)
        } catch (error) {
            Script.exit({
                ok: false,
                action: action || "createReminder",
                error: error instanceof Error ? error.message : String(error)
            })
        }
        return
    }

    await runConfigUI()
}

void main()
