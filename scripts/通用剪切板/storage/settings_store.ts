import { DEFAULT_AI_SETTINGS, DEFAULT_CAIS_SETTINGS, DEFAULT_SYNC_CLIPBOARD_SETTINGS, type AISettings, type AppStartPage, type CaisSettings, type KeyboardCustomAction, type KeyboardMenuBuiltinAction, type SyncClipboardAccount, type SyncClipboardSettings } from "../types"
import { makeId } from "../utils/common"
import { loadSetting, saveSetting } from "./database"

const SETTINGS_KEY = "cais_settings_v1"
const SHARED_OPTIONS = { shared: true }

function getStorage(): any {
  return (globalThis as any).Storage
}

function sanitizeCustomActionMode(value: any): KeyboardCustomAction["mode"] {
  if (value === "regex" || value === "regexExtract") return "regexExtract"
  if (value === "regexRemove") return "regexRemove"
  if (value === "javascript") return "javascript"
  return "template"
}

function syncAccountId(account: Pick<SyncClipboardAccount, "id" | "url" | "username">): string {
  const id = String(account.id || "").trim()
  if (id) return id
  return syncAccountKey(account)
}

function syncAccountKey(account: Pick<SyncClipboardAccount, "url" | "username">): string {
  return `${account.url.trim().replace(/\/+$/, "")}\n${account.username}`
}

function sanitizeSyncAccount(raw: any): SyncClipboardAccount | null {
  const url = String(raw?.url ?? "").trim().replace(/\/+$/, "")
  if (!url) return null
  return {
    id: String(raw?.id ?? "").trim() || makeId("sync_account"),
    url,
    username: String(raw?.username ?? ""),
    password: String(raw?.password ?? ""),
    allowInsecure: Boolean(raw?.allowInsecure ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.allowInsecure),
  }
}

function upsertSyncAccount(accounts: SyncClipboardAccount[], account: SyncClipboardAccount): SyncClipboardAccount[] {
  const id = syncAccountId(account)
  const key = syncAccountKey(account)
  const next = accounts.filter((item) => syncAccountId(item) !== id && syncAccountKey(item) !== key)
  next.unshift({ ...account, id })
  return next.slice(0, 20)
}

function sanitizeSyncClipboard(raw: any): SyncClipboardSettings {
  const intervalSec = Number(raw?.intervalSec ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.intervalSec)
  const retryCount = Number(raw?.retryCount ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.retryCount)
  const timeoutSec = Number(raw?.timeoutSec ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.timeoutSec)
  const maxItems = Number(raw?.maxItems ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.maxItems)
  const maxUploadFileSizeMb = Number(raw?.maxUploadFileSizeMb ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.maxUploadFileSizeMb)
  const url = String(raw?.url ?? "").trim().replace(/\/+$/, "")
  const currentAccount = sanitizeSyncAccount({
    id: raw?.currentAccountId,
    url,
    username: raw?.username,
    password: raw?.password,
    allowInsecure: raw?.allowInsecure,
  })
  const accounts = (Array.isArray(raw?.accounts) ? raw.accounts : [])
    .map(sanitizeSyncAccount)
    .filter(Boolean) as SyncClipboardAccount[]
  const uniqueAccounts = accounts.reduce((result, account) => upsertSyncAccount(result, account), [] as SyncClipboardAccount[])
  const finalAccounts = currentAccount ? upsertSyncAccount(uniqueAccounts, currentAccount) : uniqueAccounts
  return {
    enabled: Boolean(raw?.enabled ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.enabled),
    url,
    username: String(raw?.username ?? ""),
    password: String(raw?.password ?? ""),
    currentAccountId: currentAccount?.id ?? String(raw?.currentAccountId ?? ""),
    accounts: finalAccounts,
    intervalSec: Math.max(2, Math.min(3600, intervalSec || DEFAULT_SYNC_CLIPBOARD_SETTINGS.intervalSec)),
    retryCount: Math.max(0, Math.min(20, retryCount || DEFAULT_SYNC_CLIPBOARD_SETTINGS.retryCount)),
    timeoutSec: Math.max(5, Math.min(600, timeoutSec || DEFAULT_SYNC_CLIPBOARD_SETTINGS.timeoutSec)),
    maxItems: Math.max(10, Math.min(500, maxItems || DEFAULT_SYNC_CLIPBOARD_SETTINGS.maxItems)),
    allowInsecure: Boolean(raw?.allowInsecure ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.allowInsecure),
    autoUpload: Boolean(raw?.autoUpload ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.autoUpload),
    uploadText: Boolean(raw?.uploadText ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.uploadText),
    uploadSingleFile: Boolean(raw?.uploadSingleFile ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.uploadSingleFile),
    uploadMultipleFiles: Boolean(raw?.uploadMultipleFiles ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.uploadMultipleFiles),
    maxUploadFileSizeMb: Math.max(1, Math.min(2048, maxUploadFileSizeMb || DEFAULT_SYNC_CLIPBOARD_SETTINGS.maxUploadFileSizeMb)),
    autoDownload: Boolean(raw?.autoDownload ?? DEFAULT_SYNC_CLIPBOARD_SETTINGS.autoDownload),
    maxAutoDownloadFileSizeMb: Math.max(1, Math.min(1024, raw?.maxAutoDownloadFileSizeMb || DEFAULT_SYNC_CLIPBOARD_SETTINGS.maxAutoDownloadFileSizeMb)),
    fileAutoDownloadFilterMode: (raw?.fileAutoDownloadFilterMode === "whitelist" || raw?.fileAutoDownloadFilterMode === "blacklist") ? raw.fileAutoDownloadFilterMode : "disabled",
    fileAutoDownloadExtensions: Array.isArray(raw?.fileAutoDownloadExtensions) ? raw.fileAutoDownloadExtensions.filter((ext: any) => typeof ext === "string" && ext.trim()) : [],
  }
}

