import { type ShapeStyle } from "scripting"

const STORAGE_KEYS = {
    liveActivityAllID: "liveActivity.allID",
    currentRemindersNum: "liveActivity.currentCount",
    reminderPageIndex: "widget.reminderPageIndex",
    reminderScheduleMetaById: "widget.reminderScheduleMetaById",
} as const

// 工作时间常量（如需修改直接改这里）
const workTimeStart = 830  // 08:30
const workTimeEnd = 1730   // 17:30

const reminderBridgePrefix = "[[AlertpilotMeta:"
const reminderBridgeSuffix = "]]"

export type ReminderScheduleKind = "work" | "rest"

export type ReminderBridgeMetadata = {
    note: string
    scheduleKind: ReminderScheduleKind
    dueDate?: string | null
    createdAt?: string
    [key: string]: unknown
}

export type ReminderScheduleMetaRecord = ReminderBridgeMetadata & {
    identifier: string
    resolvedAt: string
}

export type LARecordInfo = {
    reminderId: string
    liveActivityId: string
}

export function buildReminderBridgeNote(metadata: ReminderBridgeMetadata): string {
    return `${reminderBridgePrefix}${JSON.stringify(metadata)}${reminderBridgeSuffix}`
}

export function parseReminderBridgeNote(note?: string | null): {
    metadata?: ReminderBridgeMetadata
    cleanNote: string
    hasBridge: boolean
} {
    const rawNote = String(note ?? "")
    const startIndex = rawNote.indexOf(reminderBridgePrefix)
    if (startIndex === -1) {
        return { cleanNote: rawNote, hasBridge: false }
    }

    const endIndex = rawNote.indexOf(reminderBridgeSuffix, startIndex + reminderBridgePrefix.length)
    if (endIndex === -1) {
        return { cleanNote: rawNote, hasBridge: false }
    }

    const jsonText = rawNote.slice(startIndex + reminderBridgePrefix.length, endIndex)
    try {
        const metadata = JSON.parse(jsonText) as ReminderBridgeMetadata
        const cleanNote = typeof metadata.note === "string"
            ? metadata.note
            : `${rawNote.slice(0, startIndex)}${rawNote.slice(endIndex + reminderBridgeSuffix.length)}`.trim()
        return { metadata, cleanNote, hasBridge: true }
    } catch {
        return { cleanNote: rawNote, hasBridge: false }
    }
}

export function getAllStorageKeys(): string[] {
    return Object.values(STORAGE_KEYS)
}

export function loadLiveActivityAllID(): LARecordInfo[] {
    return Storage.get<LARecordInfo[]>(STORAGE_KEYS.liveActivityAllID) ?? []
}

export function saveLiveActivityAllID(value: LARecordInfo[]) {
    Storage.set(STORAGE_KEYS.liveActivityAllID, value)
}

export function loadCurrentRemindersNum(): number {
    return Storage.get<number>(STORAGE_KEYS.currentRemindersNum) ?? 0
}

export function saveCurrentRemindersNum(count: number) {
    Storage.set(STORAGE_KEYS.currentRemindersNum, count)
}

export function loadReminderPageIndex(): number {
    return Storage.get<number>(STORAGE_KEYS.reminderPageIndex) ?? 0
}

export function saveReminderPageIndex(index: number) {
    Storage.set(STORAGE_KEYS.reminderPageIndex, Math.max(0, Math.floor(index)))
}

export function nextReminderPageIndex() {
    saveReminderPageIndex(loadReminderPageIndex() + 1)
}

export function loadReminderScheduleMetaById(): Record<string, ReminderScheduleMetaRecord> {
    return Storage.get<Record<string, ReminderScheduleMetaRecord>>(STORAGE_KEYS.reminderScheduleMetaById) ?? {}
}

export function saveReminderScheduleMetaById(value: Record<string, ReminderScheduleMetaRecord>) {
    Storage.set(STORAGE_KEYS.reminderScheduleMetaById, value)
}

export function upsertReminderScheduleMeta(identifier: string, metadata: ReminderBridgeMetadata): ReminderScheduleMetaRecord {
    const current = loadReminderScheduleMetaById()
    const record: ReminderScheduleMetaRecord = {
        ...metadata,
        identifier,
        dueDate: metadata.dueDate ?? null,
        resolvedAt: new Date().toISOString(),
    }
    current[identifier] = record
    saveReminderScheduleMetaById(current)
    return record
}

export function getReminderScheduleMeta(identifier?: string | null): ReminderScheduleMetaRecord | undefined {
    if (!identifier) return undefined
    return loadReminderScheduleMetaById()[identifier]
}

export async function getReminderScheduleColor(identifier?: string | null, dueDate?: Date | null): Promise<ShapeStyle> {
    const scheduleKind = getReminderScheduleMeta(identifier)?.scheduleKind
    const workColor = "rgba(150,170,200,0.25)"
    const restColor = "rgba(210,150,185,0.3)"
    if (scheduleKind === "work") return workColor
    if (scheduleKind === "rest") return restColor

    // 本地默认时间判断（如需修改直接改文件顶部的 workTimeStart / workTimeEnd）
    const now = dueDate instanceof Date ? dueDate : new Date()
    const currentHHmm = now.getHours() * 100 + now.getMinutes()
    const isWorkTime = currentHHmm >= workTimeStart && currentHHmm < workTimeEnd

    return isWorkTime ? workColor : restColor
}
