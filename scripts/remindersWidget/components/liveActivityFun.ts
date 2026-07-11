import { LiveActivity } from "scripting"
import { ReminderLiveActivity, ReminderState, activityName } from "../live_activity"
import { notification } from "./model"
import { config } from "./config"
import { loadLiveActivityAllID, saveLiveActivityAllID, LARecordInfo } from "./store"


const fileName = "Live Activity"

// /** === 存储：identifier <-> liveActivityId 映射（文档 §11：可用 Storage） === */
// type RecordInfo = { reminderId: string; liveActivityId: string }
// const storageKey = "liveActivity.records"

// function loadRecords(): RecordInfo[] {
//     return Storage.get<RecordInfo[]>(storageKey) ?? []
// }
// function saveRecords(records: RecordInfo[]) {
//     Storage.set(storageKey, records)
// }

/** 清理无效/重复记录（防止长期运行后脏数据导致逻辑异常） */
function normalizeRecords(records: LARecordInfo[]): LARecordInfo[] {
    const seen = new Set<string>()
    const out: LARecordInfo[] = []
    for (const r of records ?? []) {
        if (!r?.reminderId || !r?.liveActivityId) continue
        const key = `${r.reminderId}@@${r.liveActivityId}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ reminderId: r.reminderId, liveActivityId: r.liveActivityId })
    }
    return out
}

function safeParseDateMs(iso: string): number | null {
    if (!iso) return null
    const t = Date.parse(iso)
    return Number.isFinite(t) ? t : null
}

/** 统一构造 contentState（保持 JSON 可序列化：不放 Date 对象）（文档 §9.1） */
function makeState(
    title: string,
    identifier: string,
    dueDate: string,
    notes?: string,
    isCompleted?: boolean,
    startDate?: string
): ReminderState {
    return { title, identifier, dueDate, notes, isCompleted, startDate: startDate ?? new Date().toISOString() }
}

// /** 给 start/update 的 staleDate：用 dueDate（若可解析）作为过期点（文档 §7.1/7.2） */
// function makeStaleDateOption(dueDate: string) {
//     const ms = safeParseDateMs(dueDate)
//     return ms != null ? { staleDate: new Date(ms) } : undefined
// }

/** === 低层：通过 activityId 获取实例并 update === */
async function updateByActivityId(
    liveActivityId: string,
    state: ReminderState
): Promise<boolean> {
    const act = await LiveActivity.from<ReminderState>(liveActivityId, activityName)
    if (!act) return false
    return await act.update(state)
}

/** === 低层：创建一个新 Live Activity ===（文档 §7.1：start 需等待 true） */
async function startNewActivity(state: ReminderState): Promise<{ ok: boolean; id?: string }> {
    const enabled = await LiveActivity.areActivitiesEnabled()
    if (!enabled) return { ok: false }

    const activity = ReminderLiveActivity()
    const ok = await activity.start(state)
    if (!ok) return { ok: false }

    const id = activity.activityId
    return { ok: true, id: id ?? undefined }
}

/** === 高层：按 identifier 更新；无映射则创建；超上限则替换第一个 === */
export async function startReminderActivity(
    title: string,
    identifier: string,
    dueDate: string,
    notes?: string
): Promise<boolean> {
    try {
        const state = makeState(title, identifier, dueDate, notes, false, new Date().toISOString())

        // 1) 先尝试按映射更新
        let records = normalizeRecords(loadLiveActivityAllID())
        const mapped = records.find((r) => r.reminderId === identifier)

        if (mapped) {
            const ok = await updateByActivityId(mapped.liveActivityId, state)
            if (ok) {
                notification(fileName, "实时活动已更新", config.debug, true)
                return true
            }

            // 映射存在但系统活动已无（文档 §7.6 from 可能返回 null）→ 清理映射后走创建/替换
            records = records.filter((r) => r.liveActivityId !== mapped.liveActivityId)
            saveLiveActivityAllID(records)
        }

        // 2) 无映射：检查系统现有活动数量（文档 §7.6 getAllActivitiesIds）
        const ids = await LiveActivity.getAllActivitiesIds()
        const maxCount = config?.maxLiveActivityCount ?? 3

        if (ids.length < maxCount) {
            const started = await startNewActivity(state)
            if (started.ok && started.id) {
                records = normalizeRecords(loadLiveActivityAllID())
                records.push({ reminderId: identifier, liveActivityId: started.id })
                saveLiveActivityAllID(normalizeRecords(records))
                notification(fileName, "实时活动已启动", config.debug, true)
                return true
            }

            notification(fileName, "启动失败", config.debug, false)
            return false
        }

        // 3) 达上限：替换第一个活动（保持你原始策略：ids[0]）
        const toReplaceId = ids[0]
        const ok = await updateByActivityId(toReplaceId, state)

        if (ok) {
            records = normalizeRecords(loadLiveActivityAllID())

            // 旧的替换目标可能在 records 里对应某 reminderId：把它改成新的 identifier
            const rec = records.find((r) => r.liveActivityId === toReplaceId)
            if (rec) rec.reminderId = identifier
            else records.push({ reminderId: identifier, liveActivityId: toReplaceId })

            saveLiveActivityAllID(normalizeRecords(records))
            notification(fileName, "实时活动已替换/更新", config.debug, true)
            return true
        }

        notification(fileName, "替换失败", config.debug, false)
        return false
    } catch (err) {
        notification(fileName, `启动或更新失败: ${String(err)}`, config.debug, false)
        return false
    }
}

/** === 结束：按 identifier 查映射并 end，然后清理映射 ===（文档 §7.3） */
export async function endActivityByIdentifier(
    title: string,
    identifier: string,
    notes?: string
): Promise<boolean> {
    const records = normalizeRecords(loadLiveActivityAllID())
    const rec = records.find((r) => r.reminderId === identifier)

    if (!rec) {
        notification(fileName, "没有找到对应的实时活动记录", config.debug, false)
        return false
    }

    const act = await LiveActivity.from<ReminderState>(rec.liveActivityId, activityName)
    if (!act) {
        // 系统活动已不存在：清理映射即可
        const remaining = records.filter((r) => r.liveActivityId !== rec.liveActivityId)
        saveLiveActivityAllID(normalizeRecords(remaining))
        notification(fileName, "系统活动已不存在，已清理记录", config.debug, true)
        return false
    }

    const endState = makeState(title, identifier, "", notes, true, new Date().toISOString())

    const ok = await act.end(endState, {
        dismissTimeInterval: config?.liveActivityDismissTimeInterval,
    })

    if (ok) {
        const remaining = records.filter((r) => r.liveActivityId !== rec.liveActivityId)
        saveLiveActivityAllID(normalizeRecords(remaining))
        notification(fileName, "实时活动已结束", config.debug, true)
    } else {
        notification(fileName, "结束失败", config.debug, false)
    }

    return ok
}
