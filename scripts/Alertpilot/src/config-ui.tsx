import {
    Button as ScriptingButton,
    DatePicker,
    DisclosureGroup,
    ForEach,
    HStack,
    Image,
    Label,
    List,
    Markdown,
    Navigation,
    NavigationLink,
    NavigationStack,
    Picker,
    Script,
    Section,
    Spacer,
    Stepper,
    Text,
    TextField as ScriptingTextField,
    Toggle,
    useEffect,
    useObservable,
    useRef,
    useState
} from "scripting"

import type { AlertpilotActionResult, AlertpilotConfig, AlertpilotInput, AlertpilotOutput, LogLevel, SimpleTaskPreferenceMode, SpecifiedDayConstraint, UserPreferenceLearningStat } from "./types"
import { runAlertpilot } from "./app"
import { runRescheduleReminder } from "./rescheduleReminder"
import { DEFAULT_CONFIG, getDefaultAdditionalTime, getDefaultLocation, getDefaultReminderList, getDefaultTime, getDefaultWorkdayTime, getDefaultRestDayTime } from "./config"
import {
    readConfig,
    writeConfig,
    resetConfig
} from "./storage"
// @ts-ignore Scripting can import from sibling script directories at runtime.
import { getRestDayInfo } from "../../Off day/utils/is_rest_day"
import {
    aiModelOptions,
    aiProviderOptions,
    buildAiUserPrompt,
    ensureHolidayCache,
    extractUrl,
    fillPromptVariables,
    formatPromptDate,
    getCachedHolidayText,
    getHolidayCacheText,
    getWebPageContent,
    requestAiGeneratedItems,
    todayKey
} from "./ai"
import { normalizeReminderListCategory } from "./smartScheduler"
import { clearDailyMemory, replaceAutoMemory, replaceGlobalMemory, aiOrganizeMemory } from "./profileMemory"
import { formatConsoleLog, normalizeLogLevel, shouldLogLevel, summarizeInput, summarizeOutput, type StructuredLogEntry } from "./logger"
import { getErrorMessage } from "./utils"

type TextEditHistory = {
    value: string
    undoStack: string[]
    redoStack: string[]
    isApplyingHistory: boolean
    onChanged?: (value: string) => void
}

let activeTextEditHistory: TextEditHistory | null = null

function isObservableTextValue(value: unknown): value is Observable<string> {
    return Boolean(
        value &&
        typeof value === "object" &&
        "setValue" in (value as any) &&
        typeof (value as any).setValue === "function" &&
        "value" in (value as any)
    )
}

function applyTextEditHistoryValue(history: TextEditHistory, value: string) {
    history.value = value
    history.isApplyingHistory = true
    try {
        history.onChanged?.(value)
    } finally {
        history.isApplyingHistory = false
    }
}

function recordTextEditHistoryChange(
    history: TextEditHistory,
    nextValue: string,
    shouldRecordUndo = true
): boolean {
    const previousValue = history.value

    if (nextValue === previousValue) return false

    if (history.isApplyingHistory || !shouldRecordUndo) {
        history.value = nextValue
        return true
    }

    history.undoStack.push(previousValue)
    if (history.undoStack.length > 100) {
        history.undoStack.shift()
    }
    history.redoStack = []
    history.value = nextValue
    return true
}

function undoTextEditHistory() {
    const history = activeTextEditHistory
    if (!history || history.undoStack.length === 0) return false

    const previous = history.undoStack.pop()!
    history.redoStack.push(history.value)
    applyTextEditHistoryValue(history, previous)
    return true
}

function redoTextEditHistory() {
    const history = activeTextEditHistory
    if (!history || history.redoStack.length === 0) return false

    const next = history.redoStack.pop()!
    history.undoStack.push(history.value)
    applyTextEditHistoryValue(history, next)
    return true
}

type TextFieldWrapperProps = {
    title?: string
    label?: any
    value: string | Observable<string>
    onChanged?: (value: string) => void
    onFocus?: () => void
    [key: string]: any
}

function TextField({ value, onChanged, onFocus, ...props }: TextFieldWrapperProps) {
    const isObservableValue = isObservableTextValue(value)
    const localValue = useObservable(() => String(value ?? ""))
    const fieldValue = isObservableValue ? value : localValue
    const historyRef = useRef<TextEditHistory>({
        value: String(isObservableValue ? (value.value ?? "") : (value ?? "")),
        undoStack: [],
        redoStack: [],
        isApplyingHistory: false,
        onChanged: undefined
    })
    const currentValue = isObservableValue ? String(value.value ?? "") : String(value ?? "")

    if (historyRef.current.value !== currentValue) {
        recordTextEditHistoryChange(historyRef.current, currentValue, false)
    }

    historyRef.current.onChanged = (nextValue: string) => {
        if (isObservableValue) {
            fieldValue.setValue(nextValue)
        } else {
            onChanged?.(nextValue)
        }
    }

    useEffect(() => {
        if (!isObservableValue) return

        function handleValueChanged(nextValue: string) {
            const history = historyRef.current
            const normalizedValue = String(nextValue ?? "")
            recordTextEditHistoryChange(history, normalizedValue)
            activeTextEditHistory = history
        }

        fieldValue.subscribe(handleValueChanged)
        return () => {
            fieldValue.unsubscribe(handleValueChanged)
        }
    }, [fieldValue, isObservableValue])

    function handleChanged(nextValue: string) {
        const history = historyRef.current
        const normalizedValue = String(nextValue ?? "")
        const didChange = recordTextEditHistoryChange(history, normalizedValue)

        activeTextEditHistory = history

        if (didChange && !history.isApplyingHistory) {
            onChanged?.(normalizedValue)
        }
    }

    function handleFocus() {
        activeTextEditHistory = historyRef.current
        onFocus?.()
    }

    if (isObservableValue) {
        return (
            <ScriptingTextField
                {...props as any}
                value={fieldValue as any}
                onFocus={handleFocus}
            />
        )
    }

    return (
        <ScriptingTextField
            {...props as any}
            value={currentValue}
            onChanged={handleChanged}
            onFocus={handleFocus}
        />
    )
}

function playButtonFeedback() {
    try {
        ; (globalThis as any).selection?.()
    } catch {
        // Ignore haptic feedback failures on unsupported devices.
    }
}

function Button({ action, ...props }: any) {
    const wrappedAction = action
        ? (...args: any[]) => {
            playButtonFeedback()
            return action(...args)
        }
        : undefined

    return <ScriptingButton {...props} {...(wrappedAction ? { action: wrappedAction } : {})} />
}

export async function runConfigUI() {
    await Navigation.present(<ConfigEditorView />)
    Script.exit()
}

type RecordGroupKey =
    | "提醒列表"
    | "附加时间"
    | "时间"
    | "地点"

type DefaultGroupKey =
    | "提醒列表"
    | "附加时间"
    | "时间"
    | "工作日时间"
    | "休息日时间"
    | "地点"

type TimeCompletionItem = {
    key: string
    value: [string, string, string]
}

type AutoCompletionItem = {
    index: number
    daypart: string
    location: string
}

type PendingTimeRecord = {
    id: string
    key: string
    value: string
}

type UpdateConfig = (
    mutator: (draft: AlertpilotConfig) => void,
    message?: string
) => Promise<AlertpilotConfig | null>

type RecordEntryItem = {
    id: string
    key: string
    value: string
}

type TimeCompletionEntryItem = TimeCompletionItem & {
    id: string
}

type AutoCompletionEntryItem = AutoCompletionItem & {
    id: string
}

function cloneConfig(config: AlertpilotConfig): AlertpilotConfig {
    return JSON.parse(JSON.stringify(config))
}

function toNumberForSort(value: unknown): number {
    const n = Number(value)
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n
}

function recordEntries(
    config: AlertpilotConfig,
    group: RecordGroupKey,
    options?: {
        sortNumericDesc?: boolean
        sortValueNumericAsc?: boolean
    }
) {
    const entries = Object.entries(config[group] || {})

    if (options?.sortValueNumericAsc) {
        return entries.sort((a, b) => toNumberForSort(a[1]) - toNumberForSort(b[1]))
    }

    if (options?.sortNumericDesc) {
        return entries.sort((a, b) => Number(b[0]) - Number(a[0]))
    }

    return entries
}

function timeCompletionEntries(config: AlertpilotConfig): TimeCompletionItem[] {
    return Object.entries(config["时间补全"] || {})
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([key, value]) => ({
            key,
            value: value as [string, string, string]
        }))
}

function autoCompletionEntries(config: AlertpilotConfig): AutoCompletionItem[] {
    const dayparts = config["自动补全"]?.[0] || []
    const locations = config["自动补全"]?.[1] || []

    return dayparts.map((daypart, index) => ({
        index,
        daypart,
        location: locations[index] || ""
    }))
}

function recordIcon(group: RecordGroupKey): string {
    switch (group) {
        case "提醒列表":
            return "list.bullet.rectangle"
        case "附加时间":
            return "calendar.badge.clock"
        case "时间":
            return "clock"
        case "地点":
            return "mappin.and.ellipse"
    }
}

function memoryMarkdownText(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map(item => String(item || "").trim())
            .filter(Boolean)
            .map(item => item.startsWith("-") ? item : `- ${item}`)
            .join("\n")
    }

    return String(value || "").replace(/\r\n/g, "\n").trim()
}

function memoryEditorLineLimit() {
    return { min: 5, max: 30 }
}

function dailyMemoryMarkdownText(memory: any): string {
    const markdown = memoryMarkdownText(memory?.aiMarkdown)
    if (markdown) return markdown

    const days = Array.isArray(memory?.aiDaily) ? memory.aiDaily : []
    return days
        .map((day: any) => {
            const date = String(day?.date || "").trim()
            const items = Array.isArray(day?.items) ? day.items : []
            const body = items
                .map((item: unknown) => memoryMarkdownText(item))
                .filter(Boolean)
                .map((item: string) => item.startsWith("-") ? item : `- ${item}`)
                .join("\n")
            return date && body ? `## ${date}\n${body}` : body
        })
        .filter(Boolean)
        .join("\n")
}

function markdownSummary(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) return "未设置"
    const lines = trimmed.split(/\r?\n/).filter(line => line.trim()).length
    return `${lines} 行 / ${trimmed.length} 字`
}

function ConfigRowLabel({
    title,
    systemImage,
    iconColor
}: {
    title: string
    systemImage: string
    iconColor?: any
}) {
    if (iconColor) {
        return (
            <HStack>
                <Image
                    systemName={systemImage}
                    foregroundStyle={iconColor}
                    font="body"
                    imageScale="medium"
                />
                <Text font="body">{title}</Text>
            </HStack>
        )
    }

    return (
        <Label
            title={title}
            systemImage={systemImage}
        />
    )
}

function disclosureLabel(title: string, systemImage: string) {
    return (
        <Label
            title={title}
            systemImage={systemImage}
        />
    )
}

function recordEntryItems(
    config: AlertpilotConfig,
    group: RecordGroupKey,
    options?: {
        sortNumericDesc?: boolean
        sortValueNumericAsc?: boolean
    }
): RecordEntryItem[] {
    return recordEntries(config, group, options).map(([key, value]) => ({
        id: `${group}-${key}`,
        key,
        value
    }))
}

function timeCompletionEntryItems(config: AlertpilotConfig): TimeCompletionEntryItem[] {
    return timeCompletionEntries(config).map(item => ({
        id: `time-completion-${item.key}`,
        ...item
    }))
}

function autoCompletionEntryItems(config: AlertpilotConfig): AutoCompletionEntryItem[] {
    return autoCompletionEntries(config).map(item => ({
        id: `auto-completion-${item.index}`,
        ...item
    }))
}

function entryListSignature<T extends { id: string }>(items: T[]) {
    return JSON.stringify(items)
}

function useDeletableEntries<T extends { id: string }>(
    source: T[],
    onDeleted: (deletedItems: T[]) => void | Promise<void>
) {
    const entries = useObservable<T[]>(() => source)
    const syncingRef = useRef(false)
    const sourceSignatureRef = useRef(entryListSignature(source))

    useEffect(() => {
        const nextSignature = entryListSignature(source)
        if (sourceSignatureRef.current === nextSignature) return

        sourceSignatureRef.current = nextSignature
        syncingRef.current = true
        entries.setValue(source)
        syncingRef.current = false
    }, [source])

    useEffect(() => {
        async function handleChange(nextItems: T[], oldItems: T[]) {
            if (syncingRef.current || nextItems.length >= oldItems.length) return

            const nextIds = new Set(nextItems.map(item => item.id))
            const deletedItems = oldItems.filter(item => !nextIds.has(item.id))
            if (deletedItems.length === 0) return

            await onDeleted(deletedItems)
        }

        entries.subscribe(handleChange)
        return () => {
            entries.unsubscribe(handleChange)
        }
    }, [entries, onDeleted])

    return entries
}

function RowText({
    title,
    value,
    icon,
    iconColor,
    ...props
}: {
    title: string
    value?: string
    icon?: string
    iconColor?: any
    [key: string]: any
}) {
    return (
        <HStack {...props}>
            {icon ? (
                <ConfigRowLabel
                    title={title}
                    systemImage={icon}
                    iconColor={iconColor}
                />
            ) : <Text font="body">{title}</Text>}
            <Spacer />
            <Text
                font="callout"
                foregroundStyle="secondaryLabel"
                multilineTextAlignment="trailing"
            >
                {value || ""}
            </Text>
        </HStack>
    )
}

function LabeledInlineTextField({
    title,
    value,
    icon,
    onChanged,
    ...props
}: {
    title: string
    value: string
    icon?: string
    onChanged: (value: string) => void
    [key: string]: any
}) {
    return (
        <HStack>
            {icon ? (
                <ConfigRowLabel
                    title={title}
                    systemImage={icon}
                />
            ) : <Text font="body">{title}</Text>}
            <TextField
                {...props}
                label={
                    <Text
                        frame={{ width: 0, height: 0 }}
                        opacity={0}
                    >
                        {title}
                    </Text>
                }
                value={value}
                onChanged={onChanged}
                multilineTextAlignment="trailing"
                textFieldStyle="plain"
                frame={{ maxWidth: "infinity", alignment: "trailing" }}
            />
        </HStack>
    )
}

function normalizeTimeDigits(value?: string): string {
    const digits = String(value || "").replace(/\D/g, "")
    if (!digits) return "0000"
    return digits.padStart(4, "0").slice(-4)
}

function timeDateFromValue(value?: string): number {
    const digits = normalizeTimeDigits(value)
    const date = new Date()
    date.setHours(Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), 0, 0)
    return date.getTime()
}

function timeValueFromPicker(value: Date | number): string {
    const timestamp = value instanceof Date ? value.getTime() : Number(value)
    const date = new Date(Number.isNaN(timestamp) ? Date.now() : timestamp)
    return `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`
}

function TimePickerRow({
    title,
    value,
    icon,
    onChanged
}: {
    title: string
    value: string
    icon?: string
    onChanged: (value: string) => void
}) {
    if (icon) {
        return (
            <HStack>
                <ConfigRowLabel
                    title={title}
                    systemImage={icon}
                />
                <Spacer />
                <DatePicker
                    title={title}
                    value={timeDateFromValue(value)}
                    displayedComponents={["hourAndMinute"]}
                    onChanged={(nextValue: Date | number) => onChanged(timeValueFromPicker(nextValue))}
                    labelsHidden
                />
            </HStack>
        )
    }

    return (
        <DatePicker
            title={title}
            value={timeDateFromValue(value)}
            displayedComponents={["hourAndMinute"]}
            onChanged={(nextValue: Date | number) => onChanged(timeValueFromPicker(nextValue))}
        />
    )
}

function compactDefaultSummary(config: AlertpilotConfig): string {
    const restLocation = locationNameByValue(config, config.restLocation) || "未设置"
    return `列表 ${getDefaultReminderList(config)} / 工作日 ${getDefaultWorkdayTime(config)} / 休息日 ${getDefaultRestDayTime(config)} / 地点 ${getDefaultLocation(config)} / 休息地 ${restLocation} / 附加 ${getDefaultAdditionalTime(config)}`
}

function locationNameByValue(config: AlertpilotConfig, value?: string): string {
    if (!value) return ""
    return Object.entries(config["地点"] || {}).find(([, locationValue]) => locationValue === value)?.[0] || ""
}

function getAiPrompt(config: AlertpilotConfig): string {
    return config.aiPrompt || DEFAULT_CONFIG.aiPrompt || ""
}

function CollapsibleSection({
    title,
    summary,
    icon,
    iconColor,
    children,
    defaultExpanded = false
}: {
    title: string
    summary?: string
    icon?: string
    iconColor?: any
    children: any
    defaultExpanded?: boolean
}) {
    const [expanded, setExpanded] = useState(defaultExpanded)

    return (
        <Section>
            <DisclosureGroup
                isExpanded={expanded}
                onChanged={setExpanded}
                label={
                    <RowText
                        title={title}
                        value={expanded ? "收起" : (summary || "点击展开")}
                        icon={icon}
                        iconColor={iconColor}
                    />
                }
            >
                {children}
            </DisclosureGroup>
        </Section>
    )
}

function StepperRow({
    title,
    value,
    min = 1,
    max,
    step = 1,
    unit = "",
    icon = "number.circle",
    onChanged
}: {
    title: string
    value: number
    min?: number
    max?: number
    step?: number
    unit?: string
    icon?: string
    onChanged: (value: number) => void | Promise<void>
}) {
    async function increment() {
        await onChanged(max === undefined ? value + step : Math.min(max, value + step))
    }

    async function decrement() {
        await onChanged(Math.max(min, value - step))
    }

    return (
        <HStack>
            {icon ? (
                <ConfigRowLabel
                    title={title}
                    systemImage={icon}
                />
            ) : <Text font="body">{title}</Text>}
            <Spacer />
            <Stepper
                title={`${value}${unit}`}
                onIncrement={increment}
                onDecrement={decrement}
            />
        </HStack>
    )
}

type DebugMode = "createReminder" | "rescheduleReminder"

type DebugInputState = {
    debugMode: DebugMode
    applyReschedule: boolean
    shortcutInput: {
        webTitle: string
        rawText: string
        inputUrl: string
    }
    useAiInput: boolean
    useProfileAnalysis: boolean
    saveToAutoMemory: boolean
    ai: {
        rawText: string
        note: string
        timeWord: string
        text: string
        classReminders: string
        isSummary: boolean
        url: string
    }
}

const defaultDebugInput: DebugInputState = {
    debugMode: "createReminder",
    applyReschedule: false,
    shortcutInput: {
        webTitle: "",
        rawText: "",
        inputUrl: ""
    },
    useAiInput: true,
    useProfileAnalysis: true,
    saveToAutoMemory: false,
    ai: {
        rawText: "",
        note: "",
        timeWord: "",
        text: "",
        classReminders: "Reminders",
        isSummary: false,
        url: ""
    }
}

let debugRunnerInputCache: DebugInputState | null = null

function cloneDebugInput(input: DebugInputState): DebugInputState {
    return JSON.parse(JSON.stringify(input))
}

function parseDebugDate(value: string): number {
    if (!value) return Date.now()

    const normalized = value.includes("T") ? value : value.replace(" ", "T")
    const timestamp = new Date(normalized).getTime()
    return Number.isNaN(timestamp) ? Date.now() : timestamp
}

function formatDebugDate(timestamp: number): string {
    const date = new Date(timestamp)
    const yyyy = date.getFullYear()
    const MM = String(date.getMonth() + 1).padStart(2, "0")
    const dd = String(date.getDate()).padStart(2, "0")
    const HH = String(date.getHours()).padStart(2, "0")
    const mm = String(date.getMinutes()).padStart(2, "0")

    return `${yyyy}-${MM}-${dd} ${HH}:${mm}`
}

function formatDateKey(date: Date): string {
    const yyyy = date.getFullYear()
    const MM = String(date.getMonth() + 1).padStart(2, "0")
    const dd = String(date.getDate()).padStart(2, "0")

    return `${yyyy}-${MM}-${dd}`
}

async function isRest(date: Date): Promise<boolean> {
    return (await getRestDayInfo(formatDateKey(date))).isRestDay
}

function buildDebugInput(state: DebugInputState): AlertpilotInput {
    const input = cloneDebugInput(state) as DebugInputState
    
    // 重排提醒使用精简格式
    if (input.debugMode === "rescheduleReminder") {
        return {
            action: "rescheduleReminder",
            shortcutInput: {
                rawText: input.shortcutInput.rawText || ""
            },
            ai: {},
            useAI: false,
            skipProfileAnalysis: true,
            skipAutoMemory: true
        }
    }
    
    return {
        action: input.debugMode,
        shortcutInput: input.shortcutInput,
        ai: input.useAiInput ? {} : input.ai,
        useAI: input.debugMode === "createReminder" ? input.useAiInput : false,
        skipProfileAnalysis: !input.useProfileAnalysis,
        skipAutoMemory: !input.saveToAutoMemory
    }
}

