import { readConfig } from "./storage"
import type { AlertpilotActionResult, AlertpilotInput } from "./types"
import { updateReminderDueDate } from "./reminderSearch"
import { resolveTargetDateTime } from "./rescheduleTimeResolver"
import { formatDateTime } from "./utils"
import { matchReminderWithAi } from "./reminderAiMatcher"
import { readConfigWithHolidayCache } from "./ai"

export async function runRescheduleReminder(input: AlertpilotInput): Promise<AlertpilotActionResult> {
    const confirmation = getConfirmation(input)
    if (confirmation?.reminderId) {
        return confirmRescheduleReminder(input, confirmation.reminderId)
    }

    const rawText = String(input.shortcutInput?.rawText || "").trim()
    if (!rawText) {
        return {
            ok: false,
            action: "rescheduleReminder",
            status: "error",
            message: "请输入重排提醒的指令",
            error: "emptyInput"
        }
    }

    // 使用AI识别目标提醒和时间文本
    const config = await readConfigWithHolidayCache()
    const aiMatchResult = await matchReminderWithAi(rawText, config)
    
    if (aiMatchResult.error) {
        return {
            ok: false,
            action: "rescheduleReminder",
            status: "error",
            message: aiMatchResult.error,
            error: "aiMatchFailed"
        }
    }

    if (!aiMatchResult.matchedReminder) {
        return {
            ok: false,
            action: "rescheduleReminder",
            status: "error",
            message: "AI未能识别要修改的提醒",
            error: "aiMatchFailed"
        }
    }

    // 检查AI是否识别出时间文本
    const timeWord = aiMatchResult.matchedReminder.timeWord
    if (!timeWord) {
        return {
            ok: false,
            action: "rescheduleReminder",
            status: "error",
            message: "无法识别目标时间，请说明要改到什么时候",
            error: "noTimeSpecified"
        }
    }

    // 使用本地脚本解析时间文本
    const targetDate = await resolveTargetDateTime(timeWord, config)
    if (!targetDate) {
        return {
            ok: false,
            action: "rescheduleReminder",
            status: "error",
            message: `无法识别目标时间：${timeWord}`,
            error: "invalidTargetDateTime"
        }
    }

    // 更新提醒时间
    const updated = await updateReminderDueDate(aiMatchResult.matchedReminder.reminderId, targetDate)
    if (!updated) {
        return {
            ok: false,
            action: "rescheduleReminder",
            status: "error",
            message: "提醒更新失败，请稍后重试",
            error: "updateFailed"
        }
    }

    return {
        ok: true,
        action: "rescheduleReminder",
        status: "success",
        message: `已将"${updated.title}"改到 ${formatDateTime(targetDate)}`,
        targetDateTime: targetDate.toISOString(),
        matchedReminder: {
            id: updated.id,
            title: updated.title,
            listName: updated.listName,
            dueDate: updated.dueDate
        }
    }
}

async function confirmRescheduleReminder(input: AlertpilotInput, reminderId: string): Promise<AlertpilotActionResult> {
    const targetDateTime = getTargetDateTime(input)
    if (!targetDateTime) {
        return {
            ok: false,
            action: "rescheduleReminder",
            status: "error",
            message: "缺少 targetDateTime，无法确认修改提醒时间",
            error: "missingTargetDateTime"
        }
    }

    const targetDate = new Date(targetDateTime)
    if (Number.isNaN(targetDate.getTime())) {
        return {
            ok: false,
            action: "rescheduleReminder",
            status: "error",
            message: "targetDateTime 格式无效",
            error: "invalidTargetDateTime"
        }
    }

    const updated = await updateReminderDueDate(reminderId, targetDate)
    if (!updated) {
        return {
            ok: false,
            action: "rescheduleReminder",
            status: "notFound",
            message: "没有找到需要确认修改的提醒",
            error: "reminderNotFound"
        }
    }

    return {
        ok: true,
        action: "rescheduleReminder",
        status: "success",
        message: `已将"${updated.title}"改到 ${formatDateTime(targetDate)}`,
        targetDateTime: targetDate.toISOString(),
        matchedReminder: {
            id: updated.id,
            title: updated.title,
            listName: updated.listName,
            dueDate: updated.dueDate
        }
    }
}

function getConfirmation(input: AlertpilotInput): { reminderId?: string } | undefined {
    const parameterValue = input.shortcutInput?.shortcutParameter?.value
    const root = typeof parameterValue === "object" && parameterValue !== null
        ? parameterValue as Record<string, unknown>
        : undefined
    const confirmation = root?.confirmation && typeof root.confirmation === "object"
        ? root.confirmation as Record<string, unknown>
        : undefined
    if (confirmation?.reminderId) {
        return {
            reminderId: String(confirmation.reminderId)
        }
    }
    return undefined
}

function getTargetDateTime(input: AlertpilotInput): string {
    const parameterValue = input.shortcutInput?.shortcutParameter?.value
    const root = typeof parameterValue === "object" && parameterValue !== null
        ? parameterValue as Record<string, unknown>
        : undefined
    return String(root?.targetDateTime || "").trim()
}