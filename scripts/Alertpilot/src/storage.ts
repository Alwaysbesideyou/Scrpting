import { Path } from "scripting"
import { DEFAULT_CONFIG, PROJECT_KEY, getDefaultAdditionalTime, getDefaultLocation, getDefaultReminderList, getDefaultTime, getDefaultWorkdayTime, getDefaultRestDayTime } from "./config"
import type { AlertpilotConfig } from "./types"
import { pad2, formatDateTime } from "./utils"

export function getBaseDir() {
    const root = FileManager.isiCloudEnabled
        ? FileManager.iCloudDocumentsDirectory
        : FileManager.documentsDirectory

    return Path.join(root, PROJECT_KEY)
}

export function getConfigPath() {
    return Path.join(getBaseDir(), "setting.json")
}

export async function ensureDir(path: string) {
    if (!(await FileManager.exists(path))) {
        await FileManager.createDirectory(path, true)
    }
}

function migrateLegacyDefaultKeys(config: Partial<AlertpilotConfig>): Partial<AlertpilotConfig> {
    const next = JSON.parse(JSON.stringify(config || {})) as Partial<AlertpilotConfig> & Record<string, any>
    const defaults = {
        ...(DEFAULT_CONFIG["默认配置"] || {}),
        ...(next["默认配置"] || {})
    }

    defaults["提醒列表"] = defaults["提醒列表"] || next.defaultReminderList || next["提醒列表"]?.["默认"] || DEFAULT_CONFIG["默认配置"]["提醒列表"]
    defaults["附加时间"] = defaults["附加时间"] || next.defaultAdditionalTime || next["附加时间"]?.["默认"] || DEFAULT_CONFIG["默认配置"]["附加时间"]
    defaults["时间"] = defaults["时间"] || next.defaultTime || next["时间"]?.["默认"] || DEFAULT_CONFIG["默认配置"]["时间"]
    defaults["地点"] = defaults["地点"] || next.defaultLocation || next["地点"]?.["默认"] || DEFAULT_CONFIG["默认配置"]["地点"]
    next["默认配置"] = defaults

    delete next.defaultReminderList
    delete next.defaultAdditionalTime
    delete next.defaultTime
    delete next.defaultLocation
    delete next["提醒列表"]?.["默认"]
    delete next["附加时间"]?.["默认"]
    delete next["时间"]?.["默认"]
    delete next["地点"]?.["默认"]

    return next
}

function mergeConfig(config: Partial<AlertpilotConfig>): AlertpilotConfig {
    const migrated = migrateLegacyDefaultKeys(config)
    const merged = {
        ...DEFAULT_CONFIG,
        ...migrated,
        // Treat user-editable dictionary groups as complete saved values when present.
        // If we merge DEFAULT_CONFIG into these groups on every read, items deleted by
        // the user disappear from setting.json but are added back after reopening UI.
        "提醒列表": migrated["提醒列表"] ?? DEFAULT_CONFIG["提醒列表"],
        "时间补全": migrated["时间补全"] ?? DEFAULT_CONFIG["时间补全"],
        "附加时间": migrated["附加时间"] ?? DEFAULT_CONFIG["附加时间"],
        "时间": migrated["时间"] ?? DEFAULT_CONFIG["时间"],
        "地点": migrated["地点"] ?? DEFAULT_CONFIG["地点"],
        "默认配置": {
            ...DEFAULT_CONFIG["默认配置"],
            ...(migrated["默认配置"] || {})
        },
        restLocation: migrated.restLocation || DEFAULT_CONFIG.restLocation,
        userPreferences: {
            ...DEFAULT_CONFIG.userPreferences!,
            ...(migrated.userPreferences || {}),
            learning: {
                ...(DEFAULT_CONFIG.userPreferences?.learning || {}),
                ...(migrated.userPreferences?.learning || {})
            },
            learningByList: {
                ...(DEFAULT_CONFIG.userPreferences?.learningByList || {}),
                ...(migrated.userPreferences?.learningByList || {})
            },
            memory: {
                ...(DEFAULT_CONFIG.userPreferences?.memory || {}),
                ...(migrated.userPreferences?.memory || {}),
                global: migrated.userPreferences?.memory?.global || DEFAULT_CONFIG.userPreferences?.memory?.global || "",
                aiDaily: migrated.userPreferences?.memory?.aiDaily || DEFAULT_CONFIG.userPreferences?.memory?.aiDaily || [],
                aiMarkdown: migrated.userPreferences?.memory?.aiMarkdown || DEFAULT_CONFIG.userPreferences?.memory?.aiMarkdown || ""
            },
            holidayCache: {
                date: migrated.userPreferences?.holidayCache?.date || DEFAULT_CONFIG.userPreferences?.holidayCache?.date || "",
                months: migrated.userPreferences?.holidayCache?.months || DEFAULT_CONFIG.userPreferences?.holidayCache?.months || 12,
                text: migrated.userPreferences?.holidayCache?.text || DEFAULT_CONFIG.userPreferences?.holidayCache?.text || ""
            }
        },
        "自动补全": migrated["自动补全"] || DEFAULT_CONFIG["自动补全"]
    }

    merged["默认配置"] = {
        "提醒列表": getDefaultReminderList(merged),
        "附加时间": getDefaultAdditionalTime(merged),
        "时间": getDefaultTime(merged),
        "工作日时间": getDefaultWorkdayTime(merged),
        "休息日时间": getDefaultRestDayTime(merged),
        "地点": getDefaultLocation(merged)
    }

    return merged
}

export async function readConfig(): Promise<AlertpilotConfig> {
    const dir = getBaseDir()
    await ensureDir(dir)

    const file = getConfigPath()
    if (!(await FileManager.exists(file))) {
        await writeConfig(DEFAULT_CONFIG)
        return DEFAULT_CONFIG
    }

    try {
        const text = await FileManager.readAsString(file)
        return mergeConfig(JSON.parse(text))
    } catch {
        return DEFAULT_CONFIG
    }
}

export async function readConfigText(): Promise<string> {
    const config = await readConfig()
    return JSON.stringify(config, null, 2)
}

export async function writeConfig(config: AlertpilotConfig) {
    const dir = getBaseDir()
    await ensureDir(dir)

    const sanitized = migrateLegacyDefaultKeys(config) as AlertpilotConfig

    await FileManager.writeAsString(
        getConfigPath(),
        JSON.stringify(sanitized, null, 2)
    )
}

export async function writeConfigText(jsonText: string) {
    const parsed = JSON.parse(jsonText) as AlertpilotConfig
    await writeConfig(parsed)
    return parsed
}

export async function resetConfig() {
    await writeConfig(DEFAULT_CONFIG)
    return DEFAULT_CONFIG
}

export async function writeLog(logs: any[]) {
    const now = new Date()
    const dir = Path.join(getBaseDir(), "logs")
    await ensureDir(dir)

    const fileName = `${now.getFullYear()}年${pad2(now.getMonth() + 1)}月${pad2(now.getDate())}日 ${formatDateTime(now).slice(11).replace(/:/g, "")}.json`

    await FileManager.writeAsString(
        Path.join(dir, fileName),
        JSON.stringify(logs, null, 2)
    )
}

export async function writeChangelog(version: string, changelog: string): Promise<boolean> {
    const dir = Path.join(getBaseDir(), "changelog")
    await ensureDir(dir)

    const file = Path.join(dir, `${version}.txt`)
    if (await FileManager.exists(file)) return false

    await FileManager.writeAsString(file, changelog)
    return true
}