function debugInputFromValue(value: any): DebugInputState {
    return {
        debugMode: value?.action === "rescheduleReminder" ? "rescheduleReminder" : "createReminder",
        applyReschedule: Boolean(value?.applyReschedule),
        shortcutInput: {
            webTitle: String(value?.shortcutInput?.webTitle ?? ""),
            rawText: String(value?.shortcutInput?.rawText ?? ""),
            inputUrl: String(value?.shortcutInput?.inputUrl ?? "")
        },
        useAiInput: Boolean(value?.useAiInput),
        useProfileAnalysis: value?.skipProfileAnalysis !== undefined
            ? !Boolean(value?.skipProfileAnalysis)
            : value?.useProfileAnalysis !== undefined
                ? Boolean(value?.useProfileAnalysis)
                : value?.includeProfileMemory !== undefined
                    ? Boolean(value?.includeProfileMemory)
                    : true,
        saveToAutoMemory: value?.skipAutoMemory !== undefined
            ? !Boolean(value?.skipAutoMemory)
            : value?.saveToAutoMemory !== undefined
                ? Boolean(value?.saveToAutoMemory)
                : value?.includeProfileMemory !== undefined
                    ? Boolean(value?.includeProfileMemory)
                    : false,
        ai: {
            rawText: String(value?.ai?.rawText ?? ""),
            note: String(value?.ai?.note ?? ""),
            timeWord: String(value?.ai?.timeWord ?? ""),
            text: String(value?.ai?.text ?? ""),
            classReminders: String(value?.ai?.classReminders ?? ""),
            isSummary: Boolean(value?.ai?.isSummary),
            url: String(value?.ai?.url ?? "")
        }
    }
}

function parseDebugJsonText(text: string): any {
    try {
        return JSON.parse(text)
    } catch {
        const start = text.indexOf("{")
        const end = text.lastIndexOf("}")

        if (start >= 0 && end > start) {
            return JSON.parse(text.slice(start, end + 1))
        }

        throw new Error("剪切板中没有找到 JSON 对象")
    }
}

type TimeWordParts = {
    otherTime: string
    time: string
}

function splitTimeWord(config: AlertpilotConfig, value: string): TimeWordParts {
    const otherTimes = Object.keys(config["附加时间"] || {})
        .sort((a, b) => b.length - a.length)
    const times = Object.keys(config["时间"] || {})
        .sort((a, b) => b.length - a.length)

    for (const otherTime of ["", ...otherTimes]) {
        for (const time of ["", ...times]) {
            if (`${otherTime}${time}` === value) {
                return { otherTime, time }
            }
        }
    }

    return {
        otherTime: otherTimes.find(item => value.startsWith(item)) || "",
        time: times.find(item => value.endsWith(item)) || ""
    }
}

function classReminderOptions(config: AlertpilotConfig, currentValue = "") {
    const entries = recordEntries(config, "提醒列表")
    const values = new Set(entries.map(([, value]) => value))
    const items = [
        { key: "empty", label: "空", value: "" },
        ...entries.map(([key, value]) => ({
            key,
            label: key,
            value
        }))
    ]

    if (currentValue && !values.has(currentValue)) {
        items.push({
            key: `current-${currentValue}`,
            label: `当前值：${currentValue}`,
            value: currentValue
        })
    }

    return items
}

function prettyJson(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2)
    } catch (error) {
        return String(value)
    }
}

function getDebugOutputFinalTime(output: AlertpilotOutput[] | null): string {
    if (!output?.length) return ""

    return output.find(item => item?.specifiedDate)?.specifiedDate || ""
}

function handleUndo() {
    if (undoTextEditHistory()) return

    try {
        ; (globalThis as any).undo?.()
    } catch {
        // Native undo is only available when the current focused control supports it.
    }
}

function handleRedo() {
    if (redoTextEditHistory()) return

    try {
        ; (globalThis as any).redo?.()
    } catch {
        // Native redo is only available when the current focused control supports it.
    }
}

function undoRedoToolbarButtons(prefix: string) {
    return [
        <Button
            key={`${prefix}-undo`}
            title=""
            systemImage="arrow.uturn.backward"
            action={handleUndo}
        />,
        <Button
            key={`${prefix}-redo`}
            title=""
            systemImage="arrow.uturn.forward"
            action={handleRedo}
        />
    ]
}

function hideKeyboardToolbarButton(key = "hide-keyboard") {
    return (
        <Button
            key={key}
            title=""
            systemImage="keyboard.chevron.compact.down"
            action={() => Keyboard.hide()}
        />
    )
}

function keyboardEditingToolbarButtons(prefix: string) {
    return [
        <Spacer key={`${prefix}-keyboard-spacer`} />,
        ...undoRedoToolbarButtons(prefix),
        hideKeyboardToolbarButton(`${prefix}-hide-keyboard`)
    ]
}

function promptVariableInsertButtons(insertPromptVariable: (key: PromptExtraKey) => void) {
    return (
        <HStack>
            <Spacer />
            <Button
                title=""
                systemImage="list.bullet.rectangle"
                action={() => insertPromptVariable("listText")}
            />
            <Spacer />
            <Button
                title=""
                systemImage="textformat"
                action={() => insertPromptVariable("timeText")}
            />
            <Spacer />
            <Button
                title=""
                systemImage="clock"
                action={() => insertPromptVariable("currentTime")}
            />
            <Spacer />
            <Button
                title=""
                systemImage="calendar"
                action={() => insertPromptVariable("holidays")}
            />
            <Spacer />
            <Button
                title=""
                systemImage="globe"
                action={() => insertPromptVariable("webContent")}
            />
            <Spacer />
        </HStack>
    )
}

export default function ConfigEditorView() {
    const [config, setConfig] = useState<AlertpilotConfig | null>(null)
    const [savedConfig, setSavedConfig] = useState<AlertpilotConfig | null>(null)
    const [status, setStatus] = useState("正在读取配置…")
    const [isSaving, setIsSaving] = useState(false)
    const [pendingTimeRecords, setPendingTimeRecords] = useState<PendingTimeRecord[]>([])
    const dismiss = Navigation.useDismiss()

    async function load() {
        try {
            const loaded = await readConfig()
            const next = cloneConfig(loaded)
            setConfig(next)
            setSavedConfig(cloneConfig(next))
            setPendingTimeRecords([])
            setStatus("配置已载入")
        } catch (error) {
            setStatus("读取失败")
            await Dialog.alert({
                title: "读取失败",
                message: String(error)
            })
        }
    }

    async function persist(nextConfig: AlertpilotConfig, message = "配置已自动保存") {
        setConfig(nextConfig)
        setIsSaving(true)
        setStatus("正在保存…")

        try {
            await writeConfig(nextConfig)
            setSavedConfig(cloneConfig(nextConfig))
            setStatus(message)
        } catch (error) {
            setStatus("保存失败")
            await Dialog.alert({
                title: "保存失败",
                message: String(error)
            })
        } finally {
            setIsSaving(false)
        }
    }

    async function updateConfig(
        mutator: (draft: AlertpilotConfig) => void,
        message = "配置已自动保存"
    ): Promise<AlertpilotConfig | null> {
        if (!config) return null

        const draft = cloneConfig(config)
        mutator(draft)

        await persist(draft, message)
        return draft
    }

    function configWithPendingTimeRecords(source: AlertpilotConfig): AlertpilotConfig {
        const draft = cloneConfig(source)
        draft["时间"] = draft["时间"] || {}

        for (const item of pendingTimeRecords) {
            const finalKey = item.key.trim()
            if (!finalKey) continue

            const targetKey = finalKey in draft["时间"]
                ? uniqueRecordKey(draft, "时间", finalKey)
                : finalKey
            draft["时间"][targetKey] = item.value
        }

        return draft
    }

    async function manualSave() {
        if (!config) return

        const nextConfig = configWithPendingTimeRecords(config)
        await persist(nextConfig, "配置已手动保存")
        setPendingTimeRecords([])
    }

    async function closeEditor() {
        if (!config || !savedConfig || JSON.stringify(config) === JSON.stringify(savedConfig)) {
            dismiss()
            return
        }

        const action = await Dialog.actionSheet({
            title: "关闭设置页面？",
            message: "当前配置有未保存的修改。",
            actions: [
                { label: "保存并关闭" },
                { label: "不保存直接关闭", destructive: true }
            ]
        })

        if (action === 0) {
            await persist(configWithPendingTimeRecords(config), "配置已保存")
            setPendingTimeRecords([])
            dismiss()
        } else if (action === 1) {
            dismiss()
        }
    }

    async function exportConfig() {
        if (!config) return

        const text = JSON.stringify(config, null, 2)
        const now = new Date()
        const name =
            `Alertpilot-setting-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.json`

        try {
            const result = await DocumentPicker.exportFiles({
                files: [
                    {
                        data: Data.fromString(text)!,
                        name
                    }
                ]
            })

            setStatus(result?.length ? "配置已导出" : "已取消导出")
        } catch (error) {
            await Dialog.alert({
                title: "导出失败",
                message: String(error)
            })
        }
    }

    async function importConfig() {
        const confirmed = await Dialog.confirm({
            title: "导入配置",
            message: "导入会覆盖当前配置。建议先导出备份，是否继续？",
            cancelLabel: "取消",
            confirmLabel: "继续"
        })

        if (!confirmed) return

        try {
            const files = await DocumentPicker.pickFiles({
                types: ["public.json"],
                allowsMultipleSelection: false
            })

            if (!files || files.length === 0) {
                setStatus("已取消导入")
                return
            }

            const text = await FileManager.readAsString(files[0])
            const parsed = JSON.parse(text) as AlertpilotConfig

            await persist(parsed, "配置已导入并保存")
            setPendingTimeRecords([])
        } catch (error) {
            await Dialog.alert({
                title: "导入失败",
                message: String(error)
            })
        }
    }

    async function restoreDefault() {
        const confirmed = await Dialog.confirm({
            title: "恢复默认配置",
            message: "这会覆盖当前配置。建议先导出备份，是否继续？",
            cancelLabel: "取消",
            confirmLabel: "恢复"
        })

        if (!confirmed) return

        try {
            const restored = await resetConfig()
            const next = cloneConfig(restored)
            setConfig(next)
            setSavedConfig(cloneConfig(next))
            setPendingTimeRecords([])
            setStatus("已恢复默认配置")
        } catch (error) {
            await Dialog.alert({
                title: "恢复失败",
                message: String(error)
            })
        }
    }

    useEffect(() => {
        load()
    }, [])

    if (!config) {
        return (
            <NavigationStack>
                <List
                    navigationTitle="Alertpilot 配置"
                    navigationBarTitleDisplayMode="inline"
                >
                    <Text>{status}</Text>
                </List>
            </NavigationStack>
        )
    }

    return (
        <NavigationStack>
            <List
                navigationTitle="Alertpilot 配置"
                navigationBarTitleDisplayMode="inline"
                toolbar={{
                    topBarLeading: [
                        <Button
                            key="close"
                            title="关闭"
                            systemImage="xmark.circle"
                            action={closeEditor}
                        />,
                        <NavigationLink key="debug" destination={<DebugRunnerPage config={config} updateConfig={updateConfig} />}>
                            <Image systemName="ladybug.fill" />
                        </NavigationLink>
                    ],
                    keyboard: keyboardEditingToolbarButtons("config"),
                    topBarTrailing: [
                        <Button
                            key="import"
                            title=""
                            systemImage="square.and.arrow.down"
                            action={importConfig}
                        />,
                        <Button
                            key="export"
                            title=""
                            systemImage="square.and.arrow.up"
                            action={exportConfig}
                        />,
                        <Button
                            key="save"
                            title=""
                            systemImage="checkmark.circle"
                            action={manualSave}
                        />
                    ]
                }}
            >
                <Section header={<Text>基础参数</Text>}>
                    <DefaultConfigFields
                        config={config}
                        updateConfig={updateConfig}
                    />

                    <AiRuntimeConfigFields
                        config={config}
                        updateConfig={updateConfig}
                    />

                    <NavigationLink
                        destination={
                            <AiPromptEditorPage
                                config={config}
                                updateConfig={updateConfig}
                            />
                        }
                    >
                        <RowText
                            title="修改Alertpilot提示词"
                            value="进入编辑"
                            icon="text.quote"
                        />
                    </NavigationLink>

                    <NavigationLink
                        destination={
                            <UserPreferencesPage
                                config={config}
                                updateConfig={updateConfig}
                            />
                        }
                    >
                        <RowText
                            title="用户偏好与智能默认提醒"
                            value={userPreferenceSummary(config)}
                            icon="person.crop.circle.badge.checkmark"
                        />
                    </NavigationLink>

                    <StepperRow
                        title="节假日月数"
                        value={config.calendarAddNum}
                        min={1}
                        unit=" 个月"
                        icon="calendar.badge.plus"
                        onChanged={(value) => {
                            void (async () => {
                                const saved = await updateConfig(draft => {
                                    draft.calendarAddNum = value
                                    if (draft.userPreferences?.holidayCache) {
                                        draft.userPreferences.holidayCache = {
                                            ...draft.userPreferences.holidayCache,
                                            date: ""
                                        }
                                    }
                                }, "节假日月数已保存，正在刷新缓存")
                                if (saved) {
                                    await ensureHolidayCache(saved)
                                }
                            })()
                        }}
                    />

                    <StepperRow
                        title="网页超时时间"
                        value={config.timeOut}
                        min={1}
                        unit=" 秒"
                        icon="timer"
                        onChanged={(value) => {
                            void updateConfig(draft => {
                                draft.timeOut = value
                            }, "网页超时时间已保存")
                        }}
                    />

                    <Toggle
                        title="保存运行日志"
                        systemImage="doc.text"
                        value={config.saveLogs ?? true}
                        onChanged={(value) => {
                            void updateConfig(draft => {
                                draft.saveLogs = value
                            }, value ? "已开启保存运行日志" : "已关闭保存运行日志")
                        }}
                    />

                    <RowText
                        title="状态"
                        value={`${status}${isSaving ? "…" : ""}`}
                        icon="info.circle.fill"
                    />
                </Section>

                <RecordSection
                    title="提醒列表"
                    group="提醒列表"
                    config={config}
                    updateConfig={updateConfig}
                />

                <TimeCompletionSection
                    config={config}
                    updateConfig={updateConfig}
                />

                <RecordSection
                    title="附加时间"
                    group="附加时间"
                    config={config}
                    updateConfig={updateConfig}
                    sortValueNumericAsc
                />

                <TimeRecordSection
                    config={config}
                    updateConfig={updateConfig}
                    pendingRecords={pendingTimeRecords}
                    setPendingRecords={setPendingTimeRecords}
                    sortValueNumericAsc
                />

                <RecordSection
                    title="地点"
                    group="地点"
                    config={config}
                    updateConfig={updateConfig}
                />

                <AutoCompletionSection
                    config={config}
                    updateConfig={updateConfig}
                />

                <CollapsibleSection
                    title="危险操作"
                    summary="恢复默认配置"
                    icon="exclamationmark.triangle.fill"
                >
                    <HStack>
                        <Button
                            title="恢复默认配置"
                            systemImage="trash"
                            foregroundStyle="red"
                            action={restoreDefault}
                        />
                        <Spacer />
                        <Text
                            font="callout"
                            foregroundStyle="secondaryLabel"
                            multilineTextAlignment="trailing"
                        >
                            覆盖当前配置
                        </Text>
                    </HStack>
                </CollapsibleSection>
            </List>
        </NavigationStack>
    )
}

type PromptExtraKey = "listText" | "timeText" | "currentTime" | "holidays" | "webContent"

function promptExtraVariable(key: PromptExtraKey): string {
    return `\${${key}}`
}

function promptExtraIcon(title: string) {
    switch (title) {
        case "列表文本":
            return "list.bullet.rectangle"
        case "时间文本":
            return "textformat"
        case "当前时间":
            return "clock"
        case "近几个月节假日":
            return "calendar"
        case "网页内容":
            return "globe"
        default:
            return "info.circle"
    }
}

function PromptExtraDisclosure({
    title,
    variable,
    content
}: {
    title: string
    variable: string
    content: string
}) {
    return (
        <DisclosureGroup
            label={disclosureLabel(`${title}（${variable}）`, promptExtraIcon(title))}
        >
            <Markdown
                content={content || "暂无内容"}
                padding={{ leading: -10 }}
            />
        </DisclosureGroup>
    )
}