function sanitizeAppStartPage(value: any): AppStartPage {
  if (value === "favorites" || value === "network" || value === "memos" || value === "settings" || value === "ai") return value
  return "network"
}

function sanitizeAIProvider(value: any): string {
  const known = ["script", "openai", "gemini", "anthropic", "deepseek", "openrouter"]
  const str = String(value ?? "").trim()
  if (!str) return DEFAULT_AI_SETTINGS.defaultProvider
  return known.includes(str) ? str : str
}

function sanitizeAISettings(raw: any): AISettings {
  const now = Date.now()
  const assistants = Array.isArray(raw?.assistants)
    ? raw.assistants.map((item: any, index: number) => ({
      id: String(item?.id ?? `ai-${now}-${index}`),
      name: String(item?.name ?? "").trim(),
      systemPrompt: String(item?.systemPrompt ?? "").trim(),
      provider: sanitizeAIProvider(item?.provider),
      modelId: String(item?.modelId ?? "").trim(),
      sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item?.sortOrder) : index,
      createdAt: Number.isFinite(Number(item?.createdAt)) ? Number(item?.createdAt) : now,
      updatedAt: Number.isFinite(Number(item?.updatedAt)) ? Number(item?.updatedAt) : now,
    })).filter((item: any) => item.name)
    : []
  return {
    assistants,
    defaultProvider: sanitizeAIProvider(raw?.defaultProvider),
    defaultModelId: String(raw?.defaultModelId ?? "").trim(),
    columnsPerRow: Number.isFinite(Number(raw?.columnsPerRow)) ? Math.max(2, Math.min(4, Number(raw?.columnsPerRow))) : DEFAULT_AI_SETTINGS.columnsPerRow,
  }
}

