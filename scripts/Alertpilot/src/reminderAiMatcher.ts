import { getAllIncompleteReminders } from "./reminderSearch"
import type { ReminderCandidate } from "./reminderSearch"
import type { AlertpilotConfig } from "./types"
import { requestAiGeneratedItems } from "./ai"

export type AiReminderMatch = {
    reminderId: string
    confidence: number
    reason: string
    timeWord: string
}

export type AiReminderMatchResult = {
    matchedReminder?: AiReminderMatch
    candidates?: Array<{
        id: string
        title: string
        listName?: string
        dueDate?: string
    }>
    error?: string
}

export async function matchReminderWithAi(
    rawText: string,
    config: AlertpilotConfig
): Promise<AiReminderMatchResult> {
    try {
        // 获取所有未完成的提醒
        const reminders = await getAllIncompleteReminders()
        
        if (reminders.length === 0) {
            return {
                error: "没有找到任何未完成的提醒"
            }
        }
        
        // 准备提醒列表供AI分析
        const reminderList = reminders.map((reminder, index) => ({
            index,
            id: reminder.id,
            title: reminder.title,
            listName: reminder.listName || "提醒事项",
            dueDate: reminder.dueDate || "无截止日期"
        }))
        
        // 构建prompt
        const prompt = buildReminderMatchPrompt(rawText, reminderList)
        
        // 调用AI进行识别
        const aiResult = await requestAiGeneratedItems(prompt, getReminderMatchInstructions(), config)
        
        if (!aiResult || aiResult.length === 0) {
            return {
                error: "AI未能识别匹配的提醒"
            }
        }
        
        // 解析AI结果
        const matchResult = parseAiMatchResult(aiResult[0], reminders)
        
        return matchResult
        
    } catch (error) {
        return {
            error: `AI识别失败: ${error instanceof Error ? error.message : String(error)}`
        }
    }
}

function buildReminderMatchPrompt(
    rawText: string,
    reminderList: Array<{
        index: number
        id: string
        title: string
        listName: string
        dueDate: string
    }>
): string {
    const reminderListText = reminderList
        .map(r => `${r.index + 1}. [${r.listName}] ${r.title} (截止: ${r.dueDate})`)
        .join("\n")
    
    return `用户想要重排一个提醒，用户输入是："${rawText}"

以下是用户当前的所有未完成提醒：
${reminderListText}

请分析用户输入：
1. 找出最可能匹配的提醒（支持错别字、口语化、部分名称匹配）
2. 提取用户指定的目标时间文本

请返回JSON格式的结果。`
}

function getReminderMatchInstructions(): string {
    return `你是一个提醒匹配助手。你的任务是从用户输入中识别出用户想要重排的提醒和目标时间。

# 任务说明
1. 分析用户输入，理解用户想要修改哪个提醒
2. 从提供的提醒列表中找出最匹配的提醒
3. 提取用户指定的目标时间文本（如"明天晚上"、"下周三下午3点"）

# 输出要求
返回一个JSON对象，包含以下字段：
- reminderIndex: 匹配的提醒索引（从1开始，如果没有匹配返回-1）
- confidence: 匹配置信度（0-100）
- reason: 匹配原因说明
- timeWord: 用户指定的目标时间文本，保持原始表述（如"明天晚上"、"下周三"、"下个月15号"）。如果没有明确时间，返回空字符串

# 匹配规则
1. 优先匹配完全相同的名称
2. 其次匹配包含关系（用户输入包含在提醒名称中，或提醒名称包含在用户输入中）
3. 考虑错别字和同音字（如"大僵"匹配"大疆"）
4. 考虑口语化表达（如"那个充电的"匹配"充电提醒"）
5. 考虑提醒列表名称（如"购物清单里的苹果"匹配购物清单中的"苹果"提醒）

# 时间提取规则
- 从用户输入中提取表示目标时间的部分
- 保持原始表述，不要转换成具体日期
- 例如："重排一下大疆提醒到明天晚上" -> timeWord: "明天晚上"
- 例如："把充电提醒改到下周三" -> timeWord: "下周三"
- 例如："大疆提醒推迟到下个月" -> timeWord: "下个月"

# 注意事项
- 如果用户输入不明确或没有匹配，返回reminderIndex: -1
- 置信度应该反映匹配的确定性
- 原因要简洁明了`
}

function parseAiMatchResult(
    aiResult: Record<string, unknown>,
    reminders: ReminderCandidate[]
): AiReminderMatchResult {
    const reminderIndex = Number(aiResult.reminderIndex) || -1
    const confidence = Number(aiResult.confidence) || 0
    const reason = String(aiResult.reason || "")
    const timeWord = String(aiResult.timeWord || "").trim()
    
    if (reminderIndex < 0 || reminderIndex >= reminders.length) {
        return {
            candidates: reminders.map(r => ({
                id: r.id,
                title: r.title,
                listName: r.listName,
                dueDate: r.dueDate
            })),
            error: "AI未能找到明确匹配的提醒，请从候选列表中选择"
        }
    }
    
    const matchedReminder = reminders[reminderIndex]
    
    return {
        matchedReminder: {
            reminderId: matchedReminder.id,
            confidence,
            reason,
            timeWord
        },
        candidates: reminders.map(r => ({
            id: r.id,
            title: r.title,
            listName: r.listName,
            dueDate: r.dueDate
        }))
    }
}