function AiPromptEditorPage({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    const [promptText, setPromptText] = useState(getAiPrompt(config))
    const holidayCache = config.userPreferences?.holidayCache
    const initialHolidayText = getHolidayCacheText(config) || `正在获取近${Math.max(1, Math.floor(Number(config.calendarAddNum) || 12))}个月节假日…`
    const [holidaysText, setHolidaysText] = useState(initialHolidayText)
    const [webUrl, setWebUrl] = useState("")
    const [webContentText, setWebContentText] = useState("请输入 URL 后刷新网页内容")
    const [copyStatus, setCopyStatus] = useState("")
    const dismiss = Navigation.useDismiss()

    const listText = recordEntries(config, "提醒列表").map(([, value]) => value).join("；")
    const timeText = Array.from(new Set([
        ...Object.keys(config["时间"] || {}),
        ...Object.keys(config["附加时间"] || {})
    ])).join("；")
    const currentTime = formatPromptDate()
    const holidayMonths = Math.max(1, Math.floor(Number(config.calendarAddNum) || 12))
    const mergedPromptText = fillPromptVariables(promptText, config, holidaysText, webContentText)

    useEffect(() => {
        const cache = config.userPreferences?.holidayCache
        const cacheText = getHolidayCacheText(config)
        if (cacheText) {
            setHolidaysText(cacheText)
        }
        if (cache?.date === todayKey() && Number(cache.months) === holidayMonths && cacheText) return

        setHolidaysText(`正在获取近${holidayMonths}个月节假日…`)
            ; (async () => {
                const nextConfig = await ensureHolidayCache(config)
                const text = getHolidayCacheText(nextConfig)
                if (text) {
                    setHolidaysText(text)
                    await updateConfig(draft => {
                        draft.userPreferences = {
                            ...(draft.userPreferences || DEFAULT_CONFIG.userPreferences!),
                            holidayCache: nextConfig.userPreferences?.holidayCache
                        }
                    }, "节假日缓存已更新")
                }
            })()
    }, [holidayMonths, holidayCache?.date, holidayCache?.months, holidayCache?.text])

    function promptExtraContent(key: PromptExtraKey) {
        switch (key) {
            case "listText":
                return listText
            case "timeText":
                return timeText
            case "currentTime":
                return currentTime
            case "holidays":
                return holidaysText
            case "webContent":
                return webContentText
        }
    }

    async function copyPromptExtraContent(key: PromptExtraKey) {
        await Pasteboard.setString(promptExtraContent(key))
        setCopyStatus(`已复制 ${promptExtraVariable(key)} 对应文本`)
    }

    async function refreshWebContent() {
        const url = webUrl.trim()
        if (!url) {
            setWebContentText("请输入 URL 后刷新网页内容")
            return
        }

        setWebContentText("正在获取网页内容…")
        const webPage = await getWebPageContent(url, config.timeOut || 5)
        setWebContentText(
            webPage.isAvailable
                ? webPage.markdown
                : `网页获取失败：${webPage.error || "未知错误"}`
        )
    }

    async function savePrompt() {
        const saved = await updateConfig(draft => {
            draft.aiPrompt = promptText
        }, "AI 提示词已保存")

        if (saved) {
            dismiss()
        }
    }

    async function resetPrompt() {
        const confirmed = await Dialog.confirm({
            title: "恢复默认提示词",
            message: "这会覆盖当前编辑内容，是否继续？",
            cancelLabel: "取消",
            confirmLabel: "恢复"
        })

        if (confirmed) {
            setPromptText(DEFAULT_CONFIG.aiPrompt || "")
        }
    }

    return (
        <List
            navigationTitle="Alertpilot 提示词"
            navigationBarTitleDisplayMode="inline"
            toolbar={{
                keyboard: keyboardEditingToolbarButtons("prompt"),
                topBarTrailing: [
                    <Button
                        key="reset"
                        title="默认"
                        systemImage="arrow.counterclockwise"
                        action={() => { void resetPrompt() }}
                    />,
                    <Button
                        key="save"
                        title="保存"
                        systemImage="checkmark.circle.fill"
                        action={() => { void savePrompt() }}
                    />
                ]
            }}
        >
            <Section header={<Text>提示词附加内容</Text>}>
                <PromptExtraDisclosure
                    title="列表文本"
                    variable={promptExtraVariable("listText")}
                    content={listText}
                />
                <PromptExtraDisclosure
                    title="时间文本"
                    variable={promptExtraVariable("timeText")}
                    content={timeText}
                />
                <PromptExtraDisclosure
                    title="当前时间"
                    variable={promptExtraVariable("currentTime")}
                    content={currentTime}
                />
                <DisclosureGroup
                    label={disclosureLabel(`近${holidayMonths}个月节假日（${promptExtraVariable("holidays")}）`, "calendar")}
                >
                    <Markdown
                        content={holidaysText}
                        padding={{ leading: -10 }}
                    />
                </DisclosureGroup>
                <DisclosureGroup
                    label={disclosureLabel(`网页内容（${promptExtraVariable("webContent")}）`, "globe")}
                >
                    <TextField
                        title="URL"
                        value={webUrl}
                        keyboardType="URL"
                        onChanged={setWebUrl}
                    />
                    <Button title="刷新网页内容" action={() => { void refreshWebContent() }} />
                    <Markdown
                        content={webContentText}
                        padding={{ leading: -10 }}
                    />
                </DisclosureGroup>
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    提示词文本框下方五个图标按钮会插入顶部五栏对应的占位符；变量替换只识别这五个 ASCII 占位符：${"${listText}"}、${"${timeText}"}、${"${currentTime}"}、${"${holidays}"}、${"${webContent}"}。
                </Text>
                {copyStatus ? (
                    <Text font="footnote" foregroundStyle="secondaryLabel">{copyStatus}</Text>
                ) : null}
            </Section>

            <Section header={<Text>整合后预览</Text>}>
                <NavigationLink
                    destination={
                        <AiPromptPreviewPage
                            content={mergedPromptText}
                            holidaysText={holidaysText}
                            webContentText={webContentText}
                        />
                    }
                >
                    <RowText
                        title="查看整合后的提示词"
                        value="Markdown 预览"
                        icon="doc.richtext"
                    />
                </NavigationLink>
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    会用当前编辑框内容和上方附加内容替换 ${"${listText}"}、${"${timeText}"}、${"${currentTime}"}、${"${holidays}"}、${"${webContent}"} 后再显示。
                </Text>
            </Section>

            <Section header={<Text>编辑提示词</Text>}>
                <TextField
                    title="提示词"
                    value={promptText}
                    onChanged={setPromptText}
                    axis="vertical"
                />
                {promptVariableInsertButtons(copyPromptExtraContent)}
            </Section>
        </List>
    )
}

function AiPromptPreviewPage({
    content,
    holidaysText,
    webContentText
}: {
    content: string
    holidaysText: string
    webContentText: string
}) {
    const [copyStatus, setCopyStatus] = useState("")

    async function copyMergedPrompt() {
        await Pasteboard.setString(content)
        setCopyStatus("已复制整合后的提示词")
    }

    return (
        <List
            navigationTitle="整合后提示词"
            navigationBarTitleDisplayMode="inline"
            toolbar={{
                topBarTrailing: (
                    <Button
                        title="复制"
                        systemImage="doc.on.doc"
                        action={() => { void copyMergedPrompt() }}
                    />
                )
            }}
        >
            <Section header={<Text>Markdown 预览</Text>}>
                <Markdown
                    content={content || "暂无提示词内容"}
                    padding={{ leading: -10 }}
                />
            </Section>
            <Section header={<Text>预览说明</Text>}>
                <RowText
                    title="字符数"
                    value={`${content.length}`}
                    icon="number"
                />
                <RowText
                    title="节假日内容"
                    value={holidaysText ? "已参与整合" : "为空"}
                    icon="calendar"
                />
                <RowText
                    title="网页内容"
                    value={webContentText ? "已参与整合" : "为空"}
                    icon="globe"
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    这里展示的是当前编辑页内存中的整合结果；如果你修改了提示词但尚未保存，也会按当前编辑内容预览。
                </Text>
                {copyStatus ? (
                    <Text font="footnote" foregroundStyle="secondaryLabel">{copyStatus}</Text>
                ) : null}
            </Section>
        </List>
    )
}

function DebugRunnerPage({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    const [debugInput, setDebugInput] = useState<DebugInputState>(() => cloneDebugInput(debugRunnerInputCache || defaultDebugInput))
    const [debugLogLevel, setDebugLogLevel] = useState<LogLevel>(normalizeLogLevel(config.logLevel || "trace"))
    const [saveDebugLogs, setSaveDebugLogs] = useState(false)
    const [isRunning, setIsRunning] = useState(false)
    const [lastOutput, setLastOutput] = useState<AlertpilotOutput[] | AlertpilotActionResult | null>(null)
    const [logs, setLogs] = useState<string[]>(["调试页已载入，等待运行。"])

    useEffect(() => {
        debugRunnerInputCache = cloneDebugInput(debugInput)
    }, [debugInput])

    function addLog(message: string, detail?: unknown, level: LogLevel = "info", force = false) {
        if (!force && !shouldLogLevel(level, debugLogLevel)) return

        const time = new Date().toLocaleString()
        const line = detail === undefined
            ? `[${time}] ${message}`
            : typeof detail === "string"
                ? `[${time}] ${message}\n${detail}`
                : `[${time}] ${message}\n${prettyJson(detail)}`

        console.log(line)
        setLogs(current => [line, ...current].slice(0, 200))
    }

    function updateShortcutInput(key: keyof DebugInputState["shortcutInput"], value: string) {
        setDebugInput(current => ({
            ...current,
            shortcutInput: {
                ...current.shortcutInput,
                [key]: value
            }
        }))
    }

    function updateUseAiInput(value: boolean) {
        if (debugInput.debugMode === "rescheduleReminder") {
            addLog("重排模式固定复用脚本内部时间解析，不使用创建提醒的 AI 输入区。")
            return
        }
        setDebugInput(current => ({
            ...current,
            useAiInput: value
        }))
        addLog(value ? "已开启使用内置 AI 输入，调试运行将按 shortcutInput 自动调用 Assistant。" : "已关闭使用内置 AI 输入，调试运行将使用下方手动填写的 ai 字段。")
    }

    function updateDebugMode(value: DebugMode) {
        setDebugInput(current => ({
            ...current,
            debugMode: value,
            useAiInput: value === "createReminder" ? current.useAiInput : false
        }))
        setLastOutput(null)
        addLog(value === "createReminder" ? "已切换到创建提醒调试模式" : "已切换到重排提醒调试模式")
    }

    function updateApplyReschedule(value: boolean) {
        setDebugInput(current => ({
            ...current,
            applyReschedule: value
        }))
        addLog(value ? "已开启真实重排，运行时会实际修改提醒时间" : "已关闭真实重排，运行时仅测试匹配与解析，不执行修改")
    }

    function updateAiInput<K extends keyof DebugInputState["ai"]>(key: K, value: DebugInputState["ai"][K]) {
        setDebugInput(current => ({
            ...current,
            ai: {
                ...current.ai,
                [key]: value
            }
        }))
    }

    function updateTimeWordPart(part: keyof TimeWordParts, value: string) {
        const current = splitTimeWord(config, debugInput.ai.timeWord)
        const next = {
            ...current,
            [part]: value
        }

        updateAiInput("timeWord", `${next.otherTime}${next.time}`)
    }

    async function importFromPasteboard() {
        try {
            addLog("正在读取剪切板…")
            const text = await Pasteboard.getString()

            if (!text) {
                addLog("剪切板为空，未导入")
                await Dialog.alert({
                    title: "剪切板为空",
                    message: "没有读取到可用文本。"
                })
                return
            }

            addLog("已读取剪切板文本", text)
            const parsed = parseDebugJsonText(text)
            const next = debugInputFromValue(parsed)

            setDebugInput(next)
            setLastOutput(null)
            addLog("已从剪切板导入调试参数并刷新界面", next)
        } catch (error) {
            const message = String((error as any)?.message || error)
            addLog("从剪切板导入失败", message)
            await Dialog.alert({
                title: "导入失败",
                message: `剪切板内容不是可识别的调试 JSON。\n${message}`
            })
        }
    }

    async function runDebug() {
        const input = buildDebugInput(debugInput)
        const startedAt = Date.now()

        setIsRunning(true)
        setLastOutput(null)
        addLog(
            saveDebugLogs ? `开始调试运行，保存日志，等级 ${logLevelLabel(debugLogLevel)}` : `开始调试运行，不保存日志，等级 ${logLevelLabel(debugLogLevel)}`,
            summarizeInput(input),
            "debug"
        )

        try {
            if (debugInput.debugMode === "createReminder" && debugInput.useAiInput && !Assistant.isAvailable) {
                throw new Error([
                    "Scripting Assistant 当前不可用，调试运行无法使用内置 AI 自动生成 ai 字段。",
                    "",
                    "可选处理方式：",
                    "1. 先在 Scripting 中配置并启用 Assistant；",
                    "2. 关闭上方“使用内置 AI 输入”，手动填写下方 ai 字段后运行；",
                    "3. 如果使用指定供应商/模型，请在配置页关闭“使用内置 AI”后选择 Assistant 供应商/模型。"
                ].join("\n"))
            }

            const runtimeLogs: any[] = []
            let output: AlertpilotOutput[] | AlertpilotActionResult

            if (debugInput.debugMode === "createReminder") {
                addLog("调用 runAlertpilot，开始整合脚本运行日志", undefined, "debug")
                output = await runAlertpilot(input, {
                    saveLogs: saveDebugLogs,
                    logLevel: debugLogLevel,
                    onLog: (entry: unknown) => {
                        runtimeLogs.push(entry)
                        addLog("脚本运行日志", formatRuntimeLogEntry(entry), runtimeLogLevel(entry))
                    }
                })
            } else {
                addLog(debugInput.applyReschedule ? "调用 runRescheduleReminder，将实际修改提醒时间" : "调用 runRescheduleReminder，仅测试匹配与解析，不会实际修改提醒", undefined, "debug")
                output = await runRescheduleReminder(input)
                if (!debugInput.applyReschedule) {
                    output = {
                        ...output,
                        status: output.status === "success" ? "needsConfirmation" : output.status,
                        ok: output.status === "error" ? output.ok : true,
                        message: [
                            "当前为测试模式：以下结果未实际写入提醒。",
                            output.message || ""
                        ].filter(Boolean).join("\n")
                    }
                }
            }
            const elapsed = Date.now() - startedAt

            setLastOutput(output)

            if (runtimeLogs.length) {
                addLog("脚本运行日志汇总", summarizeRuntimeLogs(runtimeLogs), "debug")
            }
            addLog(`调试运行完成，用时 ${elapsed}ms`, Array.isArray(output) ? output.map(summarizeOutput) : output, "debug")
        } catch (error) {
            const elapsed = Date.now() - startedAt
            const message = String((error as any)?.stack || (error as any)?.message || error)

            addLog(`调试运行失败，用时 ${elapsed}ms`, message, "error")
            await Dialog.alert({
                title: "调试失败",
                message
            })
        } finally {
            setIsRunning(false)
        }
    }

    async function fillAiInputByModel() {
        const rawText = debugInput.shortcutInput.rawText || debugInput.ai.rawText || debugInput.shortcutInput.webTitle
        const shortcutInput = {
            ...debugInput.shortcutInput,
            rawText: debugInput.shortcutInput.rawText || debugInput.ai.rawText
        }
        const url = debugInput.ai.url || shortcutInput.inputUrl || extractUrl(rawText)

        setIsRunning(true)
        addLog("开始调用 AI 自动填写字段")

        try {
            if (!Assistant.isAvailable) {
                throw new Error([
                    "Scripting Assistant 当前不可用，无法自动填写 ai 字段。",
                    "请先在 Scripting 中配置并启用 Assistant，或手动填写 ai 字段后关闭“使用内置 AI 输入”。"
                ].join("\n"))
            }

            const holidays = await getCachedHolidayText(config)
            const isWeb = Boolean(url && /^https?:\/\//i.test(url))
            const webPage = isWeb ? await getWebPageContent(url, config.timeOut || 5, shortcutInput.webTitle || "") : null
            if (isWeb && webPage && !webPage.isAvailable) {
                throw new Error(`网页获取失败：${webPage.error || "未知错误"}`)
            }
            const webContent = webPage?.isAvailable ? webPage.markdown : ""
            const instructions = fillPromptVariables(getAiPrompt(config), config, holidays, webContent)
            const prompt = buildAiUserPrompt(shortcutInput, rawText, isWeb ? undefined : config)
            const items = await requestAiGeneratedItems(prompt, instructions, config)
            const first = Array.isArray(items) ? items[0] : null

            if (!first) {
                throw new Error("AI 未返回可用 JSON 数组")
            }

            setDebugInput(current => ({
                ...current,
                useAiInput: false,
                ai: {
                    ...current.ai,
                    // rawText: String(first.rawText ?? current.ai.rawText ?? rawText ?? ""),
                    text: String(first.text ?? current.ai.text ?? ""),
                    isSummary: Boolean(first.isSummary),
                    classReminders: String(first.classReminders ?? current.ai.classReminders ?? ""),
                    timeWord: String(first.timeWord ?? current.ai.timeWord ?? ""),
                    note: String(first.note ?? current.ai.note ?? ""),
                    url: String(first.url ?? current.ai.url ?? "")
                }
            }))
            setLastOutput(null)
            addLog("AI 自动填写完成", first)
        } catch (error) {
            const message = String((error as any)?.message || error)
            addLog("AI 自动填写失败", message, "error")
            await Dialog.alert({
                title: "AI 自动填写失败",
                message
            })
        } finally {
            setIsRunning(false)
        }
    }

    async function copyLogLine(line: string) {
        await Pasteboard.setString(line)
        addLog("已复制日志内容到剪切板")
    }

    async function updateDebugLogLevel(value: LogLevel) {
        const nextLevel = normalizeLogLevel(value)
        setDebugLogLevel(nextLevel)
        const saved = await updateConfig(draft => {
            draft.logLevel = nextLevel
        }, `日志等级已保存：${logLevelLabel(nextLevel)}`)
        addLog(saved ? `调试日志等级已切换并保存为：${logLevelLabel(nextLevel)}` : `调试日志等级已切换为：${logLevelLabel(nextLevel)}，但保存失败`, undefined, nextLevel, true)
    }

    function updateSaveDebugLogs(value: boolean) {
        setSaveDebugLogs(value)
        addLog(value ? "已开启调试日志保存（仅本次调试页生效，不修改配置页开关）" : "已关闭调试日志保存（仅本次调试页生效，不修改配置页开关）")
    }

    function resetDebugInput() {
        const next = cloneDebugInput(defaultDebugInput)
        setDebugInput(next)
        setLastOutput(null)
        addLog("已重置为默认调试参数", next)
    }

    return (
        <List
            navigationTitle="调试"
            navigationBarTitleDisplayMode="inline"
            toolbar={{
                keyboard: keyboardEditingToolbarButtons("debug"),
                topBarLeading: [
                    <Button
                        key="pasteboard"
                        title=""
                        systemImage="doc.on.clipboard"
                        action={() => { void importFromPasteboard() }}
                    />
                ],
                topBarTrailing: [
                    <Button
                        key="fill-ai"
                        title=""
                        systemImage="sparkles"
                        action={() => { void fillAiInputByModel() }}
                    />,
                    <Button
                        key="reset"
                        title=""
                        systemImage="arrow.counterclockwise"
                        action={resetDebugInput}
                    />,
                    <Button
                        key="run"
                        title={isRunning ? "运行中" : "运行"}
                        systemImage="play.circle.fill"
                        action={() => {
                            void runDebug()
                        }}
                    />
                ]
            }}
        >
            <Section header={<Text>调试模式</Text>}>
                <Picker
                    title="模式"
                    systemImage="square.grid.2x2"
                    value={debugInput.debugMode}
                    onChanged={(value: string | number) => updateDebugMode(String(value) as DebugMode)}
                >
                    <Text tag="createReminder">创建提醒</Text>
                    <Text tag="rescheduleReminder">重排提醒</Text>
                </Picker>
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    创建模式沿用原来的调试逻辑；重排模式用于测试提醒查找、时间解析与实际重排。
                </Text>
            </Section>

            <Section header={<Text>shortcutInput</Text>}>
                {debugInput.debugMode === "createReminder" ? (
                    <>
                        <TextField
                            title="webTitle"
                            value={debugInput.shortcutInput.webTitle}
                            axis="vertical"
                            onChanged={value => updateShortcutInput("webTitle", value)}
                        />
                        <TextField
                            title="rawText"
                            value={debugInput.shortcutInput.rawText}
                            axis="vertical"
                            onChanged={value => updateShortcutInput("rawText", value)}
                        />
                        <TextField
                            title="inputUrl"
                            value={debugInput.shortcutInput.inputUrl}
                            onChanged={value => updateShortcutInput("inputUrl", value)}
                            keyboardType="URL"
                        />
                    </>
                ) : (
                    <>
                        <TextField
                            title="rawText"
                            value={debugInput.shortcutInput.rawText}
                            axis="vertical"
                            onChanged={value => updateShortcutInput("rawText", value)}
                        />
                        <Text font="footnote" foregroundStyle="secondaryLabel">
                            这里只需要一句自然语言，例如：把周报改到周五下午三点。
                        </Text>
                    </>
                )}
            </Section>

            {debugInput.debugMode === "createReminder" ? (
                <Section header={<Text>ai（兼容外置 AI / 自动填写结果）</Text>}>
                <Toggle
                    title="使用内置 AI 输入"
                    systemImage="switch.2"
                    value={debugInput.useAiInput}
                    onChanged={updateUseAiInput}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    开启后调试运行会使用内置 AI 按 shortcutInput 自动处理，并隐藏下方手动输入区；关闭后显示下方输入区，并使用手动填写的 ai 字段处理。
                </Text>
                {!debugInput.useAiInput ? (
                    <>
                        {/*
                        <TextField
                            title="rawText"
                            value={debugInput.ai.rawText}
                            axis="vertical"
                            onChanged={value => updateAiInput("rawText", value)}
                        />
                        */}
                        <Picker
                            title="timeWord 附加时间"
                            systemImage="calendar.badge.clock"
                            value={splitTimeWord(config, debugInput.ai.timeWord).otherTime}
                            onChanged={(value: string) => updateTimeWordPart("otherTime", value)}
                        >
                            {["", ...Object.keys(config["附加时间"] || {})].map(value => (
                                <Text key={`debug-time-word-other-${value || "empty"}`} tag={value}>{value || "空"}</Text>
                            ))}
                        </Picker>
                        <Picker
                            title="timeWord 时间"
                            systemImage="clock"
                            value={splitTimeWord(config, debugInput.ai.timeWord).time}
                            onChanged={(value: string) => updateTimeWordPart("time", value)}
                        >
                            {["", ...Object.keys(config["时间"] || {})].map(value => (
                                <Text key={`debug-time-word-time-${value || "empty"}`} tag={value}>{value || "空"}</Text>
                            ))}
                        </Picker>
                        <TextField
                            title="timeWord 手动输入"
                            value={debugInput.ai.timeWord}
                            onChanged={value => updateAiInput("timeWord", value)}
                        />
                        <Picker
                            title="提示列表"
                            systemImage="list.bullet.rectangle"
                            value={debugInput.ai.classReminders}
                            onChanged={(value: string) => updateAiInput("classReminders", value)}
                        >
                            {classReminderOptions(config, debugInput.ai.classReminders).map(item => (
                                <Text key={`debug-class-reminders-${item.key}`} tag={item.value}>{item.label}</Text>
                            ))}
                        </Picker>
                        <TextField
                            title="text"
                            value={debugInput.ai.text}
                            onChanged={value => updateAiInput("text", value)}
                        />
                        <Toggle
                            title="总结"
                            value={debugInput.ai.isSummary}
                            onChanged={value => updateAiInput("isSummary", value)}
                        />
                        <TextField
                            title="note"
                            value={debugInput.ai.note}
                            onChanged={value => updateAiInput("note", value)}
                        />
                        <TextField
                            title="url"
                            value={debugInput.ai.url}
                            onChanged={value => updateAiInput("url", value)}
                            keyboardType="URL"
                        />
                    </>
                ) : null}
                </Section>
            ) : (
                <Section header={<Text>重排测试</Text>}>
                    <Toggle
                        title="真实执行重排"
                        systemImage="arrow.triangle.2.circlepath"
                        value={debugInput.applyReschedule}
                        onChanged={updateApplyReschedule}
                    />
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                        关闭时只测试自然语言解析、提醒查找与返回结构；开启后会真正修改提醒时间。
                    </Text>
                </Section>
            )}

            <Section header={<Text>操作</Text>}>
                <Picker
                    title="日志等级"
                    systemImage="line.3.horizontal.decrease.circle"
                    value={debugLogLevel}
                    onChanged={(value: string | number) => { void updateDebugLogLevel(String(value) as LogLevel) }}
                >
                    {logLevelOptions().map(item => (
                        <Text key={`debug-log-level-${item.value}`} tag={item.value}>{item.label}</Text>
                    ))}
                </Picker>
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    Trace 会显示 AI 输出、脚本匹配、时间转换和最终输出；Debug 会额外显示旧式内部调试日志；Info 只保留关键流程。
                </Text>

                <Toggle
                    title="日志保存"
                    systemImage="doc.text"
                    value={saveDebugLogs}
                    onChanged={value => {
                        updateSaveDebugLogs(value)
                    }}
                />

                {debugInput.debugMode === "createReminder" ? (
                    <>
                        <Toggle
                            title="画像分析"
                            systemImage="brain"
                            value={debugInput.useProfileAnalysis}
                            onChanged={value => {
                                setDebugInput(current => ({
                                    ...current,
                                    useProfileAnalysis: value
                                }))
                                addLog(value ? "已开启调试分析使用用户画像" : "已关闭调试分析使用用户画像")
                            }}
                        />

                        <Toggle
                            title="画像记忆"
                            systemImage="square.and.arrow.down"
                            value={debugInput.saveToAutoMemory}
                            onChanged={value => {
                                setDebugInput(current => ({
                                    ...current,
                                    saveToAutoMemory: value
                                }))
                                addLog(value ? "已开启调试结果写入自动记忆" : "已关闭调试结果写入自动记忆")
                            }}
                        />
                    </>
                ) : (
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                        重排模式不会使用画像分析，也不会写入画像记忆。
                    </Text>
                )}
            </Section>

            <Section header={<Text>当前组装输入</Text>}>
                <Text font="footnote">{prettyJson(buildDebugInput(debugInput))}</Text>
            </Section>

            <Section header={<Text>输出结果</Text>}>
                <Text font="footnote">{lastOutput ? prettyJson(lastOutput) : "尚未运行"}</Text>
            </Section>

            <Section header={<Text>详细日志</Text>}>
                <HStack>
                    <Button
                        title="清除当前日志"
                        systemImage="trash"
                        action={() => setLogs(["当前日志已清除。"])}
                    />
                    <Text font="footnote" foregroundStyle="secondaryLabel">
                        仅清空本页日志
                    </Text>
                </HStack>
                {logs.map((line, index) => (
                    <Button
                        key={`debug-log-${index}`}
                        title={line}
                        action={() => { void copyLogLine(line) }}
                    />
                ))}
            </Section>
        </List>
    )
}

function logLevelLabel(level?: LogLevel | string): string {
    switch (level) {
        case "error":
            return "Error｜只看错误"
        case "warn":
            return "Warn｜错误和警告"
        case "info":
            return "Info｜关键流程"
        case "debug":
            return "Debug｜更多调试"
        case "trace":
            return "Trace｜AI/匹配/转换链路"
        default:
            return "Info｜关键流程"
    }
}

function logLevelOptions(): { value: LogLevel; label: string }[] {
    return [
        { value: "error", label: "Error｜只看错误" },
        { value: "warn", label: "Warn｜错误和警告" },
        { value: "info", label: "Info｜关键流程" },
        { value: "debug", label: "Debug｜更多调试" },
        { value: "trace", label: "Trace｜AI/匹配/转换链路" }
    ]
}

function formatRuntimeLogEntry(entry: unknown): string {
    if (!entry || typeof entry !== "object") {
        return prettyJson(entry)
    }

    const candidate = entry as Partial<StructuredLogEntry>
    if (candidate.level && candidate.stage && candidate.message) {
        return formatConsoleLog(candidate as StructuredLogEntry, 140)
    }

    return prettyJson(entry)
}

function runtimeLogLevel(entry: unknown): LogLevel {
    if (entry && typeof entry === "object") {
        const level = (entry as Partial<StructuredLogEntry>).level
        if (typeof level === "string") return normalizeLogLevel(level)
    }

    return "info"
}

function summarizeRuntimeLogs(entries: unknown[]): string {
    if (!entries.length) return "暂无脚本运行日志"

    const items = entries
        .slice(-12)
        .map(entry => formatRuntimeLogEntry(entry))

    return [
        `共 ${entries.length} 条，最近 ${items.length} 条：`,
        ...items.map(item => `- ${item}`)
    ].join("\n")
}

function userPreferenceSummary(config: AlertpilotConfig): string {
    const p = config.userPreferences || DEFAULT_CONFIG.userPreferences!
    return p.enabled
        ? `${formatTimeLabel(p.workStart)}-${formatTimeLabel(p.workEnd)} / 日常 ${formatTimeLabel(p.dailyTaskStart)}-${formatTimeLabel(p.dailyTaskEnd)} / ${p.autoLearn ? "自学习开" : "自学习关"}`
        : "已关闭"
}

function formatTimeLabel(value?: string): string {
    const digits = normalizeTimeDigits(value)
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`
}

type LearningSlotKey = "morning" | "work" | "evening" | "rest" | "weekend"

type LearningEntryItem = {
    id: string
    category: string
    sourceCategories: string[]
    stat: UserPreferenceLearningStat
}

type LearningMode = "task" | "list"

const learningSlotKeys: LearningSlotKey[] = ["morning", "work", "evening", "rest", "weekend"]

function taskLearningLabel(category: string): string {
    switch (category) {
        case "work":
            return "工作"
        case "shopping":
            return "购物/下单"
        case "housework":
            return "家务/整理"
        case "study":
            return "学习/阅读"
        case "health":
            return "运动/健康"
        case "relationship":
            return "人际/家人朋友"
        case "finance":
            return "财务/账单"
        case "leisure":
            return "娱乐/旅行"
        case "general":
            return "一般事项"
        default:
            return category || "未分类"
    }
}

function learningCategoryLabel(category: string, config?: AlertpilotConfig, mode: LearningMode = "task"): string {
    if (mode === "list") {
        const normalized = config ? normalizeReminderListCategory(category, config) : category
        const listAlias = config
            ? Object.entries(config["提醒列表"] || {}).find(([, value]) => value === normalized)?.[0]
            : ""
        if (listAlias && listAlias !== "默认") return `${listAlias}（${normalized}）`
        if (normalized !== category) return normalized
        return category || "未分类"
    }

    return taskLearningLabel(category)
}

function learningSlotLabel(slot: LearningSlotKey): string {
    switch (slot) {
        case "morning":
            return "早晨"
        case "work":
            return "工作时间"
        case "evening":
            return "晚上"
        case "rest":
            return "休息时间"
        case "weekend":
            return "休息日"
    }
}

function normalizeLearningStat(stat?: UserPreferenceLearningStat): Required<UserPreferenceLearningStat> {
    return {
        morning: Math.max(0, Number(stat?.morning || 0)),
        work: Math.max(0, Number(stat?.work || 0)),
        evening: Math.max(0, Number(stat?.evening || 0)),
        rest: Math.max(0, Number(stat?.rest || 0)),
        weekend: Math.max(0, Number(stat?.weekend || 0)),
        total: Math.max(0, Number(stat?.total || 0))
    }
}

function learningStatTotal(stat?: UserPreferenceLearningStat): number {
    const normalized = normalizeLearningStat(stat)
    const slotSum = learningSlotKeys.reduce((sum, key) => sum + Number(normalized[key] || 0), 0)
    return Math.max(Number(normalized.total || 0), slotSum)
}

function mergeLearningStat(a?: UserPreferenceLearningStat, b?: UserPreferenceLearningStat): Required<UserPreferenceLearningStat> {
    const left = normalizeLearningStat(a)
    const right = normalizeLearningStat(b)
    return {
        morning: left.morning + right.morning,
        work: left.work + right.work,
        evening: left.evening + right.evening,
        rest: left.rest + right.rest,
        weekend: left.weekend + right.weekend,
        total: learningStatTotal(left) + learningStatTotal(right)
    }
}

function learningEntriesFromConfig(config: AlertpilotConfig, mode: LearningMode = "task"): LearningEntryItem[] {
    const learning = mode === "list"
        ? (config.userPreferences?.learningByList || {})
        : (config.userPreferences?.learning || {})
    const grouped: Record<string, LearningEntryItem> = {}

    for (const [rawCategory, stat] of Object.entries(learning)) {
        const category = mode === "list" ? normalizeReminderListCategory(rawCategory, config) : rawCategory
        const current = grouped[category]
        grouped[category] = {
            id: `learning-${mode}-${category}`,
            category,
            sourceCategories: current ? [...current.sourceCategories, rawCategory] : [rawCategory],
            stat: current ? mergeLearningStat(current.stat, stat) : normalizeLearningStat(stat)
        }
    }

    return Object.values(grouped)
        .sort((a, b) => learningStatTotal(b.stat) - learningStatTotal(a.stat))
}

function learningBestSlotLabel(stat?: UserPreferenceLearningStat): string {
    const normalized = normalizeLearningStat(stat)
    const best = learningSlotKeys
        .map(slot => ({ slot, count: Number(normalized[slot] || 0) }))
        .sort((a, b) => b.count - a.count)[0]

    return best && best.count > 0 ? `${learningSlotLabel(best.slot)} ${best.count}` : "暂无偏好"
}

function learningSummaryText(config: AlertpilotConfig): string {
    const taskEntries = learningEntriesFromConfig(config, "task")
    const listEntries = learningEntriesFromConfig(config, "list")
    const taskTotal = taskEntries.reduce((sum, item) => sum + learningStatTotal(item.stat), 0)
    const listTotal = listEntries.reduce((sum, item) => sum + learningStatTotal(item.stat), 0)
    return `任务 ${taskTotal} 次/${taskEntries.length} 类；列表 ${listTotal} 次/${listEntries.length} 个`
}

function lightLearningSummary(config: AlertpilotConfig): { text: string; total: number } {
    const taskLearning = config.userPreferences?.learning || {}
    const listLearning = config.userPreferences?.learningByList || {}
    let taskTotal = 0
    let listTotal = 0

    for (const stat of Object.values(taskLearning)) {
        taskTotal += learningStatTotal(stat)
    }
    for (const stat of Object.values(listLearning)) {
        listTotal += learningStatTotal(stat)
    }

    return {
        text: `任务 ${taskTotal} 次/${Object.keys(taskLearning).length} 类；列表 ${listTotal} 次/${Object.keys(listLearning).length} 个`,
        total: taskTotal + listTotal
    }
}

type SimpleTaskPreferenceDraft = {
    id: string
    typeId: string
    title: string
    icon: string
    mode: SimpleTaskPreferenceMode
    time: string
    specifiedTimes: string[]
    specifiedDayConstraint: SpecifiedDayConstraint
    workDayTimes?: string[]
    restDayTimes?: string[]
    isCustom: boolean
}

type SimpleTaskTypeOption = {
    id: string
    label: string
    icon: string
}

const simpleTaskTypeOptions: SimpleTaskTypeOption[] = [
    { id: "general", label: "一般", icon: "tray" },
    { id: "shopping", label: "购物", icon: "cart" },
    { id: "housework", label: "家务", icon: "house" },
    { id: "study", label: "学习", icon: "book" },
    { id: "reading", label: "阅读", icon: "book.pages" },
    { id: "exercise", label: "运动", icon: "figure.run" },
    { id: "health", label: "健康", icon: "heart" },
    { id: "work", label: "工作", icon: "briefcase" },
    { id: "social", label: "社交", icon: "person.2" },
    { id: "date", label: "约会", icon: "heart.circle" },
    { id: "finance", label: "财务", icon: "creditcard" },
    { id: "leisure", label: "休闲", icon: "gamecontroller" },
    { id: "food", label: "饮食", icon: "fork.knife" },
    { id: "medicine", label: "用药", icon: "pills" },
    { id: "phone", label: "电话", icon: "phone" },
    { id: "document", label: "文档", icon: "doc.text" },
    { id: "important", label: "重要", icon: "star" },
    { id: "reminder", label: "提醒", icon: "bell" }
]

function simpleTaskTypeOption(typeIdOrTitle?: string): SimpleTaskTypeOption {
    const value = String(typeIdOrTitle || "").trim()
    return simpleTaskTypeOptions.find(option => option.id === value || option.label === value) || simpleTaskTypeOptions[0]
}

function fixedGeneralTaskOption(): SimpleTaskTypeOption {
    return { id: "general", label: "一般", icon: "tray" }
}

const defaultSimpleTaskPreferenceRows: Array<{
    id: string
    typeId: string
    modeKey: "shoppingMode" | "houseworkMode" | "studyMode" | "exerciseMode" | "generalMode"
    timeKey: "shoppingTime" | "houseworkTime" | "studyPreferredTime" | "exercisePreferredTime" | "generalPreferredTime"
    defaultMode: SimpleTaskPreferenceMode
    defaultTime: string
}> = [
    { id: "simple-general", typeId: "general", modeKey: "generalMode", timeKey: "generalPreferredTime", defaultMode: "any", defaultTime: "2000" },
    { id: "simple-shopping", typeId: "shopping", modeKey: "shoppingMode", timeKey: "shoppingTime", defaultMode: "any", defaultTime: "2000" },
    { id: "simple-housework", typeId: "housework", modeKey: "houseworkMode", timeKey: "houseworkTime", defaultMode: "any", defaultTime: "2000" },
    { id: "simple-study", typeId: "study", modeKey: "studyMode", timeKey: "studyPreferredTime", defaultMode: "specified", defaultTime: "2100" },
    { id: "simple-reading", typeId: "reading", modeKey: "studyMode", timeKey: "studyPreferredTime", defaultMode: "specified", defaultTime: "2100" },
    { id: "simple-exercise", typeId: "exercise", modeKey: "exerciseMode", timeKey: "exercisePreferredTime", defaultMode: "specified", defaultTime: "1930" },
    { id: "simple-health", typeId: "health", modeKey: "exerciseMode", timeKey: "exercisePreferredTime", defaultMode: "specified", defaultTime: "1930" },
    { id: "simple-date", typeId: "date", modeKey: "exerciseMode", timeKey: "exercisePreferredTime", defaultMode: "specified", defaultTime: "1900" }
]

function normalizedSpecifiedTimes(time?: string, times?: string[]): string[] {
    const values = (times && times.length > 0 ? times : [time || "2000"])
        .map(item => normalizeTimeDigits(item))
        .filter(Boolean)
    return values.length > 0 ? values : [normalizeTimeDigits("2000")]
}

function simpleTaskModeLabel(mode?: string, time?: string, specifiedTimes?: string[], specifiedDayConstraint?: SpecifiedDayConstraint, workDayTimes?: string[], restDayTimes?: string[]): string {
    switch (mode) {
        case "work":
            return "工作时间"
        case "restTime":
        case "evening":
            return "休息时间"
        case "restDay":
        case "weekend":
            return "休息日"
        case "specified": {
            if (specifiedDayConstraint === "split") {
                const workLabels = (workDayTimes || [normalizeTimeDigits(time || "2000")]).map(formatTimeLabel)
                const restLabels = (restDayTimes || [normalizeTimeDigits(time || "2000")]).map(formatTimeLabel)
                return `工作日 ${workLabels.join("、")}；休息日 ${restLabels.join("、")}`
            }
            const labels = normalizedSpecifiedTimes(time, specifiedTimes).map(formatTimeLabel)
            const dayPrefix = specifiedDayConstraint === "work"
                ? "工作日指定时间"
                : specifiedDayConstraint === "rest"
                    ? "休息日指定时间"
                    : "指定时间"
            return `${dayPrefix} ${labels.join("、")}`
        }
        default:
            return "任何时间"
    }
}

function simpleTaskPreferenceDrafts(preferences: NonNullable<AlertpilotConfig["userPreferences"]>): SimpleTaskPreferenceDraft[] {
    const stored = preferences.simpleTaskPreferences || []
    const hiddenIds = new Set((preferences.hiddenSimpleTaskIds || []).filter(id => id !== "simple-general"))
    const storedById = new Map(stored.map(item => [item.id, item]))
    const defaults = defaultSimpleTaskPreferenceRows
        .filter(item => !hiddenIds.has(item.id))
        .map(item => {
            const saved = storedById.get(item.id)
            const option = item.id === "simple-general"
                ? { id: "general", label: "一般", icon: "tray" }
                : simpleTaskTypeOption(saved?.typeId || item.typeId)
            return {
                id: item.id,
                typeId: option.id,
                title: option.label,
                icon: option.icon,
                mode: (saved?.mode || preferences[item.modeKey] || item.defaultMode) as SimpleTaskPreferenceMode,
                time: String(saved?.time || preferences[item.timeKey] || item.defaultTime),
                specifiedTimes: normalizedSpecifiedTimes(saved?.time || preferences[item.timeKey] || item.defaultTime, saved?.specifiedTimes),
                specifiedDayConstraint: saved?.specifiedDayConstraint || "any",
                workDayTimes: saved?.workDayTimes,
                restDayTimes: saved?.restDayTimes,
                isCustom: false
            }
        })
    const customs = (preferences.customSimpleTasks || []).map((item, index) => {
        const option = simpleTaskTypeOption((item as any).typeId || item.title)
        return {
            id: String(item.id || `custom-${index}`),
            typeId: option.id,
            title: option.label,
            icon: option.icon,
            mode: item.mode || "any",
            time: item.time || "2000",
            specifiedTimes: normalizedSpecifiedTimes(item.time || "2000", item.specifiedTimes),
            specifiedDayConstraint: item.specifiedDayConstraint || "any",
            workDayTimes: item.workDayTimes,
            restDayTimes: item.restDayTimes,
            isCustom: true
        }
    })
    return [...defaults, ...customs]
}

type CustomSimpleTaskPreference = NonNullable<NonNullable<AlertpilotConfig["userPreferences"]>["customSimpleTasks"]>[number]

function SimpleTaskPreferenceRow({
    item,
    onTypeChanged,
    onModeChanged,
    onTimeChanged,
    onSpecifiedTimesChanged,
    onSpecifiedDayConstraintChanged,
    onWorkDayTimesChanged,
    onRestDayTimesChanged,
    fixedType = false
}: {
    item: SimpleTaskPreferenceDraft
    onTypeChanged: (value: string) => void
    onModeChanged: (value: string) => void
    onTimeChanged: (value: string) => void
    onSpecifiedTimesChanged: (value: string[]) => void
    onSpecifiedDayConstraintChanged: (value: SpecifiedDayConstraint) => void
    onWorkDayTimesChanged: (value: string[]) => void
    onRestDayTimesChanged: (value: string[]) => void
    fixedType?: boolean
}) {
    return (
        <NavigationLink
            destination={
                <SimpleTaskPreferenceEditPage
                    item={item}
                    onTypeChanged={onTypeChanged}
                    onModeChanged={onModeChanged}
                    onTimeChanged={onTimeChanged}
                    onSpecifiedTimesChanged={onSpecifiedTimesChanged}
                    onSpecifiedDayConstraintChanged={onSpecifiedDayConstraintChanged}
                    onWorkDayTimesChanged={onWorkDayTimesChanged}
                    onRestDayTimesChanged={onRestDayTimesChanged}
                    fixedType={fixedType}
                />
            }
        >
            <RowText
                title={item.title}
                value={simpleTaskModeLabel(item.mode, item.time, item.specifiedTimes, item.specifiedDayConstraint, item.workDayTimes, item.restDayTimes)}
                icon={item.icon || simpleTaskTypeOption(item.typeId).icon}
            />
        </NavigationLink>
    )
}

function SimpleTaskPreferenceEditPage({
    item,
    onTypeChanged,
    onModeChanged,
    onTimeChanged,
    onSpecifiedTimesChanged,
    onSpecifiedDayConstraintChanged,
    onWorkDayTimesChanged,
    onRestDayTimesChanged,
    fixedType = false
}: {
    item: SimpleTaskPreferenceDraft
    onTypeChanged: (value: string) => void
    onModeChanged: (value: string) => void
    onTimeChanged: (value: string) => void
    onSpecifiedTimesChanged: (value: string[]) => void
    onSpecifiedDayConstraintChanged: (value: SpecifiedDayConstraint) => void
    onWorkDayTimesChanged: (value: string[]) => void
    onRestDayTimesChanged: (value: string[]) => void
    fixedType?: boolean
}) {
    const [draftItem, setDraftItem] = useState(item)
    const currentOption = simpleTaskTypeOption(draftItem.typeId)

    function handleTypeChanged(value: string) {
        const option = simpleTaskTypeOption(value)
        setDraftItem(current => ({
            ...current,
            typeId: option.id,
            title: option.label,
            icon: option.icon
        }))
        onTypeChanged(value)
    }

    function handleModeChanged(value: string) {
        setDraftItem(current => ({ ...current, mode: value as SimpleTaskPreferenceMode }))
        onModeChanged(value)
    }

    function handleTimeChanged(value: string) {
        const nextTimes = normalizedSpecifiedTimes(value, draftItem.specifiedTimes)
        nextTimes[0] = normalizeTimeDigits(value)
        setDraftItem(current => ({ ...current, time: value, specifiedTimes: nextTimes }))
        onTimeChanged(value)
        onSpecifiedTimesChanged(nextTimes)
    }

    function handleSpecifiedTimeChanged(index: number, value: string) {
        const nextTimes = normalizedSpecifiedTimes(draftItem.time, draftItem.specifiedTimes)
        nextTimes[index] = normalizeTimeDigits(value)
        const primaryTime = nextTimes[0] || value
        setDraftItem(current => ({ ...current, time: primaryTime, specifiedTimes: nextTimes }))
        onTimeChanged(primaryTime)
        onSpecifiedTimesChanged(nextTimes)
    }

    function addSpecifiedTime() {
        const nextTimes = [...normalizedSpecifiedTimes(draftItem.time, draftItem.specifiedTimes), normalizeTimeDigits(draftItem.time || "2000")]
        setDraftItem(current => ({ ...current, specifiedTimes: nextTimes }))
        onSpecifiedTimesChanged(nextTimes)
    }

    function deleteSpecifiedTimes(deletedItems: { id: string; index: number; value: string }[]) {
        const deletedIndexes = new Set(deletedItems.map(item => item.index).filter(index => index > 0))
        if (deletedIndexes.size === 0) return
        const nextTimes = normalizedSpecifiedTimes(draftItem.time, draftItem.specifiedTimes).filter((_, index) => !deletedIndexes.has(index))
        const safeTimes = nextTimes.length > 0 ? nextTimes : [normalizeTimeDigits(draftItem.time || "2000")]
        const primaryTime = safeTimes[0]
        setDraftItem(current => ({ ...current, time: primaryTime, specifiedTimes: safeTimes }))
        onTimeChanged(primaryTime)
        onSpecifiedTimesChanged(safeTimes)
    }

    function handleSpecifiedDayConstraintChanged(value: string) {
        const nextValue = value as SpecifiedDayConstraint
        setDraftItem(current => ({ ...current, specifiedDayConstraint: nextValue }))
        onSpecifiedDayConstraintChanged(nextValue)
    }

    function handleWorkDayTimeChanged(index: number, value: string) {
        const currentTimes = draftItem.workDayTimes || [normalizeTimeDigits(draftItem.time || "2000")]
        const nextTimes = [...currentTimes]
        nextTimes[index] = normalizeTimeDigits(value)
        setDraftItem(current => ({ ...current, workDayTimes: nextTimes }))
        onWorkDayTimesChanged(nextTimes)
    }

    function addWorkDayTime() {
        const currentTimes = draftItem.workDayTimes || [normalizeTimeDigits(draftItem.time || "2000")]
        const nextTimes = [...currentTimes, normalizeTimeDigits(draftItem.time || "2000")]
        setDraftItem(current => ({ ...current, workDayTimes: nextTimes }))
        onWorkDayTimesChanged(nextTimes)
    }

    function deleteWorkDayTimes(deletedItems: { id: string; index: number; value: string }[]) {
        const deletedIndexes = new Set(deletedItems.map(item => item.index).filter(index => index > 0))
        if (deletedIndexes.size === 0) return
        const currentTimes = draftItem.workDayTimes || [normalizeTimeDigits(draftItem.time || "2000")]
        const nextTimes = currentTimes.filter((_, index) => !deletedIndexes.has(index))
        const safeTimes = nextTimes.length > 0 ? nextTimes : [normalizeTimeDigits(draftItem.time || "2000")]
        setDraftItem(current => ({ ...current, workDayTimes: safeTimes }))
        onWorkDayTimesChanged(safeTimes)
    }

    function handleRestDayTimeChanged(index: number, value: string) {
        const currentTimes = draftItem.restDayTimes || [normalizeTimeDigits(draftItem.time || "2000")]
        const nextTimes = [...currentTimes]
        nextTimes[index] = normalizeTimeDigits(value)
        setDraftItem(current => ({ ...current, restDayTimes: nextTimes }))
        onRestDayTimesChanged(nextTimes)
    }

    function addRestDayTime() {
        const currentTimes = draftItem.restDayTimes || [normalizeTimeDigits(draftItem.time || "2000")]
        const nextTimes = [...currentTimes, normalizeTimeDigits(draftItem.time || "2000")]
        setDraftItem(current => ({ ...current, restDayTimes: nextTimes }))
        onRestDayTimesChanged(nextTimes)
    }

    function deleteRestDayTimes(deletedItems: { id: string; index: number; value: string }[]) {
        const deletedIndexes = new Set(deletedItems.map(item => item.index).filter(index => index > 0))
        if (deletedIndexes.size === 0) return
        const currentTimes = draftItem.restDayTimes || [normalizeTimeDigits(draftItem.time || "2000")]
        const nextTimes = currentTimes.filter((_, index) => !deletedIndexes.has(index))
        const safeTimes = nextTimes.length > 0 ? nextTimes : [normalizeTimeDigits(draftItem.time || "2000")]
        setDraftItem(current => ({ ...current, restDayTimes: safeTimes }))
        onRestDayTimesChanged(safeTimes)
    }

    const specifiedTimeItems = normalizedSpecifiedTimes(draftItem.time, draftItem.specifiedTimes).slice(1).map((value, index) => ({
        id: `specified-time-${index + 1}-${value}`,
        index: index + 1,
        value
    }))
    const deletableSpecifiedTimeItems = useDeletableEntries(specifiedTimeItems, deleteSpecifiedTimes)

    const workDayTimeItems = (draftItem.workDayTimes || [normalizeTimeDigits(draftItem.time || "2000")]).slice(1).map((value, index) => ({
        id: `work-day-time-${index + 1}-${value}`,
        index: index + 1,
        value
    }))
    const deletableWorkDayTimeItems = useDeletableEntries(workDayTimeItems, deleteWorkDayTimes)

    const restDayTimeItems = (draftItem.restDayTimes || [normalizeTimeDigits(draftItem.time || "2000")]).slice(1).map((value, index) => ({
        id: `rest-day-time-${index + 1}-${value}`,
        index: index + 1,
        value
    }))
    const deletableRestDayTimeItems = useDeletableEntries(restDayTimeItems, deleteRestDayTimes)

    return (
        <List
            navigationTitle={draftItem.title}
            navigationBarTitleDisplayMode="inline"
        >
            <Section header={<Text>任务类型</Text>}>
                {fixedType ? (
                    <RowText
                        title="任务"
                        value={draftItem.title}
                        icon={draftItem.icon || currentOption.icon}
                    />
                ) : (
                    <Picker
                        title="任务"
                        systemImage={currentOption.icon}
                        value={draftItem.typeId}
                        onChanged={handleTypeChanged}
                    >
                        {simpleTaskTypeOptions.map(option => (
                            <Text key={`simple-task-type-${option.id}`} tag={option.id}>{option.label}</Text>
                        ))}
                    </Picker>
                )}
            </Section>
            <Section header={<Text>时间偏好</Text>}>
                <Picker
                    title="安排方式"
                    value={draftItem.mode}
                    onChanged={handleModeChanged}
                >
                    <Text tag="any">任何时间</Text>
                    <Text tag="work">工作时间</Text>
                    <Text tag="restTime">休息时间</Text>
                    <Text tag="restDay">休息日</Text>
                    <Text tag="specified">指定时间</Text>
                </Picker>
                {draftItem.mode === "specified" ? (
                    <>
                        <Picker
                            title="日期范围"
                            value={draftItem.specifiedDayConstraint || "any"}
                            onChanged={handleSpecifiedDayConstraintChanged}
                        >
                            <Text tag="any">任何日子</Text>
                            <Text tag="work">仅工作日</Text>
                            <Text tag="rest">仅休息日</Text>
                            <Text tag="split">工作日/休息日分别指定</Text>
                        </Picker>
                        {(draftItem.specifiedDayConstraint || "any") === "split" ? (
                            <>
                                <Section header={<Text>工作日时间</Text>}>
                                    <DatePicker
                                        title="工作日时间"
                                        value={timeDateFromValue((draftItem.workDayTimes || [normalizeTimeDigits(draftItem.time || "2000")])[0])}
                                        displayedComponents={["hourAndMinute"]}
                                        onChanged={(nextValue: Date | number) => handleWorkDayTimeChanged(0, timeValueFromPicker(nextValue))}
                                    />
                                    <ForEach
                                        data={deletableWorkDayTimeItems}
                                        editActions="delete"
                                        builder={(timeItem) => (
                                            <DatePicker
                                                key={timeItem.id}
                                                title={`工作日时间 ${timeItem.index + 1}`}
                                                value={timeDateFromValue(timeItem.value)}
                                                displayedComponents={["hourAndMinute"]}
                                                onChanged={(nextValue: Date | number) => handleWorkDayTimeChanged(timeItem.index, timeValueFromPicker(nextValue))}
                                            />
                                        )}
                                    />
                                    <Button
                                        title="增加工作日时间"
                                        systemImage="plus.circle.fill"
                                        action={addWorkDayTime}
                                    />
                                </Section>
                                <Section header={<Text>休息日时间</Text>}>
                                    <DatePicker
                                        title="休息日时间"
                                        value={timeDateFromValue((draftItem.restDayTimes || [normalizeTimeDigits(draftItem.time || "2000")])[0])}
                                        displayedComponents={["hourAndMinute"]}
                                        onChanged={(nextValue: Date | number) => handleRestDayTimeChanged(0, timeValueFromPicker(nextValue))}
                                    />
                                    <ForEach
                                        data={deletableRestDayTimeItems}
                                        editActions="delete"
                                        builder={(timeItem) => (
                                            <DatePicker
                                                key={timeItem.id}
                                                title={`休息日时间 ${timeItem.index + 1}`}
                                                value={timeDateFromValue(timeItem.value)}
                                                displayedComponents={["hourAndMinute"]}
                                                onChanged={(nextValue: Date | number) => handleRestDayTimeChanged(timeItem.index, timeValueFromPicker(nextValue))}
                                            />
                                        )}
                                    />
                                    <Button
                                        title="增加休息日时间"
                                        systemImage="plus.circle.fill"
                                        action={addRestDayTime}
                                    />
                                </Section>
                                <Text font="footnote" foregroundStyle="secondaryLabel">
                                    工作日和休息日可分别指定多个时间并左滑删除；第一个时间会作为主时间保留，不能删除。工作日/休息日通过 Off day 判断。
                                </Text>
                            </>
                        ) : (
                            <>
                                <DatePicker
                                    title="指定时间"
                                    value={timeDateFromValue(normalizedSpecifiedTimes(draftItem.time, draftItem.specifiedTimes)[0])}
                                    displayedComponents={["hourAndMinute"]}
                                    onChanged={(nextValue: Date | number) => handleSpecifiedTimeChanged(0, timeValueFromPicker(nextValue))}
                                />
                                <ForEach
                                    data={deletableSpecifiedTimeItems}
                                    editActions="delete"
                                    builder={(timeItem) => (
                                        <DatePicker
                                            key={timeItem.id}
                                            title={`指定时间 ${timeItem.index + 1}`}
                                            value={timeDateFromValue(timeItem.value)}
                                            displayedComponents={["hourAndMinute"]}
                                            onChanged={(nextValue: Date | number) => handleSpecifiedTimeChanged(timeItem.index, timeValueFromPicker(nextValue))}
                                        />
                                    )}
                                />
                                <Button
                                    title="增加时间"
                                    systemImage="plus.circle.fill"
                                    action={addSpecifiedTime}
                                />
                                <Text font="footnote" foregroundStyle="secondaryLabel">
                                    可以添加多个指定时间并左滑删除；第一个指定时间会作为主时间保留，不能删除。日期范围可限制为工作日、休息日或任何日子，工作日/休息日均通过 Off day 判断。
                                </Text>
                            </>
                        )}
                    </>
                ) : null}
            </Section>
            <Section>
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    工作日只在 Off day 判定的工作日工作时间内补全；休息日只在 Off day 判定的休息日全天补全；休息时间包含休息日全天和工作日晚上；指定时间可额外限制工作日/休息日/任何日子；任何时间不限制日期和时段。
                </Text>
            </Section>
        </List>
    )
}

function UserPreferencesPage({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    const p = config.userPreferences || DEFAULT_CONFIG.userPreferences!
    const learningSummary = lightLearningSummary(config)
    const learningCount = learningSummary.total
    const globalMemoryText = memoryMarkdownText(p.memory?.global)
    const autoMemoryText = dailyMemoryMarkdownText(p.memory)
    const globalMemorySummary = markdownSummary(globalMemoryText)
    const autoMemorySummary = markdownSummary(autoMemoryText)
    const simpleTaskDrafts = simpleTaskPreferenceDrafts(p)
    const simpleTaskEntries = useDeletableEntries(simpleTaskDrafts.filter(item => item.id !== "simple-general"), deleteSimpleTasks)

    function updatePreference(mutator: (draft: NonNullable<AlertpilotConfig["userPreferences"]>) => void, message = "用户偏好已保存") {
        void updateConfig(draft => {
            draft.userPreferences = {
                ...DEFAULT_CONFIG.userPreferences!,
                ...(draft.userPreferences || {}),
                learning: draft.userPreferences?.learning || {},
                learningByList: draft.userPreferences?.learningByList || {},
                memory: {
                    ...(DEFAULT_CONFIG.userPreferences?.memory || {}),
                    ...(draft.userPreferences?.memory || {}),
                    global: draft.userPreferences?.memory?.global || "",
                    aiDaily: draft.userPreferences?.memory?.aiDaily || [],
                    aiMarkdown: draft.userPreferences?.memory?.aiMarkdown || ""
                }
            }
            mutator(draft.userPreferences)
        }, message)
    }

    function upsertSimpleTaskPreference(item: SimpleTaskPreferenceDraft, mutator: (next: SimpleTaskPreferenceDraft) => void, message = "简单任务偏好已保存") {
        updatePreference(draft => {
            const savedCustom = item.isCustom
                ? (draft.customSimpleTasks || []).find(task => task.id === item.id)
                : undefined
            const savedBuiltIn = !item.isCustom
                ? (draft.simpleTaskPreferences || []).find(task => task.id === item.id)
                : undefined
            const baseTypeId = savedCustom?.typeId || savedBuiltIn?.typeId || item.typeId
            const option = simpleTaskTypeOption(baseTypeId)
            const current: SimpleTaskPreferenceDraft = {
                ...item,
                typeId: option.id,
                title: option.label,
                icon: option.icon,
                mode: (savedCustom?.mode || savedBuiltIn?.mode || item.mode) as SimpleTaskPreferenceMode,
                time: savedCustom?.time || savedBuiltIn?.time || item.time,
                specifiedTimes: normalizedSpecifiedTimes(
                    savedCustom?.time || savedBuiltIn?.time || item.time,
                    savedCustom?.specifiedTimes || savedBuiltIn?.specifiedTimes || item.specifiedTimes
                ),
                specifiedDayConstraint: savedCustom?.specifiedDayConstraint || savedBuiltIn?.specifiedDayConstraint || item.specifiedDayConstraint || "any"
            }
            mutator(current)
            const nextOption = simpleTaskTypeOption(current.typeId)
            current.title = nextOption.label
            current.icon = nextOption.icon

            if (item.isCustom) {
                const items = [...(draft.customSimpleTasks || [])]
                const index = items.findIndex(task => task.id === item.id)
                const nextTask: CustomSimpleTaskPreference = {
                    id: current.id,
                    typeId: current.typeId,
                    title: current.title,
                    mode: current.mode,
                    time: current.time,
                    specifiedTimes: normalizedSpecifiedTimes(current.time, current.specifiedTimes),
                    specifiedDayConstraint: current.specifiedDayConstraint || "any",
                    workDayTimes: current.workDayTimes,
                    restDayTimes: current.restDayTimes
                }
                if (index >= 0) {
                    items[index] = nextTask
                } else {
                    items.push(nextTask)
                }
                draft.customSimpleTasks = items
                return
            }

            const items = [...(draft.simpleTaskPreferences || [])]
            const index = items.findIndex(task => task.id === item.id)
            const nextTask = {
                id: current.id,
                typeId: current.typeId,
                mode: current.mode,
                time: current.time,
                specifiedTimes: normalizedSpecifiedTimes(current.time, current.specifiedTimes),
                specifiedDayConstraint: current.specifiedDayConstraint || "any",
                workDayTimes: current.workDayTimes,
                restDayTimes: current.restDayTimes
            }
            if (index >= 0) {
                items[index] = nextTask
            } else {
                items.push(nextTask)
            }
            draft.simpleTaskPreferences = items
        }, message)
    }

    function updateSimpleTaskType(item: SimpleTaskPreferenceDraft, typeId: string) {
        upsertSimpleTaskPreference(item, next => { next.typeId = typeId }, "任务类型已保存")
    }

    function updateSimpleTaskMode(item: SimpleTaskPreferenceDraft, value: string) {
        upsertSimpleTaskPreference(item, next => { next.mode = value as SimpleTaskPreferenceMode })
    }

    function updateSimpleTaskTime(item: SimpleTaskPreferenceDraft, value: string) {
        upsertSimpleTaskPreference(item, next => {
            const nextTimes = normalizedSpecifiedTimes(value, next.specifiedTimes)
            nextTimes[0] = normalizeTimeDigits(value)
            next.time = normalizeTimeDigits(value)
            next.specifiedTimes = nextTimes
        })
    }

    function updateSimpleTaskSpecifiedTimes(item: SimpleTaskPreferenceDraft, value: string[]) {
        upsertSimpleTaskPreference(item, next => {
            const nextTimes = normalizedSpecifiedTimes(next.time, value)
            next.time = nextTimes[0]
            next.specifiedTimes = nextTimes
        }, "指定时间已保存")
    }

    function updateSimpleTaskSpecifiedDayConstraint(item: SimpleTaskPreferenceDraft, value: SpecifiedDayConstraint) {
        upsertSimpleTaskPreference(item, next => {
            next.specifiedDayConstraint = value
        }, "指定日期范围已保存")
    }

    function updateSimpleTaskWorkDayTimes(item: SimpleTaskPreferenceDraft, value: string[]) {
        upsertSimpleTaskPreference(item, next => {
            next.workDayTimes = value.length > 0 ? value : [normalizeTimeDigits(next.time || "2000")]
        }, "工作日时间已保存")
    }

    function updateSimpleTaskRestDayTimes(item: SimpleTaskPreferenceDraft, value: string[]) {
        upsertSimpleTaskPreference(item, next => {
            next.restDayTimes = value.length > 0 ? value : [normalizeTimeDigits(next.time || "2000")]
        }, "休息日时间已保存")
    }

    function deleteSimpleTasks(deletedItems: SimpleTaskPreferenceDraft[]) {
        const deletedIds = new Set(deletedItems.map(item => item.id))
        updatePreference(draft => {
            const deletedCustomIds = new Set(deletedItems.filter(item => item.isCustom).map(item => item.id))
            if (deletedCustomIds.size > 0) {
                draft.customSimpleTasks = (draft.customSimpleTasks || []).filter(item => !deletedCustomIds.has(item.id))
            }

            const deletedBuiltInIds = deletedItems.filter(item => !item.isCustom).map(item => item.id)
            if (deletedBuiltInIds.length > 0) {
                const hiddenIds = new Set([...(draft.hiddenSimpleTaskIds || []), ...deletedBuiltInIds])
                draft.hiddenSimpleTaskIds = Array.from(hiddenIds)
                draft.simpleTaskPreferences = (draft.simpleTaskPreferences || []).filter(item => !deletedIds.has(item.id))
            }
        }, "已删除任务偏好")
    }

    function addCustomSimpleTask() {
        const option = simpleTaskTypeOption("general")
        updatePreference(draft => {
            draft.customSimpleTasks = [
                ...(draft.customSimpleTasks || []),
                {
                    id: `custom-${Date.now()}`,
                    typeId: option.id,
                    title: option.label,
                    mode: "any",
                    time: draft.dailyTaskStart || "2000",
                    specifiedTimes: normalizedSpecifiedTimes(draft.dailyTaskStart || "2000"),
                    specifiedDayConstraint: "any"
                }
            ]
        }, "已新增自定义任务")
    }

    return (
        <List
            navigationTitle="用户偏好"
            navigationBarTitleDisplayMode="inline"
        >
            <Section header={<Text>智能默认提醒</Text>}>
                <Toggle
                    title="启用智能默认提醒"
                    systemImage="sparkles"
                    value={p.enabled}
                    onChanged={value => updatePreference(draft => {
                        draft.enabled = value
                    }, value ? "已开启智能默认提醒" : "已关闭智能默认提醒")}
                />
                <Toggle
                    title="本地自学习"
                    systemImage="brain.head.profile"
                    value={p.autoLearn}
                    onChanged={value => updatePreference(draft => {
                        draft.autoLearn = value
                    }, value ? "已开启本地自学习" : "已关闭本地自学习")}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    自学习会同时记录两类计数：任务类型 → 常选时间段（用于判断工作/日常/学习/运动等时间段），提醒事项列表 → 常选时间段（用于辅助列表级偏好）。它不会每次调用 AI，也不会把完整历史日志塞进提示词。
                </Text>
            </Section>

            <Section header={<Text>工作与通勤</Text>}>
                <TimePickerRow
                    title="开始工作"
                    icon="briefcase"
                    value={p.workStart}
                    onChanged={value => updatePreference(draft => { draft.workStart = value })}
                />
                <TimePickerRow
                    title="结束工作"
                    icon="briefcase.fill"
                    value={p.workEnd}
                    onChanged={value => updatePreference(draft => { draft.workEnd = value })}
                />
                <StepperRow
                    title="单程通勤"
                    value={p.commuteMinutes}
                    min={0}
                    step={10}
                    unit=" 分钟"
                    icon="tram.fill"
                    onChanged={value => updatePreference(draft => { draft.commuteMinutes = value }, "通勤时间已保存")}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    是否工作日仍然按 Off day 判断；工作时间和通勤时间只影响默认提醒分配。
                </Text>
            </Section>

            <Section header={<Text>日常事项与停止时间</Text>}>
                <StepperRow
                    title="一般任务耗时"
                    value={p.generalTaskDurationMinutes || 30}
                    min={10}
                    step={10}
                    unit=" 分钟"
                    icon="hourglass"
                    onChanged={value => updatePreference(draft => { draft.generalTaskDurationMinutes = value }, "一般任务耗时已保存")}
                />
                <StepperRow
                    title="重要任务耗时"
                    value={p.importantTaskDurationMinutes || 60}
                    min={10}
                    step={10}
                    unit=" 分钟"
                    icon="star.circle.fill"
                    onChanged={value => updatePreference(draft => { draft.importantTaskDurationMinutes = value }, "重要任务耗时已保存")}
                />
                <StepperRow
                    title="任务延顺时间"
                    value={p.floatingTaskDelayMinutes || 10}
                    min={10}
                    max={60}
                    step={10}
                    unit=" 分钟"
                    icon="clock.badge.checkmark"
                    onChanged={value => updatePreference(draft => { draft.floatingTaskDelayMinutes = value }, "任务延顺时间已保存")}
                />
                <StepperRow
                    title="紧急任务延顺"
                    value={p.conflictDeferMinutes || 30}
                    min={10}
                    step={10}
                    unit=" 分钟"
                    icon="arrowshape.turn.up.right"
                    onChanged={value => updatePreference(draft => { draft.conflictDeferMinutes = value }, "紧急任务延顺时间已保存")}
                />
                <StepperRow
                    title="冲突缓冲时间"
                    value={p.conflictBufferMinutes || 10}
                    min={0}
                    max={60}
                    step={5}
                    unit=" 分钟"
                    icon="clock.arrow.circlepath"
                    onChanged={value => updatePreference(draft => { draft.conflictBufferMinutes = value }, "冲突缓冲时间已保存")}
                />
                <StepperRow
                    title="重叠任务上限"
                    value={p.maxConcurrentTasks || 2}
                    min={1}
                    step={1}
                    unit=" 个"
                    icon="rectangle.stack"
                    onChanged={value => updatePreference(draft => { draft.maxConcurrentTasks = value }, "重叠任务上限已保存")}
                />
                <TimePickerRow
                    title="可做日常事项开始"
                    icon="checkmark.circle"
                    value={p.dailyTaskStart}
                    onChanged={value => updatePreference(draft => { draft.dailyTaskStart = value })}
                />
                <TimePickerRow
                    title="可做日常事项结束"
                    icon="checkmark.circle.fill"
                    value={p.dailyTaskEnd}
                    onChanged={value => updatePreference(draft => { draft.dailyTaskEnd = value })}
                />
                <TimePickerRow
                    title="停止处理事项"
                    icon="bed.double"
                    value={p.quietAfter}
                    onChanged={value => updatePreference(draft => { draft.quietAfter = value })}
                />
                <TimePickerRow
                    title="重要事项偏好"
                    icon="star.fill"
                    value={p.importantTaskTime}
                    onChanged={value => updatePreference(draft => { draft.importantTaskTime = value })}
                />
                <TimePickerRow
                    title="休息日默认"
                    icon="sun.max"
                    value={p.weekendDefaultTime}
                    onChanged={value => updatePreference(draft => { draft.weekendDefaultTime = value })}
                />
                <Text styledText={{
                    font: "footnote",
                    foregroundColor: "secondaryLabel",
                    content: [
                        "工作日晚上 ",
                        { content: formatTimeLabel(p.dailyTaskStart) + "-" + formatTimeLabel(p.dailyTaskEnd), foregroundColor: "systemBlue" },
                        " 属于休息时间；休息日全天属于休息时间。工作日/休息日由 Off day 判断。\n",
                        { content: "一般任务耗时", foregroundColor: "systemBlue" },
                        " " + (p.generalTaskDurationMinutes || 30) + " 分钟，",
                        { content: "重要任务耗时", foregroundColor: "systemBlue" },
                        " " + (p.importantTaskDurationMinutes || 60) + " 分钟，用于估算任务时间范围。\n",
                        { content: "任务延顺时间", foregroundColor: "systemBlue" },
                        " " + (p.floatingTaskDelayMinutes || 10) + " 分钟：无指定时间的任务，从当前时间往后偏移。\n",
                        { content: "紧急任务延顺", foregroundColor: "systemBlue" },
                        " " + (p.conflictDeferMinutes || 30) + " 分钟：紧急任务重排已有任务时的顺延步长。\n",
                        { content: "冲突缓冲时间", foregroundColor: "systemBlue" },
                        " " + (p.conflictBufferMinutes || 10) + " 分钟：从重叠任务最晚结束时间起的缓冲。\n",
                        { content: "重叠任务上限", foregroundColor: "systemBlue" },
                        " " + (p.maxConcurrentTasks || 2) + " 个，超过时按冲突缓冲时间重新安排。\n",
                        { content: "可做日常事项", foregroundColor: "systemBlue" },
                        " " + formatTimeLabel(p.dailyTaskStart) + "-" + formatTimeLabel(p.dailyTaskEnd) + "，",
                        { content: "停止处理事项", foregroundColor: "systemBlue" },
                        " " + formatTimeLabel(p.quietAfter) + "，",
                        { content: "重要事项偏好", foregroundColor: "systemBlue" },
                        " " + formatTimeLabel(p.importantTaskTime) + "，",
                        { content: "休息日默认", foregroundColor: "systemBlue" },
                        " " + formatTimeLabel(p.weekendDefaultTime) + "。带感叹号优先级的任务除外。"
                    ]
                }} />
            </Section>

            <Section header={<Text>简单任务偏好</Text>}>
                <SimpleTaskPreferenceRow
                    item={simpleTaskDrafts.find(item => item.id === "simple-general") || {
                        id: "simple-general",
                        typeId: fixedGeneralTaskOption().id,
                        title: fixedGeneralTaskOption().label,
                        icon: fixedGeneralTaskOption().icon,
                        mode: p.generalMode || "any",
                        time: p.generalPreferredTime || "2000",
                        specifiedTimes: normalizedSpecifiedTimes(p.generalPreferredTime || "2000"),
                        specifiedDayConstraint: "any",
                        isCustom: false
                    }}
                    fixedType
                    onTypeChanged={() => {}}
                    onModeChanged={(value: string) => updateSimpleTaskMode({ id: "simple-general", typeId: "general", title: "一般", icon: "tray", mode: p.generalMode || "any", time: p.generalPreferredTime || "2000", specifiedTimes: normalizedSpecifiedTimes(p.generalPreferredTime || "2000"), specifiedDayConstraint: "any", isCustom: false }, value)}
                    onTimeChanged={value => updateSimpleTaskTime({ id: "simple-general", typeId: "general", title: "一般", icon: "tray", mode: p.generalMode || "any", time: p.generalPreferredTime || "2000", specifiedTimes: normalizedSpecifiedTimes(p.generalPreferredTime || "2000"), specifiedDayConstraint: "any", isCustom: false }, value)}
                    onSpecifiedTimesChanged={value => updateSimpleTaskSpecifiedTimes({ id: "simple-general", typeId: "general", title: "一般", icon: "tray", mode: p.generalMode || "any", time: p.generalPreferredTime || "2000", specifiedTimes: normalizedSpecifiedTimes(p.generalPreferredTime || "2000"), specifiedDayConstraint: "any", isCustom: false }, value)}
                    onSpecifiedDayConstraintChanged={value => updateSimpleTaskSpecifiedDayConstraint({ id: "simple-general", typeId: "general", title: "一般", icon: "tray", mode: p.generalMode || "any", time: p.generalPreferredTime || "2000", specifiedTimes: normalizedSpecifiedTimes(p.generalPreferredTime || "2000"), specifiedDayConstraint: "any", isCustom: false }, value)}
                    onWorkDayTimesChanged={value => updateSimpleTaskWorkDayTimes({ id: "simple-general", typeId: "general", title: "一般", icon: "tray", mode: p.generalMode || "any", time: p.generalPreferredTime || "2000", specifiedTimes: normalizedSpecifiedTimes(p.generalPreferredTime || "2000"), specifiedDayConstraint: "any", isCustom: false }, value)}
                    onRestDayTimesChanged={value => updateSimpleTaskRestDayTimes({ id: "simple-general", typeId: "general", title: "一般", icon: "tray", mode: p.generalMode || "any", time: p.generalPreferredTime || "2000", specifiedTimes: normalizedSpecifiedTimes(p.generalPreferredTime || "2000"), specifiedDayConstraint: "any", isCustom: false }, value)}
                />
                <ForEach
                    data={simpleTaskEntries}
                    editActions="delete"
                    builder={(item) => (
                        <SimpleTaskPreferenceRow
                            key={item.id}
                            item={item}
                            onTypeChanged={value => updateSimpleTaskType(item, value)}
                            onModeChanged={(value: string) => updateSimpleTaskMode(item, value)}
                            onTimeChanged={value => updateSimpleTaskTime(item, value)}
                            onSpecifiedTimesChanged={value => updateSimpleTaskSpecifiedTimes(item, value)}
                            onSpecifiedDayConstraintChanged={value => updateSimpleTaskSpecifiedDayConstraint(item, value)}
                            onWorkDayTimesChanged={value => updateSimpleTaskWorkDayTimes(item, value)}
                            onRestDayTimesChanged={value => updateSimpleTaskRestDayTimes(item, value)}
                        />
                    )}
                />
                <Button
                    title="新增任务"
                    systemImage="plus.circle.fill"
                    action={addCustomSimpleTask}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    左侧图标使用 Label 随任务类型自动变化；点击任务可进入编辑页调整类型和时间偏好。所有任务都可以左滑删除；新增任务只在列表显示摘要，避免同时渲染大量选择器导致卡顿。
                </Text>
            </Section>

            <Section header={<Text>用户画像记忆</Text>}>
                <NavigationLink
                    destination={
                        <ProfileMemoryPage
                            config={config}
                            updateConfig={updateConfig}
                        />
                    }
                >
                    <RowText
                        title="记忆管理"
                        value={`全局 ${globalMemorySummary} / 自动 ${autoMemorySummary}`}
                        icon="brain"
                    />
                </NavigationLink>
                <NavigationLink
                    destination={
                        <ProfileAiPromptPage
                            config={config}
                        />
                    }
                >
                    <RowText
                        title="查看 AI 提示词"
                        value="实时预览"
                        icon="sparkles.rectangle.stack"
                    />
                </NavigationLink>
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    全局记忆由你手动维护；自动记忆由脚本以 Markdown 形式沉淀最近运行摘要。两者都会作为用户画像参考注入 AI 提示词。
                </Text>
            </Section>

            <Section header={<Text>学习状态</Text>}>
                <NavigationLink
                    destination={
                        <LearningDataPage
                            config={config}
                            updateConfig={updateConfig}
                        />
                    }
                >
                    <RowText
                        title="已学习样本"
                        value={learningSummary.text}
                        icon="chart.bar"
                    />
                </NavigationLink>
                <NavigationLink
                    destination={
                        <ClearLearningDataConfirmPage
                            learningCount={learningCount}
                            updateConfig={updateConfig}
                        />
                    }
                >
                    <RowText
                        title="清空学习数据"
                        value="进入确认页"
                        icon="trash"
                        iconColor="red"
                    />
                </NavigationLink>
            </Section>
        </List>
    )
}

function LearningDataPage({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    const taskEntries = learningEntriesFromConfig(config, "task")
    const listEntries = learningEntriesFromConfig(config, "list")
    const taskTotal = taskEntries.reduce((sum, item) => sum + learningStatTotal(item.stat), 0)
    const listTotal = listEntries.reduce((sum, item) => sum + learningStatTotal(item.stat), 0)

    function renderEntry(entry: LearningEntryItem, mode: LearningMode) {
        return (
            <NavigationLink
                key={entry.id}
                destination={
                    <LearningDataDetailPage
                        mode={mode}
                        config={config}
                        category={entry.category}
                        sourceCategories={entry.sourceCategories}
                        stat={entry.stat}
                        updateConfig={updateConfig}
                    />
                }
            >
                <RowText
                    title={learningCategoryLabel(entry.category, config, mode)}
                    value={`${learningStatTotal(entry.stat)} 次 / ${learningBestSlotLabel(entry.stat)}`}
                    icon={mode === "task" ? "tag" : "list.bullet.rectangle"}
                />
            </NavigationLink>
        )
    }

    return (
        <List
            navigationTitle="已学习样本"
            navigationBarTitleDisplayMode="inline"
        >
            <Section header={<Text>样本总览</Text>}>
                <RowText
                    title="任务类型样本"
                    value={`${taskTotal} 次 / ${taskEntries.length} 类`}
                    icon="tag"
                />
                <RowText
                    title="提醒事项列表样本"
                    value={`${listTotal} 次 / ${listEntries.length} 个`}
                    icon="list.bullet.rectangle"
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    任务类型用于决定工作、日常、学习、健康等默认时间段；提醒事项列表用于辅助同一列表的时间偏好。两个维度会同时学习，互不替代。
                </Text>
            </Section>

            <Section header={<Text>按任务类型查看</Text>}>
                {taskEntries.length === 0 ? (
                    <Text font="body">暂无任务类型学习样本</Text>
                ) : null}
                {taskEntries.map(entry => renderEntry(entry, "task"))}
            </Section>

            <Section header={<Text>按提醒事项列表查看</Text>}>
                {listEntries.length === 0 ? (
                    <Text font="body">暂无列表学习样本</Text>
                ) : null}
                {listEntries.map(entry => renderEntry(entry, "list"))}
            </Section>
        </List>
    )
}

function LearningDataDetailPage({
    mode,
    config,
    category,
    sourceCategories,
    stat,
    updateConfig
}: {
    mode: LearningMode
    config: AlertpilotConfig
    category: string
    sourceCategories?: string[]
    stat: UserPreferenceLearningStat
    updateConfig: UpdateConfig
}) {
    const [categoryText, setCategoryText] = useState(category)
    const [draftStat, setDraftStat] = useState(() => normalizeLearningStat(stat))
    const dismiss = Navigation.useDismiss()
    const slotSum = learningSlotKeys.reduce((sum, key) => sum + Number(draftStat[key] || 0), 0)
    const total = Math.max(Number(draftStat.total || 0), slotSum)
    const targetLabel = mode === "task" ? "任务类型" : "提醒事项列表"

    function setSlotCount(slot: LearningSlotKey, value: number) {
        const nextValue = Math.max(0, Math.floor(Number(value) || 0))
        setDraftStat(current => {
            const next = {
                ...current,
                [slot]: nextValue
            }
            const nextSlotSum = learningSlotKeys.reduce((sum, key) => sum + Number(next[key] || 0), 0)
            return {
                ...next,
                total: Math.max(Number(next.total || 0), nextSlotSum)
            }
        })
    }

    function setTotalCount(value: number) {
        const nextValue = Math.max(slotSum, Math.floor(Number(value) || 0))
        setDraftStat(current => ({
            ...current,
            total: nextValue
        }))
    }

    async function saveLearningEntry() {
        const finalCategory = categoryText.trim()
        if (!finalCategory) {
            await Dialog.alert({
                title: "保存失败",
                message: `${targetLabel}键不能为空`
            })
            return
        }

        const normalized = normalizeLearningStat({
            ...draftStat,
            total
        })

        const saved = await updateConfig(draft => {
            draft.userPreferences = {
                ...DEFAULT_CONFIG.userPreferences!,
                ...(draft.userPreferences || {}),
                learning: draft.userPreferences?.learning || {},
                learningByList: draft.userPreferences?.learningByList || {}
            }

            const target = mode === "list"
                ? draft.userPreferences.learningByList!
                : draft.userPreferences.learning!

            for (const sourceCategory of sourceCategories || [category]) {
                delete target[sourceCategory]
            }

            target[finalCategory] = normalized
        }, "学习样本已保存")

        if (saved) {
            dismiss()
        }
    }

    async function deleteLearningEntry() {
        const confirmed = await Dialog.confirm({
            title: "删除该学习样本？",
            message: `将删除“${learningCategoryLabel(category, config, mode)}”${targetLabel}的 ${learningStatTotal(stat)} 次学习计数，是否继续？`,
            cancelLabel: "取消",
            confirmLabel: "删除"
        })

        if (!confirmed) return

        const saved = await updateConfig(draft => {
            draft.userPreferences = {
                ...DEFAULT_CONFIG.userPreferences!,
                ...(draft.userPreferences || {}),
                learning: draft.userPreferences?.learning || {},
                learningByList: draft.userPreferences?.learningByList || {}
            }
            const target = mode === "list"
                ? draft.userPreferences.learningByList!
                : draft.userPreferences.learning!
            for (const sourceCategory of sourceCategories || [category]) {
                delete target[sourceCategory]
            }
        }, "学习样本已删除")

        if (saved) {
            dismiss()
        }
    }

    return (
        <List
            navigationTitle="学习样本详情"
            navigationBarTitleDisplayMode="inline"
            toolbar={{
                keyboard: keyboardEditingToolbarButtons("learning-detail"),
                topBarTrailing: (
                    <Button
                        title="保存"
                        systemImage="checkmark.circle.fill"
                        action={() => { void saveLearningEntry() }}
                    />
                )
            }}
        >
            <Section header={<Text>样本来源</Text>}>
                <RowText
                    title={targetLabel}
                    value={`${learningCategoryLabel(category, config, mode)} / ${category}`}
                    icon={mode === "task" ? "tag" : "list.bullet.rectangle"}
                />
                <TextField
                    title={`${targetLabel}键`}
                    value={categoryText}
                    onChanged={setCategoryText}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    {mode === "task"
                        ? "任务类型键用于匹配工作、购物、学习、健康等语义类型。一般建议只微调数量；只有确认了解类型枚举时再改名。"
                        : "列表键用于匹配提醒事项列表的本地学习偏好。一般建议只微调数量；只有确认了解提醒列表名称时再改名。"}
                </Text>
            </Section>

            <Section header={<Text>时间段计数</Text>}>
                {learningSlotKeys.map(slot => (
                    <StepperRow
                        key={`learning-slot-${slot}`}
                        title={learningSlotLabel(slot)}
                        value={Number(draftStat[slot] || 0)}
                        min={0}
                        step={1}
                        unit=" 次"
                        icon="clock.badge"
                        onChanged={value => setSlotCount(slot, value)}
                    />
                ))}
                <StepperRow
                    title="样本总数"
                    value={total}
                    min={slotSum}
                    step={1}
                    unit=" 次"
                    icon="number.circle"
                    onChanged={setTotalCount}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    总数不能低于上方各时间段之和；智能判断主要参考各时间段数量，累计样本达到一定数量后会采用最多的时间段。
                </Text>
            </Section>

            <Section header={<Text>危险操作</Text>}>
                <HStack>
                    <Button
                        title={`删除该${targetLabel}学习样本`}
                        systemImage="trash"
                        foregroundStyle="red"
                        action={() => { void deleteLearningEntry() }}
                    />
                    <Spacer />
                    <Text
                        font="callout"
                        foregroundStyle="secondaryLabel"
                        multilineTextAlignment="trailing"
                    >
                        仅删除本项
                    </Text>
                </HStack>
            </Section>
        </List>
    )
}

function ClearLearningDataConfirmPage({
    learningCount,
    updateConfig
}: {
    learningCount: number
    updateConfig: UpdateConfig
}) {
    const dismiss = Navigation.useDismiss()

    async function clearLearningData() {
        const confirmed = await Dialog.confirm({
            title: "确认清空学习数据？",
            message: `将删除当前 ${learningCount} 次本地自学习样本，清空后无法恢复。是否继续？`,
            cancelLabel: "取消",
            confirmLabel: "清空"
        })

        if (!confirmed) return

        const saved = await updateConfig(draft => {
            draft.userPreferences = {
                ...DEFAULT_CONFIG.userPreferences!,
                ...(draft.userPreferences || {}),
                learning: {},
                learningByList: {}
            }
        }, "学习数据已清空")

        if (saved) {
            dismiss()
        }
    }

    return (
        <List
            navigationTitle="清空学习数据"
            navigationBarTitleDisplayMode="inline"
        >
            <Section header={<Text>请确认</Text>}>
                <RowText
                    title="已学习样本"
                    value={`${learningCount} 次`}
                    icon="chart.bar"
                />
                <Text font="body">
                    清空后，本地自学习记录的“任务类型 → 常选时间段”与“提醒事项列表 → 常选时间段”计数都会被删除，智能默认提醒将重新开始学习。
                </Text>
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    这个操作不会删除提醒事项、默认配置或其他用户偏好，但清空后的学习数据无法恢复。
                </Text>
            </Section>

            <Section header={<Text>危险操作</Text>}>
                <HStack>
                    <Button
                        title="确认清空学习数据"
                        systemImage="trash"
                        foregroundStyle="red"
                        action={() => { void clearLearningData() }}
                    />
                    <Spacer />
                    <Text
                        font="callout"
                        foregroundStyle="secondaryLabel"
                        multilineTextAlignment="trailing"
                    >
                        不可恢复
                    </Text>
                </HStack>
            </Section>
        </List>
    )
}

function profilePromptPreviewText(config: AlertpilotConfig) {
    const sampleText = "提醒我处理一个无时间任务"
    return buildAiUserPrompt(
        {
            rawText: sampleText
        },
        sampleText,
        config
    )
}

function ProfileAiPromptPage({
    config
}: {
    config: AlertpilotConfig
}) {
    const prompt = profilePromptPreviewText(config)
    const lineCount = prompt.split(/\r?\n/).length

    return (
        <List
            navigationTitle="AI 提示词"
            navigationBarTitleDisplayMode="inline"
        >
            <Section header={<Text>当前用户画像提示词</Text>}>
                <RowText
                    title="生成方式"
                    value="按当前配置实时生成"
                    icon="sparkles.rectangle.stack"
                />
                <RowText
                    title="示例输入"
                    value="无时间任务"
                    icon="text.bubble"
                />
                <RowText
                    title="内容规模"
                    value={`${lineCount} 行 / ${prompt.length} 字`}
                    icon="doc.text.magnifyingglass"
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    这里展示的是 Alertpilot 在调用 AI 时注入的用户画像部分，包含工作/日常时间、简单任务偏好、新增任务 custom 分类、本地学习统计，以及全局/自动画像记忆。实际运行时会根据用户输入重新计算本地兜底 category 和 slot。
                </Text>
            </Section>
            <Section header={<Text>提示词全文</Text>}>
                <Markdown
                    content={prompt}
                    padding={{ leading: -10 }}
                />
            </Section>
        </List>
    )
}

function ProfileMemoryPage({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    const memory = config.userPreferences?.memory || DEFAULT_CONFIG.userPreferences?.memory || {}
    const globalText = memoryMarkdownText(memory.global)
    const autoText = dailyMemoryMarkdownText(memory)
    const [isOrganizing, setIsOrganizing] = useState(false)

    async function handleAiOrganize(mode: "global" | "auto" | "both") {
        if (isOrganizing) return
        
        const confirmed = await Dialog.confirm({
            title: "AI 整理记忆",
            message: mode === "both" 
                ? "将使用 AI 整理全局记忆和自动记忆，去除重复、归类整理并标准化格式。是否继续？"
                : mode === "global"
                ? "将使用 AI 整理全局记忆，去除重复、归类整理并标准化格式。是否继续？"
                : "将使用 AI 整理自动记忆，去除重复、归类整理并标准化格式。是否继续？",
            cancelLabel: "取消",
            confirmLabel: "整理"
        })

        if (!confirmed) return

        setIsOrganizing(true)
        try {
            const result = await aiOrganizeMemory(config, mode)
            
            await updateConfig(draft => {
                if (result.global && (mode === "global" || mode === "both")) {
                    replaceGlobalMemory(draft, result.global)
                }
                if (result.auto && (mode === "auto" || mode === "both")) {
                    replaceAutoMemory(draft, result.auto)
                }
            }, "AI 整理完成")
        } catch (error) {
            await Dialog.alert({
                title: "AI 整理失败",
                message: getErrorMessage(error)
            })
        } finally {
            setIsOrganizing(false)
        }
    }

    return (
        <List
            navigationTitle="用户画像记忆"
            navigationBarTitleDisplayMode="inline"
        >
            <Section header={<Text>记忆总览</Text>}>
                <RowText
                    title="全局记忆"
                    value={markdownSummary(globalText)}
                    icon="person.text.rectangle"
                />
                <RowText
                    title="自动记忆"
                    value={markdownSummary(autoText)}
                    icon="calendar.badge.clock"
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    Scripting Assistant 没有可直接控制的模型级长期记忆；这里用 Alertpilot 配置文件持久化脚本级 Markdown 记忆，并在生成提醒时注入 AI 提示词。
                </Text>
            </Section>

            <Section header={<Text>全局记忆</Text>}>
                <NavigationLink
                    destination={
                        <GlobalMemoryEditPage
                            config={config}
                            updateConfig={updateConfig}
                        />
                    }
                >
                    <RowText
                        title="编辑全局记忆"
                        value={markdownSummary(globalText)}
                        icon="square.and.pencil"
                    />
                </NavigationLink>
                {globalText ? (
                    <Markdown
                        content={globalText}
                        padding={{ leading: -10 }}
                    />
                ) : (
                    <Text font="body">暂无全局记忆</Text>
                )}
            </Section>

            <Section header={<Text>自动记忆</Text>}>
                <NavigationLink
                    destination={
                        <AutoMemoryEditPage
                            config={config}
                            updateConfig={updateConfig}
                        />
                    }
                >
                    <RowText
                        title="编辑自动记忆"
                        value={markdownSummary(autoText)}
                        icon="square.and.pencil"
                    />
                </NavigationLink>
                {autoText ? (
                    <Markdown
                        content={autoText}
                        padding={{ leading: -10 }}
                    />
                ) : (
                    <Text font="body">暂无自动记忆</Text>
                )}
            </Section>

            <Section header={<Text>AI 整理</Text>}>
                <Button
                    title={isOrganizing ? "整理中..." : "AI 整理全局记忆"}
                    systemImage="sparkles"
                    disabled={isOrganizing}
                    action={() => { void handleAiOrganize("global") }}
                />
                <Button
                    title={isOrganizing ? "整理中..." : "AI 整理自动记忆"}
                    systemImage="sparkles"
                    disabled={isOrganizing}
                    action={() => { void handleAiOrganize("auto") }}
                />
                <Button
                    title={isOrganizing ? "整理中..." : "AI 整理全部记忆"}
                    systemImage="sparkles.rectangle.stack"
                    disabled={isOrganizing}
                    action={() => { void handleAiOrganize("both") }}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    使用 AI 整理记忆，去除重复、归类整理并标准化格式。
                </Text>
            </Section>

            <Section header={<Text>危险操作</Text>}>
                <HStack>
                    <Button
                        title="清空自动记忆"
                        systemImage="trash"
                        foregroundStyle="red"
                        action={() => { void clearDailyProfileMemory(updateConfig) }}
                    />
                    <Spacer />
                    <Text
                        font="callout"
                        foregroundStyle="secondaryLabel"
                        multilineTextAlignment="trailing"
                    >
                        保留全局记忆
                    </Text>
                </HStack>
            </Section>
        </List>
    )
}

function GlobalMemoryEditPage({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    const initialText = memoryMarkdownText(config.userPreferences?.memory?.global)
    const [text, setText] = useState(initialText)
    const [isOrganizing, setIsOrganizing] = useState(false)
    const dismiss = Navigation.useDismiss()

    async function saveGlobalMemory() {
        const saved = await updateConfig(draft => {
            replaceGlobalMemory(draft, text)
        }, "全局记忆已保存")

        if (saved) {
            dismiss()
        }
    }

    async function appendSampleMemory() {
        const next = text.trim()
            ? `${text.trim()}\n`
            : ""
        setText(`${next}## 偏好\n- 我更希望工作任务安排在上午，家务安排在晚上。`)
    }

    async function handleAiOrganize() {
        if (isOrganizing || !text.trim()) return
        
        const confirmed = await Dialog.confirm({
            title: "AI 整理全局记忆",
            message: "将使用 AI 整理当前全局记忆，去除重复、归类整理并标准化格式。是否继续？",
            cancelLabel: "取消",
            confirmLabel: "整理"
        })

        if (!confirmed) return

        setIsOrganizing(true)
        try {
            const draft = cloneConfig(config)
            replaceGlobalMemory(draft, text)
            const result = await aiOrganizeMemory(draft, "global")
            if (result.global) {
                setText(result.global)
            }
        } catch (error) {
            await Dialog.alert({
                title: "AI 整理失败",
                message: getErrorMessage(error)
            })
        } finally {
            setIsOrganizing(false)
        }
    }

    return (
        <List
            navigationTitle="编辑全局记忆"
            navigationBarTitleDisplayMode="inline"
            toolbar={{
                keyboard: keyboardEditingToolbarButtons("global-memory"),
                topBarTrailing: (
                    <Button
                        title="保存"
                        systemImage="checkmark.circle.fill"
                        action={() => { void saveGlobalMemory() }}
                    />
                )
            }}
        >
            <Section header={<Text>全局记忆</Text>}>
                <TextField
                    title="Markdown"
                    value={text}
                    onChanged={setText}
                    axis="vertical"
                    lineLimit={memoryEditorLineLimit()}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    这里是一整段全局 Markdown 记忆，不再按行拆分。可使用标题、列表、表格等 Markdown 语法；保存后会作为高优先级用户画像长期注入 AI。
                </Text>
                <Button
                    title="添加示例"
                    systemImage="plus.circle"
                    action={() => { void appendSampleMemory() }}
                />
                <Button
                    title={isOrganizing ? "整理中..." : "AI 整理"}
                    systemImage="sparkles"
                    disabled={isOrganizing || !text.trim()}
                    action={() => { void handleAiOrganize() }}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    使用 AI 整理当前记忆内容，去除重复、归类整理并标准化格式。
                </Text>
            </Section>
        </List>
    )
}

function AutoMemoryEditPage({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    const initialText = dailyMemoryMarkdownText(config.userPreferences?.memory)
    const [text, setText] = useState(initialText)
    const [isOrganizing, setIsOrganizing] = useState(false)
    const dismiss = Navigation.useDismiss()

    async function saveAutoMemory() {
        const saved = await updateConfig(draft => {
            replaceAutoMemory(draft, text)
        }, "自动记忆已保存")

        if (saved) {
            dismiss()
        }
    }

    async function appendSampleMemory() {
        const next = text.trim()
            ? `${text.trim()}\n`
            : ""
        setText(`${next}## ${todayKey()}\n- 智能默认：工作 / Reminders → morning，示例提醒事项。`)
    }

    async function handleAiOrganize() {
        if (isOrganizing || !text.trim()) return
        
        const confirmed = await Dialog.confirm({
            title: "AI 整理自动记忆",
            message: "将使用 AI 整理当前自动记忆，去除重复、归类整理并标准化格式。是否继续？",
            cancelLabel: "取消",
            confirmLabel: "整理"
        })

        if (!confirmed) return

        setIsOrganizing(true)
        try {
            const draft = cloneConfig(config)
            replaceAutoMemory(draft, text)
            const result = await aiOrganizeMemory(draft, "auto")
            if (result.auto) {
                setText(result.auto)
            }
        } catch (error) {
            await Dialog.alert({
                title: "AI 整理失败",
                message: getErrorMessage(error)
            })
        } finally {
            setIsOrganizing(false)
        }
    }

    return (
        <List
            navigationTitle="编辑自动记忆"
            navigationBarTitleDisplayMode="inline"
            toolbar={{
                keyboard: keyboardEditingToolbarButtons("auto-memory"),
                topBarTrailing: (
                    <Button
                        title="保存"
                        systemImage="checkmark.circle.fill"
                        action={() => { void saveAutoMemory() }}
                    />
                )
            }}
        >
            <Section header={<Text>自动记忆</Text>}>
                <TextField
                    title="Markdown"
                    value={text}
                    onChanged={setText}
                    axis="vertical"
                    lineLimit={memoryEditorLineLimit()}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    自动记忆同样以一整段 Markdown 保存。脚本后续会按日期标题追加列表项，类似智能体记忆文件；你也可以手动整理、删除或补充内容。
                </Text>
                <Button
                    title="添加示例"
                    systemImage="plus.circle"
                    action={() => { void appendSampleMemory() }}
                />
                <Button
                    title={isOrganizing ? "整理中..." : "AI 整理"}
                    systemImage="sparkles"
                    disabled={isOrganizing || !text.trim()}
                    action={() => { void handleAiOrganize() }}
                />
                <Text font="footnote" foregroundStyle="secondaryLabel">
                    使用 AI 整理当前记忆内容，去除重复、归类整理并标准化格式。
                </Text>
            </Section>
        </List>
    )
}

async function clearDailyProfileMemory(updateConfig: UpdateConfig) {
    const confirmed = await Dialog.confirm({
        title: "清空自动记忆？",
        message: "将删除自动沉淀的 Markdown 记忆；全局记忆不会受影响。是否继续？",
        cancelLabel: "取消",
        confirmLabel: "清空"
    })

    if (!confirmed) return

    await updateConfig(draft => {
        clearDailyMemory(draft)
    }, "自动记忆已清空")
}

function AiRuntimeConfigFields({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    const useCustomProviderModel = config.useCustomAiProviderModel ?? false
    const provider = config.aiProvider || "openai"
    const modelOptions = aiModelOptions(provider)
    const modelId = config.aiModelId || modelOptions[0] || ""

    return (
        <>
            <Toggle
                title="使用内置助手"
                systemImage="sparkles"
                value={config.useBuiltInAi ?? true}
                onChanged={value => {
                    void updateConfig(draft => {
                        draft.useBuiltInAi = value
                    }, value ? "已使用内置助手默认配置" : "已关闭内置助手")
                }}
            />

            {!(config.useBuiltInAi ?? true) ? (
                <>
                    <Toggle
                        title="自定义供应商和模型"
                        systemImage="slider.horizontal.3"
                        value={useCustomProviderModel}
                        onChanged={value => {
                            void updateConfig(draft => {
                                draft.useCustomAiProviderModel = value
                                if (!value) {
                                    const nextProvider = aiProviderOptions().includes(draft.aiProvider as any)
                                        ? draft.aiProvider
                                        : "openai"
                                    draft.aiProvider = nextProvider
                                    draft.aiModelId = aiModelOptions(nextProvider || "openai")[0]
                                }
                            }, value ? "已开启自定义供应商和模型" : "已关闭自定义供应商和模型")
                        }}
                    />

                    {useCustomProviderModel ? (
                        <>
                            <LabeledInlineTextField
                                title="AI 供应商"
                                icon="server.rack"
                                value={provider}
                                onChanged={(value: string) => {
                                    void updateConfig(draft => {
                                        draft.aiProvider = value
                                    }, "AI 供应商已保存")
                                }}
                            />
                            <LabeledInlineTextField
                                title="AI 模型"
                                icon="cpu"
                                value={modelId}
                                onChanged={(value: string) => {
                                    void updateConfig(draft => {
                                        draft.aiModelId = value
                                    }, "AI 模型已保存")
                                }}
                            />
                        </>
                    ) : (
                        <>
                            <Picker
                                title="AI 供应商"
                                systemImage="server.rack"
                                value={provider}
                                onChanged={(value: string) => {
                                    const nextProvider = value as AlertpilotConfig["aiProvider"]
                                    void updateConfig(draft => {
                                        draft.aiProvider = nextProvider
                                        draft.aiModelId = aiModelOptions(nextProvider || "openai")[0]
                                    }, "AI 供应商已保存")
                                }}
                            >
                                {aiProviderOptions().map(item => (
                                    <Text key={`ai-provider-${item}`} tag={item}>{item}</Text>
                                ))}
                            </Picker>
                            <Picker
                                title="AI 模型"
                                systemImage="cpu"
                                value={modelId}
                                onChanged={(value: string) => {
                                    void updateConfig(draft => {
                                        draft.aiModelId = value
                                    }, "AI 模型已保存")
                                }}
                            >
                                {modelOptions.map(item => (
                                    <Text key={`ai-model-${item}`} tag={item}>{item}</Text>
                                ))}
                            </Picker>
                        </>
                    )}
                </>
            ) : null}
        </>
    )
}

function DefaultConfigFields({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    function defaultOptions(
        group: RecordGroupKey,
        options?: {
            sortValueNumericAsc?: boolean
        }
    ) {
        return recordEntries(config, group, {
            sortValueNumericAsc: options?.sortValueNumericAsc
        })
    }

    function updateDefault(group: DefaultGroupKey, value: string) {
        void updateConfig(draft => {
            draft["默认配置"] = {
                ...(draft["默认配置"] || DEFAULT_CONFIG["默认配置"]),
                [group]: value
            }
        }, `默认${group}已保存`)
    }

    return (
        <DisclosureGroup
            label={disclosureLabel("默认配置", "slider.horizontal.3")}
        >
            <Picker
                title="默认提醒列表"
                systemImage="list.bullet.rectangle"
                value={getDefaultReminderList(config)}
                onChanged={(value: string) => updateDefault("提醒列表", value)}
                padding={{ leading: 24 }}
            >
                {defaultOptions("提醒列表").map(([key, value]) => (
                    <Text key={`default-list-${key}`} tag={value}>{key}</Text>
                ))}
            </Picker>

            <Picker
                title="工作日默认时间"
                systemImage="clock"
                value={getDefaultWorkdayTime(config)}
                onChanged={(value: string) => updateDefault("工作日时间", value)}
                padding={{ leading: 24 }}
            >
                {defaultOptions("时间", { sortValueNumericAsc: true }).map(([key, value]) => (
                    <Text key={`default-workday-time-${key}`} tag={value}>{key}</Text>
                ))}
            </Picker>

            <Picker
                title="休息日默认时间"
                systemImage="clock.badge.checkmark"
                value={getDefaultRestDayTime(config)}
                onChanged={(value: string) => updateDefault("休息日时间", value)}
                padding={{ leading: 24 }}
            >
                {defaultOptions("时间", { sortValueNumericAsc: true }).map(([key, value]) => (
                    <Text key={`default-restday-time-${key}`} tag={value}>{key}</Text>
                ))}
            </Picker>

            <Picker
                title="默认地点"
                systemImage="mappin.and.ellipse"
                value={getDefaultLocation(config)}
                onChanged={(value: string) => updateDefault("地点", value)}
                padding={{ leading: 24 }}
            >
                {defaultOptions("地点").map(([key, value]) => (
                    <Text key={`default-location-${key}`} tag={value}>{key}</Text>
                ))}
            </Picker>

            <Picker
                title="默认休息地"
                systemImage="house"
                value={config.restLocation || getDefaultLocation(config)}
                onChanged={(value: string) => {
                    void updateConfig(draft => {
                        draft.restLocation = value
                    }, "默认休息地已保存")
                }}
                padding={{ leading: 24 }}
            >
                {defaultOptions("地点").map(([key, value]) => (
                    <Text key={`default-rest-location-${key}`} tag={value}>{key}</Text>
                ))}
            </Picker>

            <Picker
                title="默认附加时间"
                systemImage="calendar.badge.clock"
                value={getDefaultAdditionalTime(config)}
                onChanged={(value: string) => updateDefault("附加时间", value)}
                padding={{ leading: 24 }}
            >
                {defaultOptions("附加时间", { sortValueNumericAsc: true }).map(([key, value]) => (
                    <Text key={`default-other-time-${key}`} tag={value}>{key}</Text>
                ))}
            </Picker>
        </DisclosureGroup>
    )
}

function DefaultConfigPage({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    return (
        <List
            navigationTitle="默认配置"
            navigationBarTitleDisplayMode="inline"
        >
            <Section header={<Text>默认项</Text>}>
                <DefaultConfigFields
                    config={config}
                    updateConfig={updateConfig}
                />
            </Section>

            <Section header={<Text>当前选择</Text>}>
                <RowText
                    title="默认配置摘要"
                    value={compactDefaultSummary(config)}
                    icon="checkmark.circle"
                />
            </Section>
        </List>
    )
}

function uniqueRecordKey(config: AlertpilotConfig, group: RecordGroupKey, baseKey: string): string {
    const records = config[group] || {}
    if (!(baseKey in records)) return baseKey

    let index = 2
    while (`${baseKey} ${index}` in records) {
        index += 1
    }
    return `${baseKey} ${index}`
}

function TimeRecordRow({
    itemKey,
    itemValue,
    updateConfig
}: {
    itemKey: string
    itemValue: string
    updateConfig: UpdateConfig
}) {
    const [draftKey, setDraftKey] = useState(itemKey)
    const saveTimerRef = useRef<any>(null)

    useEffect(() => {
        setDraftKey(itemKey)
    }, [itemKey])

    function renameTimeRecord(nextKeyText: string) {
        setDraftKey(nextKeyText)

        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
        }

        saveTimerRef.current = setTimeout(() => {
            const finalKey = nextKeyText.trim()
            if (!finalKey || finalKey === itemKey) return

            void updateConfig(draft => {
                draft["时间"] = draft["时间"] || {}
                const finalValue = draft["时间"][itemKey] ?? itemValue
                const targetKey = finalKey in draft["时间"]
                    ? uniqueRecordKey(draft, "时间", finalKey)
                    : finalKey

                delete draft["时间"][itemKey]
                draft["时间"][targetKey] = finalValue
            }, "时间名称已保存")
        }, 500)
    }

    function updateTimeValue(value: string) {
        void updateConfig(draft => {
            draft["时间"] = draft["时间"] || {}
            draft["时间"][itemKey] = value
        }, `${itemKey}已保存`)
    }

    return (
        <HStack>
            <Label
                title=""
                systemImage={recordIcon("时间")}
            />
            <TextField
                label={
                    <Text
                        frame={{ width: 0, height: 0 }}
                        opacity={0}
                    >
                        名称
                    </Text>
                }
                value={draftKey}
                onChanged={renameTimeRecord}
                textFieldStyle="plain"
                frame={{ maxWidth: "infinity", alignment: "leading" }}
            />
            <Spacer />
            <DatePicker
                title="时间"
                value={timeDateFromValue(itemValue)}
                displayedComponents={["hourAndMinute"]}
                onChanged={(nextValue: Date | number) => updateTimeValue(timeValueFromPicker(nextValue))}
                labelsHidden
            />
        </HStack>
    )
}

function PendingTimeRecordRow({
    record,
    onChanged
}: {
    record: PendingTimeRecord
    onChanged: (record: PendingTimeRecord) => void
}) {
    return (
        <HStack>
            <Label
                title=""
                systemImage={recordIcon("时间")}
            />
            <TextField
                label={
                    <Text
                        frame={{ width: 0, height: 0 }}
                        opacity={0}
                    >
                        名称
                    </Text>
                }
                value={record.key}
                onChanged={(key: string) => onChanged({ ...record, key })}
                textFieldStyle="plain"
                frame={{ maxWidth: "infinity", alignment: "leading" }}
            />
            <Spacer />
            <DatePicker
                title="时间"
                value={timeDateFromValue(record.value)}
                displayedComponents={["hourAndMinute"]}
                onChanged={(nextValue: Date | number) => onChanged({
                    ...record,
                    value: timeValueFromPicker(nextValue)
                })}
                labelsHidden
            />
        </HStack>
    )
}

function TimeRecordSection({
    config,
    updateConfig,
    pendingRecords,
    setPendingRecords,
    sortValueNumericAsc = false
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
    pendingRecords: PendingTimeRecord[]
    setPendingRecords: (records: PendingTimeRecord[]) => void
    sortValueNumericAsc?: boolean
}) {
    const title = "时间"
    const entryOptions = {
        sortValueNumericAsc
    }

    async function deleteItems(items: RecordEntryItem[]) {
        await updateConfig(draft => {
            for (const item of items) {
                delete draft["时间"][item.key]
            }
        }, "时间已删除并保存")
    }

    function addTimeRecord() {
        setPendingRecords([
            ...pendingRecords,
            {
                id: `pending-time-${Date.now()}-${pendingRecords.length}`,
                key: "",
                value: "2359"
            }
        ])
    }

    function updatePendingRecord(nextRecord: PendingTimeRecord) {
        setPendingRecords(pendingRecords.map(record => (
            record.id === nextRecord.id ? nextRecord : record
        )))
    }

    const entries = useDeletableEntries(
        recordEntryItems(config, "时间", entryOptions),
        deleteItems
    )

    return (
        <CollapsibleSection
            title={title}
            summary={`${entries.value.length} 项`}
            icon={recordIcon("时间")}
        >
            <ForEach
                data={entries}
                editActions="delete"
                builder={(item) => (
                    <TimeRecordRow
                        key={item.id}
                        itemKey={item.key}
                        itemValue={item.value}
                        updateConfig={updateConfig}
                    />
                )}
            />

            {pendingRecords.map(record => (
                <PendingTimeRecordRow
                    key={record.id}
                    record={record}
                    onChanged={updatePendingRecord}
                />
            ))}

            <Button
                title="新增时间"
                systemImage="plus.circle.fill"
                action={addTimeRecord}
            />
        </CollapsibleSection>
    )
}

function RecordSection({
    title,
    group,
    config,
    updateConfig,
    sortNumericDesc = false,
    sortValueNumericAsc = false
}: {
    title: string
    group: RecordGroupKey
    config: AlertpilotConfig
    updateConfig: UpdateConfig
    sortNumericDesc?: boolean
    sortValueNumericAsc?: boolean
}) {
    const entryOptions = {
        sortNumericDesc,
        sortValueNumericAsc
    }

    async function deleteItems(items: RecordEntryItem[]) {
        await updateConfig(draft => {
            for (const item of items) {
                delete draft[group][item.key]
            }
        }, `${title}已删除并保存`)
    }

    const entries = useDeletableEntries(
        recordEntryItems(config, group, entryOptions),
        deleteItems
    )

    return (
        <CollapsibleSection
            title={title}
            summary={`${entries.value.length} 项`}
            icon={recordIcon(group)}
        >
            <ForEach
                data={entries}
                editActions="delete"
                builder={(item) => {
                    const { key, value } = item

                    return (
                        <NavigationLink
                            key={item.id}
                            destination={
                                <RecordDetailPage
                                    title={title}
                                    group={group}
                                    itemKey={key}
                                    itemValue={value}
                                    config={config}
                                    updateConfig={updateConfig}
                                />
                            }
                        >
                            <RowText
                                title={key}
                                value={value}
                                icon={recordIcon(group)}
                            />
                        </NavigationLink>
                    )
                }}
            />

            <NavigationLink
                destination={
                    <RecordDetailPage
                        title={`新增${title}`}
                        group={group}
                        itemKey=""
                        itemValue=""
                        config={config}
                        updateConfig={updateConfig}
                        isNew
                    />
                }
            >
                <RowText
                    title={`新增${title}`}
                    value="进入页面添加"
                    icon="plus.circle.fill"
                />
            </NavigationLink>
        </CollapsibleSection>
    )
}

function RecordDetailPage({
    title,
    group,
    itemKey,
    itemValue,
    config,
    updateConfig,
    isNew = false
}: {
    title: string
    group: RecordGroupKey
    itemKey: string
    itemValue: string
    config: AlertpilotConfig
    updateConfig: UpdateConfig
    isNew?: boolean
}) {
    const [keyText, setKeyText] = useState(itemKey)
    const [valueText, setValueText] = useState(itemValue)
    const dismiss = Navigation.useDismiss()

    async function saveRecord() {
        const finalKey = keyText.trim()

        if (!finalKey) {
            await Dialog.alert({
                title: "保存失败",
                message: "键不能为空"
            })
            return
        }

        const saved = await updateConfig(draft => {
            if (!isNew && finalKey !== itemKey) {
                delete draft[group][itemKey]
            }

            draft[group][finalKey] = valueText
        }, isNew ? `${title.replace("新增", "")}已新增并保存` : `${title}已保存`)

        if (saved) {
            dismiss()
        }
    }

    return (
        <List
            navigationTitle={title}
            navigationBarTitleDisplayMode="inline"
            toolbar={{
                keyboard: keyboardEditingToolbarButtons("detail"),
                topBarTrailing: (
                    <Button
                        title="保存"
                        systemImage="checkmark.circle.fill"
                        action={() => {
                            void saveRecord()
                        }}
                    />
                )
            }}
        >
            <Section header={<Text>编辑内容</Text>}>
                {isNew ? null : (
                    <RowText
                        title="当前项目"
                        value={`${itemKey} → ${itemValue}`}
                        icon={recordIcon(group)}
                    />
                )}

                <TextField
                    title="名称"
                    value={keyText}
                    onChanged={value => {
                        setKeyText(value)
                    }}
                />

                {group === "时间" ? (
                    <TimePickerRow
                        title="内容"
                        value={valueText}
                        onChanged={setValueText}
                    />
                ) : (
                    <TextField
                        title="内容"
                        value={valueText}
                        onChanged={value => {
                            setValueText(value)
                        }}
                    />
                )}
            </Section>
        </List>
    )
}

function TimeCompletionSection({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    async function deleteItems(items: TimeCompletionEntryItem[]) {
        await updateConfig(draft => {
            for (const item of items) {
                delete draft["时间补全"][item.key]
            }
        }, "时间补全已删除并保存")
    }

    const entries = useDeletableEntries(
        timeCompletionEntryItems(config),
        deleteItems
    )

    return (
        <CollapsibleSection
            title="时间补全"
            summary={`${entries.value.length} 项`}
            icon="arrow.triangle.swap"
        >
            <ForEach
                data={entries}
                editActions="delete"
                builder={(entry) => {
                    return (
                        <NavigationLink
                            key={entry.id}
                            destination={
                                <TimeCompletionDetailPage
                                    sourceKey={entry.key}
                                    sourceValue={entry.value}
                                    config={config}
                                    updateConfig={updateConfig}
                                />
                            }
                        >
                            <RowText
                                title={`${entry.key} → ${entry.value[0] || "未设置"}`}
                                value={`${entry.value[1] || "无地点"}${entry.value[2] ? ` / ${entry.value[2]}` : ""}`}
                                icon="arrow.triangle.swap"
                            />
                        </NavigationLink>
                    )
                }}
            />

            <NavigationLink
                destination={
                    <TimeCompletionDetailPage
                        sourceKey=""
                        sourceValue={["", "", ""]}
                        config={config}
                        updateConfig={updateConfig}
                        isNew
                    />
                }
            >
                <RowText
                    title="新增时间补全"
                    value="进入页面添加"
                    icon="plus.circle.fill"
                />
            </NavigationLink>
        </CollapsibleSection>
    )
}

function TimeCompletionDetailPage({
    sourceKey,
    sourceValue,
    config,
    updateConfig,
    isNew = false
}: {
    sourceKey: string
    sourceValue: [string, string, string]
    config: AlertpilotConfig
    updateConfig: UpdateConfig
    isNew?: boolean
}) {
    const [keyText, setKeyText] = useState(sourceKey)
    const [nextTime, setNextTime] = useState(sourceValue[0] || "")
    const [location, setLocation] = useState(sourceValue[1] || "")
    const [otherTime, setOtherTime] = useState(sourceValue[2] || "")
    const [isNextTimeCustom, setIsNextTimeCustom] = useState(false)
    const [isKeyCustom, setIsKeyCustom] = useState(false)
    const dismiss = Navigation.useDismiss()

    // 初始化时检查是否为自定义时间
    useEffect(() => {
        // 检查开始时间是否在配置中
        const timeKeys = Object.keys(config["时间"] || {})
        const isKeyInConfig = timeKeys.includes(keyText) || keyText === ""
        setIsKeyCustom(!isKeyInConfig && keyText !== "")

        // 检查下一时间是否在配置中
        const isNextTimeInConfig = timeKeys.includes(nextTime)
        const isNextTimeEmpty = nextTime === ""
        setIsNextTimeCustom(!isNextTimeInConfig && !isNextTimeEmpty)
    }, [])

    async function saveRecord() {
        const finalKey = keyText.trim()

        if (!finalKey) {
            await Dialog.alert({
                title: "保存失败",
                message: "时间键不能为空"
            })
            return
        }

        const saved = await updateConfig(draft => {
            if (!isNew && sourceKey !== finalKey) {
                delete draft["时间补全"][sourceKey]
            }

            draft["时间补全"][finalKey] = [
                nextTime,
                location,
                otherTime
            ]
        }, isNew ? "时间补全已新增并保存" : "时间补全已保存")

        if (saved) {
            dismiss()
        }
    }

    return (
        <List
            navigationTitle={isNew ? "新增时间补全" : "时间补全"}
            navigationBarTitleDisplayMode="inline"
            toolbar={{
                keyboard: keyboardEditingToolbarButtons("detail"),
                topBarTrailing: (
                    <Button
                        title="保存"
                        systemImage="checkmark.circle.fill"
                        action={() => {
                            void saveRecord()
                        }}
                    />
                )
            }}
        >
            <Section header={<Text>补全规则</Text>}>
                {isNew ? null : (
                    <RowText
                        title="当前规则"
                        value={`${sourceKey} → ${sourceValue[0] || "未设置"}`}
                        icon="arrow.triangle.swap"
                    />
                )}

                <HStack>
                    <ConfigRowLabel
                        title="开始时间"
                        systemImage="clock"
                    />
                    <Spacer />
                    <Picker
                        title=""
                        value={isKeyCustom ? "__custom__" : keyText}
                        onChanged={(value: string) => {
                            if (value === "__custom__") {
                                setIsKeyCustom(true)
                            } else {
                                setIsKeyCustom(false)
                                setKeyText(value)
                            }
                        }}
                    >
                        {["", ...Object.keys(config["时间"] || {})].map(value => (
                            <Text key={`key-${value || "empty"}`} tag={value}>{value || "空"}</Text>
                        ))}
                        <Text key="key-custom" tag="__custom__">指定时间</Text>
                    </Picker>
                    {isKeyCustom ? (
                        <DatePicker
                            title=""
                            value={timeDateFromValue(keyText)}
                            displayedComponents={["hourAndMinute"]}
                            onChanged={(nextValue: Date | number) => setKeyText(timeValueFromPicker(nextValue))}
                            labelsHidden
                        />
                    ) : null}
                </HStack>

                <HStack>
                    <ConfigRowLabel
                        title="下一时间"
                        systemImage="clock.arrow.2.circlepath"
                    />
                    <Spacer />
                    <Picker
                        title=""
                        value={isNextTimeCustom ? "__custom__" : nextTime}
                        onChanged={(value: string) => {
                            if (value === "__custom__") {
                                setIsNextTimeCustom(true)
                            } else {
                                setIsNextTimeCustom(false)
                                setNextTime(value)
                            }
                        }}
                    >
                        {["", ...Object.keys(config["时间"] || {})].map(value => (
                            <Text key={`next-${value || "empty"}`} tag={value}>{value || "空"}</Text>
                        ))}
                        <Text key="next-custom" tag="__custom__">指定时间</Text>
                    </Picker>
                    {isNextTimeCustom ? (
                        <DatePicker
                            title=""
                            value={timeDateFromValue(nextTime)}
                            displayedComponents={["hourAndMinute"]}
                            onChanged={(nextValue: Date | number) => setNextTime(timeValueFromPicker(nextValue))}
                            labelsHidden
                        />
                    ) : null}
                </HStack>

                <Picker
                    title="地点"
                    systemImage="location"
                    value={location}
                    onChanged={(value: string) => setLocation(value)}
                >
                    {["", ...Object.keys(config["地点"] || {})].map(value => (
                        <Text key={`loc-${value || "empty"}`} tag={value}>{value || "空"}</Text>
                    ))}
                </Picker>

                <Picker
                    title="附加时间"
                    systemImage="calendar.badge.clock"
                    value={otherTime}
                    onChanged={(value: string) => setOtherTime(value)}
                >
                    {["", ...Object.keys(config["附加时间"] || {})].map(value => (
                        <Text key={`other-${value || "empty"}`} tag={value}>{value || "空"}</Text>
                    ))}
                </Picker>
            </Section>
        </List>
    )
}

function AutoCompletionSection({
    config,
    updateConfig
}: {
    config: AlertpilotConfig
    updateConfig: UpdateConfig
}) {
    async function deleteItems(items: AutoCompletionEntryItem[]) {
        await updateConfig(draft => {
            const sorted = items
                .map(item => item.index)
                .sort((a, b) => b - a)

            for (const index of sorted) {
                draft["自动补全"][0].splice(index, 1)
                draft["自动补全"][1].splice(index, 1)
            }
        }, "自动补全已删除并保存")
    }

    const entries = useDeletableEntries(
        autoCompletionEntryItems(config),
        deleteItems
    )

    return (
        <CollapsibleSection
            title="自动补全"
            summary={`${entries.value.length} 项`}
            icon="wand.and.stars"
        >
            <ForEach
                data={entries}
                editActions="delete"
                builder={(entry) => {
                    return (
                        <NavigationLink
                            key={entry.id}
                            destination={
                                <AutoCompletionDetailPage
                                    index={entry.index}
                                    sourceDaypart={entry.daypart}
                                    sourceLocation={entry.location}
                                    updateConfig={updateConfig}
                                />
                            }
                        >
                            <RowText
                                title={entry.daypart}
                                value={entry.location}
                                icon="wand.and.stars"
                            />
                        </NavigationLink>
                    )
                }}
            />

            <NavigationLink
                destination={
                    <AutoCompletionDetailPage
                        index={entries.value.length}
                        sourceDaypart=""
                        sourceLocation=""
                        updateConfig={updateConfig}
                        isNew
                    />
                }
            >
                <RowText
                    title="新增自动补全"
                    value="进入页面添加"
                    icon="plus.circle.fill"
                />
            </NavigationLink>
        </CollapsibleSection>
    )
}

function AutoCompletionDetailPage({
    index,
    sourceDaypart,
    sourceLocation,
    updateConfig,
    isNew = false
}: {
    index: number
    sourceDaypart: string
    sourceLocation: string
    updateConfig: UpdateConfig
    isNew?: boolean
}) {
    const [daypart, setDaypart] = useState(sourceDaypart)
    const [location, setLocation] = useState(sourceLocation)
    const dismiss = Navigation.useDismiss()

    async function saveRecord() {
        const saved = await updateConfig(draft => {
            if (isNew) {
                draft["自动补全"][0].push(daypart)
                draft["自动补全"][1].push(location)
            } else {
                draft["自动补全"][0][index] = daypart
                draft["自动补全"][1][index] = location
            }
        }, isNew ? "自动补全已新增并保存" : "自动补全已保存")

        if (saved) {
            dismiss()
        }
    }

    return (
        <List
            navigationTitle={isNew ? "新增自动补全" : "自动补全"}
            navigationBarTitleDisplayMode="inline"
            toolbar={{
                keyboard: keyboardEditingToolbarButtons("detail"),
                topBarTrailing: (
                    <Button
                        title="保存"
                        systemImage="checkmark.circle.fill"
                        action={() => {
                            void saveRecord()
                        }}
                    />
                )
            }}
        >
            <Section header={<Text>补全词组</Text>}>
                {isNew ? null : (
                    <RowText
                        title="当前词组"
                        value={`${sourceDaypart} → ${sourceLocation}`}
                        icon="wand.and.stars"
                    />
                )}

                <TextField
                    title="时间词"
                    value={daypart}
                    onChanged={setDaypart}
                />

                <TextField
                    title="地点词"
                    value={location}
                    onChanged={setLocation}
                />
            </Section>
        </List>
    )
}