function sanitizeSettings(raw: any): CaisSettings {
  const monitorIntervalMs = Number(raw?.monitorIntervalMs ?? DEFAULT_CAIS_SETTINGS.monitorIntervalMs)
  const maxItems = Number(raw?.maxItems ?? DEFAULT_CAIS_SETTINGS.maxItems)
  const appContentLineLimit = Number(raw?.appContentLineLimit ?? DEFAULT_CAIS_SETTINGS.appContentLineLimit)
  const keyboardMaxItems = Number(raw?.keyboardMaxItems ?? DEFAULT_CAIS_SETTINGS.keyboardMaxItems)
  const defaultBuiltins = DEFAULT_CAIS_SETTINGS.keyboardMenu.builtins
  const rawBuiltins = raw?.keyboardMenu?.builtins ?? {}
  const builtinKeys = Object.keys(defaultBuiltins) as KeyboardMenuBuiltinAction[]
  const builtins = builtinKeys.reduce((result, key) => {
    result[key] = Boolean(rawBuiltins[key] ?? defaultBuiltins[key])
    return result
  }, {} as Record<KeyboardMenuBuiltinAction, boolean>)
  const builtinOrder = Array.isArray(raw?.keyboardMenu?.builtinOrder)
    ? raw.keyboardMenu.builtinOrder
      .filter((key: any) => builtinKeys.includes(key))
      .map((key: any) => key as KeyboardMenuBuiltinAction)
    : undefined
  const customActions = Array.isArray(raw?.keyboardMenu?.customActions)
    ? raw.keyboardMenu.customActions
      .map((item: any): KeyboardCustomAction => ({
        id: String(item?.id ?? `custom_${Date.now()}`),
        title: String(item?.title ?? "").trim(),
        mode: sanitizeCustomActionMode(item?.mode),
        template: String(item?.template ?? ""),
        regex: String(item?.regex ?? ""),
        regexRemoveAll: Boolean(item?.regexRemoveAll ?? false),
        script: String(item?.script ?? ""),
        enabled: Boolean(item?.enabled ?? true),
      }))
      .filter((item: KeyboardCustomAction) => item.title && (
        item.mode === "template" ? item.template :
        item.mode === "javascript" ? item.script :
        item.regex
      ))
      .slice(0, 12)
    : []
  return {
    captureText: Boolean(raw?.captureText ?? DEFAULT_CAIS_SETTINGS.captureText),
    captureImages: Boolean(raw?.captureImages ?? DEFAULT_CAIS_SETTINGS.captureImages),
    monitorIntervalMs: Math.max(100, Math.min(10000, monitorIntervalMs || DEFAULT_CAIS_SETTINGS.monitorIntervalMs)),
    duplicatePolicy: raw?.duplicatePolicy === "skip" ? "skip" : "bump",
    maxItems: Math.max(50, Math.min(800, maxItems || DEFAULT_CAIS_SETTINGS.maxItems)),
    appContentLineLimit: Math.max(1, Math.min(12, appContentLineLimit || DEFAULT_CAIS_SETTINGS.appContentLineLimit)),
    keyboardShowTitle: Boolean(raw?.keyboardShowTitle ?? DEFAULT_CAIS_SETTINGS.keyboardShowTitle),
    showRimeKeyboardSwitch: Boolean(raw?.showRimeKeyboardSwitch ?? DEFAULT_CAIS_SETTINGS.showRimeKeyboardSwitch),
    showRemoteFiles: Boolean(raw?.showRemoteFiles ?? DEFAULT_CAIS_SETTINGS.showRemoteFiles),
    remoteTimeDisplay: raw?.remoteTimeDisplay === "createTime" ? "createTime" : "lastModified",
    inputClicks: Boolean(raw?.hapticEngineClicks ?? DEFAULT_CAIS_SETTINGS.hapticEngineClicks)
      ? false
      : Boolean(raw?.inputClicks ?? DEFAULT_CAIS_SETTINGS.inputClicks),
    hapticEngineClicks: Boolean(raw?.hapticEngineClicks ?? DEFAULT_CAIS_SETTINGS.hapticEngineClicks),
    keyboardMaxItems: [30, 50, 100, 200, 0].includes(keyboardMaxItems) ? keyboardMaxItems : DEFAULT_CAIS_SETTINGS.keyboardMaxItems,
    memoSubfieldSeparators: String(raw?.memoSubfieldSeparators ?? DEFAULT_CAIS_SETTINGS.memoSubfieldSeparators).trim() || DEFAULT_CAIS_SETTINGS.memoSubfieldSeparators,
    syncClipboard: sanitizeSyncClipboard(raw?.syncClipboard),
    ai: sanitizeAISettings(raw?.ai),
    defaultStartPage: sanitizeAppStartPage(raw?.defaultStartPage),
    keyboardMenu: {
      builtins,
      builtinOrder,
      customActions,
    },
    passwordVaultEnabled: Boolean(raw?.passwordVaultEnabled ?? DEFAULT_CAIS_SETTINGS.passwordVaultEnabled),
  }
}

// In-memory cache for settings
let settingsCache: CaisSettings | null = null
let settingsLoading = false
let settingsLoadPromise: Promise<CaisSettings> | null = null

export async function loadSettingsFromDB(): Promise<CaisSettings> {
  if (settingsCache) return settingsCache
  if (settingsLoadPromise) return settingsLoadPromise
  
  settingsLoading = true
  settingsLoadPromise = loadSetting(SETTINGS_KEY)
    .then(raw => {
      if (raw) {
        settingsCache = sanitizeSettings(raw)
      } else {
        settingsCache = { ...DEFAULT_CAIS_SETTINGS }
      }
      return settingsCache!
    })
    .catch(error => {
      console.error("Failed to load settings from DB:", error)
      throw error
    })
    .finally(() => {
      settingsLoading = false
      settingsLoadPromise = null
    })
  
  return settingsLoadPromise
}

export function loadSettings(): CaisSettings {
  // If cache is loaded (from DB or saveSettings), return it
  if (settingsCache) return settingsCache
  
  // If loading is in progress, return default settings (will be updated when loading completes)
  if (settingsLoading) return { ...DEFAULT_CAIS_SETTINGS }
  
  // DO NOT set settingsCache here — this is a synchronous fallback for first render.
  // The real values will be loaded by loadSettingsFromDB() in useEffect.
  // Setting cache here would block loadSettingsFromDB() from reading the database.
  return { ...DEFAULT_CAIS_SETTINGS }
}

export async function saveSettingsToDB(settings: CaisSettings): Promise<CaisSettings> {
  const fixed = sanitizeSettings(settings)
  
  // Update cache
  settingsCache = fixed
  
  // Save to SQLite
  await saveSetting(SETTINGS_KEY, fixed)
  return fixed
}

export function saveSettings(settings: CaisSettings): CaisSettings {
  const fixed = sanitizeSettings(settings)
  
  // Update cache
  settingsCache = fixed
  
  // Save to SQLite asynchronously
  saveSetting(SETTINGS_KEY, fixed).catch(error => {
    console.error("Failed to save settings to DB:", error)
  })
  
  return fixed
}

export function isSettingsLoading(): boolean {
  return settingsLoading
}
