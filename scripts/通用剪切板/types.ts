export type ClipKind = "text" | "url" | "image"

export type ClipSource = "local" | "remote"

export type ClipPayload = {
  kind: ClipKind
  text?: string
  url?: string
  image?: UIImage
  sourceChangeCount?: number
  source?: ClipSource
}

export type ClipItem = {
  id: string
  kind: ClipKind
  title: string
  content: string
  contentHash: string
  imagePath?: string
  sourceChangeCount?: number
  source?: ClipSource
  createdAt: number
  updatedAt: number
  lastCopiedAt?: number
  pinned: boolean
  favorite: boolean
  manualFavorite?: boolean
  deletedAt?: number | null
}

export type AppStartPage = "favorites" | "clipboard" | "network" | "memos" | "ai" | "settings"

export type AIAssistantProvider = "script" | "openai" | "gemini" | "anthropic" | "deepseek" | "openrouter" | string

export type AIAssistant = {
  id: string
  name: string
  systemPrompt: string
  provider: AIAssistantProvider
  modelId: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type AISettings = {
  assistants: AIAssistant[]
  defaultProvider: AIAssistantProvider
  defaultModelId: string
  columnsPerRow: number
}

export type ClipListScope = "favorites" | "clipboard" | "all"

export type ClipboardClearRange = "recent" | "threeDays" | "sevenDays" | "older"

export type ClipGroup = {
  title: string
  items: ClipItem[]
}

export type CaptureResult =
  | { status: "created"; item: ClipItem }
  | { status: "updated"; item: ClipItem }
  | { status: "skipped"; reason: string }

export type DuplicatePolicy = "skip" | "bump"

export type SyncClipboardKind = "Text" | "Image" | "File" | "Group" | "Unknown" | "None"

export type SyncClipboardAccount = {
  id: string
  url: string
  username: string
  password: string
  allowInsecure: boolean
}

export type SyncClipboardSettings = {
  enabled: boolean
  url: string
  username: string
  password: string
  currentAccountId?: string
  accounts: SyncClipboardAccount[]
  intervalSec: number
  retryCount: number
  timeoutSec: number
  maxItems: number
  allowInsecure: boolean
  autoUpload: boolean
  uploadText: boolean
  uploadSingleFile: boolean
  uploadMultipleFiles: boolean
  maxUploadFileSizeMb: number
  autoDownload: boolean
  maxAutoDownloadFileSizeMb: number
  /** 文件自动下载过滤模式：disabled=不过滤，whitelist=白名单（只下载指定类型），blacklist=黑名单（不下载指定类型） */
  fileAutoDownloadFilterMode: "disabled" | "whitelist" | "blacklist"
  /** 文件自动下载过滤的扩展名列表（不含点号，如 ["pdf", "doc", "docx"]） */
  fileAutoDownloadExtensions: string[]
}

/**
 * 对齐服务端 HistoryRecordDto:
 *   hash / text / type / createTime / lastModified / lastAccessed
 *   starred / pinned / size / hasData / version / isDeleted
 * profileId 是脚本端拼出的 `{Type}-{Hash}`，用于 GET 单条 / 下载 data。
 */
export type RemoteClipItem = {
  /** 本地展示用的稳定 id；默认等于 profileId。 */
  id: string
  profileId: string
  type: SyncClipboardKind
  hash: string
  text: string
  fullText?: string
  dataName?: string
  hasData: boolean
  size?: number
  createTime: number
  lastModified: number
  lastAccessed?: number
  starred?: boolean
  pinned?: boolean
  version?: number
  isDeleted?: boolean
  /** 本地拿到这条记录的时间戳（用于排序去重兜底）。 */
  fetchedAt: number
}

export type RemoteTimeDisplayMode = "lastModified" | "createTime"

export type CaisSettings = {
  captureText: boolean
  captureImages: boolean
  monitorIntervalMs: number
  duplicatePolicy: DuplicatePolicy
  maxItems: number
  appContentLineLimit: number
  keyboardShowTitle: boolean
  showRimeKeyboardSwitch: boolean
  showRemoteFiles: boolean
  remoteTimeDisplay: RemoteTimeDisplayMode
  inputClicks: boolean
  hapticEngineClicks: boolean
  keyboardMaxItems: number
  memoSubfieldSeparators: string
  syncClipboard: SyncClipboardSettings
  keyboardMenu: KeyboardMenuSettings
  defaultStartPage: AppStartPage
  ai?: AISettings
  passwordVaultEnabled?: boolean
}

export type KeyboardMenuBuiltinAction =
  | "pin"
  | "favorite"
  | "tokenize"
  | "base64Encode"
  | "base64Decode"
  | "cleanWhitespace"
  | "removeBlankLines"
  | "splitLines"
  | "uppercase"
  | "lowercase"
  | "chineseAmount"
  | "openUrl"

export type KeyboardCustomActionMode = "template" | "regexExtract" | "regexRemove" | "javascript"

export type KeyboardCustomAction = {
  id: string
  title: string
  mode: KeyboardCustomActionMode
  template: string
  regex?: string
  regexRemoveAll?: boolean
  script?: string
  enabled: boolean
}

export type KeyboardMenuSettings = {
  builtins: Record<KeyboardMenuBuiltinAction, boolean>
  builtinOrder?: KeyboardMenuBuiltinAction[]
  customActions: KeyboardCustomAction[]
}

export type MonitorStatus = {
  active: boolean
  lastMessage: string
  lastCheckedAt?: number
  lastCapturedAt?: number
  capturedCount?: number
}

export const DEFAULT_SYNC_CLIPBOARD_SETTINGS: SyncClipboardSettings = {
  enabled: false,
  url: "",
  username: "",
  password: "",
  accounts: [],
  intervalSec: 2,
  retryCount: 3,
  timeoutSec: 100,
  maxItems: 100,
  allowInsecure: false,
  autoUpload: true,
  uploadText: true,
  uploadSingleFile: true,
  uploadMultipleFiles: false,
  maxUploadFileSizeMb: 20,
  autoDownload: true,
  maxAutoDownloadFileSizeMb: 10,
  fileAutoDownloadFilterMode: "disabled",
  fileAutoDownloadExtensions: [],
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  assistants: [],
  defaultProvider: "script",
  defaultModelId: "",
  columnsPerRow: 2,
}

export const DEFAULT_CAIS_SETTINGS: CaisSettings = {
  captureText: true,
  captureImages: false,
  monitorIntervalMs: 200,
  duplicatePolicy: "bump",
  maxItems: 800,
  appContentLineLimit: 3,
  keyboardShowTitle: true,
  showRimeKeyboardSwitch: false,
  showRemoteFiles: false,
  remoteTimeDisplay: "lastModified",
  inputClicks: false,
  hapticEngineClicks: true,
  keyboardMaxItems: 30,
  memoSubfieldSeparators: ":：；",
  syncClipboard: { ...DEFAULT_SYNC_CLIPBOARD_SETTINGS },
  defaultStartPage: "network",
  ai: { ...DEFAULT_AI_SETTINGS },
  keyboardMenu: {
    builtins: {
      pin: true,
      favorite: true,
      tokenize: true,
      base64Encode: true,
      base64Decode: true,
      cleanWhitespace: true,
      removeBlankLines: true,
      splitLines: true,
      uppercase: true,
      lowercase: true,
      chineseAmount: false,
      openUrl: true,
    },
    customActions: [],
  },
  passwordVaultEnabled: false,
}
