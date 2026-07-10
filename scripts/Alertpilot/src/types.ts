export type AlertpilotAction = "createReminder" | "rescheduleReminder"

export type ShortcutInput = {
 rawText?: string
 inputUrl?: string
 webTitle?: string
 texts?: string[]
 urls?: string[]
 imageCount?: number
 images?: unknown[]
 fileURLs?: string[]
 shortcutParameter?: {
 type?: string
 value?: unknown
 }
 useAI?: boolean
 noai?: boolean
}

export type AiInput = {
 rawText?: string
 text?: string
 isSummary?: boolean
 classReminders?: string
 url?: string
 timeWord?: string
 note?: string
 smartCategory?: string
 smartReason?: string
}

export type AlertpilotInput = {
 action?: AlertpilotAction | string
 shortcutInput: ShortcutInput
 ai: AiInput
 useAI?: boolean
 noai?: boolean
 debug?: boolean
 saveLogs?: boolean
 logLevel?: LogLevel
 skipProfileMemory?: boolean
 skipProfileAnalysis?: boolean
 skipAutoMemory?: boolean
 url?: string
 note?: string
 misMatch?: string
 parentReminder?: string
 classReminders?: string
 location?: string
 tag?: string
 festival?: string
 month?: string
 week?: string
 otherTime?: string
 rawTime?: string
 daypart?: string
 priority?: string
 finalText?: string
 time?: string
 finalDate?: Date
 isLatestRestDay?: boolean
}

export type AlertpilotOutput = {
 url?: string
 note?: string
 priority?: string
 classReminders?: string
 parentReminder?: string
 calForReminders?: string
 pReminderDate?: string
 text?: string
 specifiedDate?: string
 tags?: string
 scheduleKind?: "work" | "rest"
 addtionalNotification?: string
 error?: boolean
 message?: string
}

export type AlertpilotOutputs = AlertpilotOutput[]

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace"

export type LogEntry = Record<string, unknown>
export type LogSink = (entry: LogEntry | unknown) => void

export type RuntimeState = {
 input: AlertpilotInput
 output: AlertpilotOutput
 logs: unknown[]
}

export type AlertpilotActionResult = {
 ok: boolean
 action: AlertpilotAction
 items?: AlertpilotOutputs
 error?: string
 status?: "success" | "needsConfirmation" | "notFound" | "error"
 message?: string
 query?: string
 targetDateTime?: string
 candidates?: Array<{
 id: string
 title: string
 listName?: string
 dueDate?: string
 }>
 matchedReminder?: {
 id: string
 title: string
 listName?: string
 dueDate?: string
 }
}

export type UserPreferenceLearningStat = {
 morning?: number
 work?: number
 evening?: number
 rest?: number
 weekend?: number
 total?: number
}

export type UserPreferenceDailyMemory = {
 date: string
 items: string[]
}

export type UserPreferenceMemory = {
 global?: string | string[]
 aiDaily?: UserPreferenceDailyMemory[]
 aiMarkdown?: string
}

export type HolidayCache = {
 date: string
 months: number
 text: string
}

export type SimpleTaskPreferenceMode = "any" | "work" | "restTime" | "restDay" | "specified"
export type SpecifiedDayConstraint = "any" | "work" | "rest" | "split"

export type UserPreferences = {
 enabled: boolean
 autoLearn: boolean
 workStart: string
 workEnd: string
 commuteMinutes: number
 generalTaskDurationMinutes: number
 importantTaskDurationMinutes: number
 conflictDeferMinutes: number
 conflictBufferMinutes: number
 floatingTaskDelayMinutes: number
 maxConcurrentTasks: number
 dailyTaskStart: string
 dailyTaskEnd: string
 quietAfter: string
 importantTaskTime: string
 weekendDefaultTime: string
 studyPreferredTime: string
 exercisePreferredTime: string
 shoppingMode: SimpleTaskPreferenceMode
 shoppingTime?: string
 houseworkMode: SimpleTaskPreferenceMode
 houseworkTime?: string
 studyMode?: SimpleTaskPreferenceMode
 exerciseMode?: SimpleTaskPreferenceMode
 generalMode?: SimpleTaskPreferenceMode
 generalPreferredTime?: string
 defaultSmartCategory?: string
 simpleTaskPreferences?: Array<{
 id: string
 typeId: string
 mode: SimpleTaskPreferenceMode
 time: string
 specifiedTimes?: string[]
 specifiedDayConstraint?: SpecifiedDayConstraint
 workDayTimes?: string[]
 restDayTimes?: string[]
 }>
 simpleTaskNames?: Record<string, string>
 simpleTaskIcons?: Record<string, string>
 hiddenSimpleTaskIds?: string[]
 customSimpleTasks?: Array<{
 id: string
 typeId?: string
 title: string
 icon?: string
 mode: SimpleTaskPreferenceMode
 time: string
 specifiedTimes?: string[]
 specifiedDayConstraint?: SpecifiedDayConstraint
 workDayTimes?: string[]
 restDayTimes?: string[]
 }>
 learning?: Record<string, UserPreferenceLearningStat>
 learningByList?: Record<string, UserPreferenceLearningStat>
 memory?: UserPreferenceMemory
 holidayCache?: HolidayCache
}

export type AlertpilotConfig = {
 提醒列表: Record<string, string>
 calendarAddNum: number
 时间补全: Record<string, [string, string, string]>
 timeOut: number
 saveLogs?: boolean
 logLevel?: LogLevel
 附加时间: Record<string, string>
 自动补全: [string[], string[]]
 时间: Record<string, string>
 地点: Record<string, string>
 默认配置: {
 提醒列表: string
 附加时间: string
 时间: string
 工作日时间?: string
休息日时间?: string
 地点: string
 }
 restLocation?: string
 aiPrompt?: string
 useBuiltInAi?: boolean
 useCustomAiProviderModel?: boolean
 aiProvider?: "openai" | "gemini" | "anthropic" | "deepseek" | "openrouter" | string
 aiModelId?: string
 userPreferences?: UserPreferences
}
