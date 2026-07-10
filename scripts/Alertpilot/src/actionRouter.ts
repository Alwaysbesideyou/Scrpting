import { runAlertpilot } from "./app"
import { runRescheduleReminder } from "./rescheduleReminder"
import type { AlertpilotAction, AlertpilotActionResult, AlertpilotInput } from "./types"

const legacyCreateActions = new Set(["createReminder"])
const rescheduleActions = new Set(["rescheduleReminder"])

export function resolveAlertpilotAction(value: unknown): AlertpilotAction | undefined {
    const action = String(value ?? "").trim()
    if (!action) return undefined
    if (legacyCreateActions.has(action)) return "createReminder"
    if (rescheduleActions.has(action)) return "rescheduleReminder"
    return undefined
}

export async function runAlertpilotAction(input: AlertpilotInput): Promise<AlertpilotActionResult> {
    const action = resolveAlertpilotAction(input.action) || "createReminder"

    switch (action) {
        case "createReminder": {
            const items = await runAlertpilot({
                ...input,
                action
            })
            return {
                ok: true,
                action,
                status: "success",
                items
            }
        }
        case "rescheduleReminder":
            return runRescheduleReminder({
                ...input,
                action
            })
        default:
            return {
                ok: false,
                action: "createReminder",
                error: `不支持的 action：${String(input.action || "")}`
            }
    }
}
