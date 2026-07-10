import type { AlertpilotConfig, AlertpilotInput } from "./types"
import { parseInput } from "./parser"
import { resolveDateTime } from "./dateTime"

const noopLogger = {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    trace() {},
    ios: async () => {}
}

export async function resolveTargetDateTime(
    rawText: string,
    config: AlertpilotConfig,
    now = new Date()
): Promise<Date | undefined> {
    const input: AlertpilotInput = {
        action: "rescheduleReminder",
        shortcutInput: {
            rawText
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
        useAI: false,
        skipProfileMemory: true,
        skipProfileAnalysis: true,
        skipAutoMemory: true
    }

    parseInput(input, {}, config, noopLogger as any)
    await resolveDateTime(input, config, noopLogger as any, now)
    return input.finalDate
}
