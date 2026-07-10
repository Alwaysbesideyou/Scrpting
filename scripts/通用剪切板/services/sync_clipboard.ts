import { fetch, FormData } from "scripting"
import type { RequestInit, Response } from "scripting"
import type { RemoteClipItem, SyncClipboardKind, SyncClipboardSettings } from "../types"

/**
 * SyncClipboard HTTP client.
 *
 * Built against the local SyncClipboard OpenAPI documented in `SyncClipboardAPI.md`:
 *   GET    /api/history/{profileId}              - single record metadata (`Type-Hash`)
 *   GET    /api/history/{profileId}/data         - binary/text payload
 *   POST   /api/history/query                    - multipart query body (`page`, `types`, ...)
 *   POST   /api/history                          - upload (multipart, `hash` + `type` required, `data` last)
 *   PATCH  /api/history/{type}/{hash}            - partial update (`isDelete`, not `isDeleted`)
 *   DELETE /api/history/clear                    - clear all history
 *   GET    /api/history/statistics               - HistoryStatisticsDto
 *   GET    /SyncClipboard.json                   - current clipboard ProfileDto
 *   PUT    /SyncClipboard.json                   - update current clipboard ProfileDto
 *
 * The OpenAPI document does not declare auth globally; when username/password
 * are configured this client still sends HTTP Basic auth for deployments that
 * enable it.
 *
 * Server enums (`type`) are serialized as strings via JsonStringEnumConverter:
 *   "Text" | "Image" | "File" | "Group"
 * Hash on the server side is normalised to ToUpperInvariant().
 */

// ---------------------------------------------------------------------------
// URL / auth helpers
// ---------------------------------------------------------------------------

function isHttp(url: string): boolean {
  return /^http:\/\//i.test(url)
}

function isHttps(url: string): boolean {
  return /^https:\/\//i.test(url)
}

function isValidUrl(url: string): boolean {
  return isHttp(url) || isHttps(url)
}

function normalizeBaseUrl(url: string): string {
  return (url || "").trim().replace(/\/+$/, "")
}

function basicAuthHeader(username: string, password: string): string | null {
  if (!username && !password) return null
  const raw = `${username}:${password}`
  // Scripting (iOS) has no global TextEncoder/btoa — use Data.fromRawString.
  const D = (globalThis as any).Data
  if (!D) return null
  const data = typeof D.fromRawString === "function"
    ? D.fromRawString(raw, "utf-8")
    : (typeof D.fromString === "function" ? D.fromString(raw, "utf-8") : null)
  if (!data || typeof data.toBase64String !== "function") return null
  return `Basic ${data.toBase64String()}`
}

type ExtendedRequestInit = RequestInit & {
  allowInsecureRequest?: boolean
  timeout?: number
}

function buildHeaders(settings: SyncClipboardSettings, accept = "application/json", extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept, ...(extra || {}) }
  const auth = basicAuthHeader(settings.username, settings.password)
  if (auth) headers.Authorization = auth
  return headers
}

function buildInit(
  settings: SyncClipboardSettings,
  options: {
    method?: string
    accept?: string
    body?: any
    extraHeaders?: Record<string, string>
    timeout?: number
  } = {}
): ExtendedRequestInit {
  const init: any = {
    method: options.method ?? "GET",
    headers: buildHeaders(settings, options.accept ?? "application/json", options.extraHeaders),
    timeout: options.timeout ?? settings.timeoutSec ?? 20,
    allowInsecureRequest: settings.allowInsecure || isHttp(settings.url),
  }
  if (options.body !== undefined) init.body = options.body
  return init as ExtendedRequestInit
}

function buildMultipartBody(
  fields: Array<[string, string]>,
  file?: { fieldName: string; data: any; mimeType: string; filename: string }
): { body: any; contentType: string; contentLength?: string } | null {
  const D = (globalThis as any).Data
  if (!D || typeof D.fromRawString !== "function" || typeof D.combine !== "function") return null

  const boundary = `----CAISSyncClipboard${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const chunks: any[] = []
  const pushText = (text: string) => {
    const data = D.fromRawString(text, "utf-8")
    if (data) chunks.push(data)
  }
  const escapeQuoted = (value: string) => String(value).replace(/["\\\r\n]/g, "_")

  for (const [name, value] of fields) {
    pushText(`--${boundary}\r\n`)
    pushText(`Content-Disposition: form-data; name="${escapeQuoted(name)}"\r\n\r\n`)
    pushText(`${value}\r\n`)
  }

  if (file?.data) {
    pushText(`--${boundary}\r\n`)
    pushText(`Content-Disposition: form-data; name="${escapeQuoted(file.fieldName)}"; filename="${escapeQuoted(file.filename)}"\r\n`)
    pushText(`Content-Type: ${file.mimeType || "application/octet-stream"}\r\n\r\n`)
    chunks.push(file.data)
    pushText("\r\n")
  }

  pushText(`--${boundary}--\r\n`)
  const body = D.combine(chunks)
  if (!body) return null
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: body.size != null ? String(body.size) : undefined,
  }
}

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

const VALID_KINDS: SyncClipboardKind[] = ["Text", "Image", "File", "Group", "Unknown", "None"]

function asKind(value: any): SyncClipboardKind {
  const text = String(value ?? "")
  const exact = VALID_KINDS.find((kind) => kind === text)
  if (exact) return exact
  const folded = VALID_KINDS.find((kind) => kind.toLowerCase() === text.toLowerCase())
  return folded ?? "Unknown"
}

function asTimestamp(value: any): number {
  if (value == null) return 0
  if (typeof value === "number") {
    // server returns epoch ms or seconds? In .NET DateTimeOffset.ToUnixTimeMilliseconds().
    // SyncClipboard uses ToUnixTimeMilliseconds (ms).
    return value > 1e12 ? value : value * 1000
  }
  const t = Date.parse(String(value))
  return Number.isFinite(t) ? t : 0
}

function makeProfileId(type: SyncClipboardKind, hash: string): string {
  return `${type}-${hash}`
}

function splitProfileId(profileId: string): { type: string; hash: string } | null {
  const idx = profileId.indexOf("-")
  if (idx <= 0) return null
  return { type: profileId.slice(0, idx), hash: profileId.slice(idx + 1) }
}

export function makeRemoteTextHash(text: string): string {
  // SyncClipboard TextProfile hash = SHA256(UTF8(original text)).
  // Do not trim, normalize newlines, or add local prefixes here; the server
  // hashes the exact text payload and normalizes only the final hex casing.
  return sha256HexFromString(text ?? "")
}

export function makeRemoteTextProfileId(text: string): string {
  return makeProfileId("Text", makeRemoteTextHash(text))
}

export function makeRemoteFileHash(fileName: string, data: any): string {
  return makeFileHash(fileName, data)
}

export function makeRemoteFileProfileId(type: "File" | "Image", fileName: string, data: any): string {
  return makeProfileId(type, makeRemoteFileHash(fileName, data))
}

function sha256HexFromData(data: any): string {
  const crypto = (globalThis as any).Crypto
  if (!crypto || typeof crypto.sha256 !== "function") {
    throw new Error("当前环境缺少 Crypto.sha256，无法计算 SyncClipboard 文件哈希")
  }
  const digest = crypto.sha256(data)
  if (!digest || typeof digest.toHexString !== "function") {
    throw new Error("Crypto.sha256 未返回可用的 Data")
  }
  return String(digest.toHexString()).toUpperCase()
}

function sha256HexFromString(text: string): string {
  const D = (globalThis as any).Data
  const data = D?.fromRawString?.(text, "utf-8") ?? D?.fromString?.(text, "utf-8")
  if (!data) throw new Error("无法将文本转换为 UTF-8 数据")
  return sha256HexFromData(data)
}

function makeFileHash(fileName: string, data: any): string {
  const baseName = String(fileName || "data.bin").split(/[\\/]/).pop() || "data.bin"
  const contentHash = sha256HexFromData(data)
  return sha256HexFromString(`${baseName}|${contentHash}`)
}

/**
 * Convert a server HistoryRecordDto to RemoteClipItem.
 */
export function recordDtoToItem(dto: any): RemoteClipItem {
  let type = asKind(dto?.type)
  const hash = String(dto?.hash ?? "")
  const text = String(dto?.text ?? "")
  const dataName = dto?.dataName != null ? String(dto.dataName) : undefined
  const hasData = Boolean(dto?.hasData)
  if (type === "Unknown" || type === "None") {
    if (hasData && dataName && /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(dataName)) {
      type = "Image"
    } else if (hasData && dataName) {
      type = "File"
    } else if (text) {
      type = "Text"
    }
  }
  const profileId = makeProfileId(type, hash)
  const createTime = asTimestamp(dto?.createTime)
  const lastModified = asTimestamp(dto?.lastModified) || createTime
  const lastAccessed = dto?.lastAccessed != null ? asTimestamp(dto.lastAccessed) : undefined
  return {
    id: profileId || `remote-${Date.now()}`,
    profileId,
    type,
    hash,
    text,
    fullText: undefined,
    dataName,
    hasData,
    size: dto?.size != null ? Number(dto.size) || 0 : undefined,
    createTime,
    lastModified,
    lastAccessed,
    starred: dto?.starred != null ? Boolean(dto.starred) : undefined,
    pinned: dto?.pinned != null ? Boolean(dto.pinned) : undefined,
    version: dto?.version != null ? Number(dto.version) || 0 : undefined,
    isDeleted: dto?.isDeleted != null ? Boolean(dto.isDeleted) : undefined,
    fetchedAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Configuration / status helpers
// ---------------------------------------------------------------------------

export function isRemoteSyncConfigured(settings: SyncClipboardSettings): boolean {
  return Boolean(settings.enabled && isValidUrl(settings.url || ""))
}

export function remoteItemContent(item: RemoteClipItem): string {
  if (item.fullText != null && item.fullText !== "") return item.fullText
  return item.text
}

// ---------------------------------------------------------------------------
// Network primitives
// ---------------------------------------------------------------------------

async function safeFetch(url: string, init: ExtendedRequestInit): Promise<Response> {
  return await fetch(url, init as any)
}

function describeStatus(status: number): string {
  if (status === 401) return "用户名或密码错误 (401)"
  if (status === 403) return "无权限 (403)"
  if (status === 404) return "服务端未找到接口 (404)，请确认服务器版本支持 /api/history"
  if (status === 409) return "版本冲突 (409)"
  return `服务器返回 ${status}`
}

// ---------------------------------------------------------------------------
// Query / get / download
// ---------------------------------------------------------------------------

export type QueryRemoteResult =
  | { status: "ok"; items: RemoteClipItem[]; hasMore: boolean }
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string }

export type RemoteQueryOptions = {
  /** API document uses 1-based `page`. */
  pageNumber?: number
  /** Query records created after this time. */
  after?: number | string | Date
  /** Query records modified after this time. */
  modifiedAfter?: number | string | Date
  /** Optional text filter: `searchText`. */
  search?: string
  /** Optional type filter, mapped to ProfileTypeFilter. */
  type?: SyncClipboardKind | "All" | "FileAndGroup"
  /** Include soft-deleted entries is not exposed by the documented query API. */
  includeDeleted?: boolean
  /** Only starred entries. */
  starredOnly?: boolean
}

/**
 * Page the remote history using the documented local API:
 *   POST /api/history/query (multipart/form-data)
 * Fields are the OpenAPI schema names: page / types / searchText / starred /
 * sortByLastAccessed. Some builds bind PascalCase names, so we send both.
 */
export async function queryRemoteHistory(
  settings: SyncClipboardSettings,
  options: RemoteQueryOptions = {}
): Promise<QueryRemoteResult> {
  if (!isRemoteSyncConfigured(settings)) {
    return { status: "skipped", reason: "未启用同步或未配置服务器地址" }
  }
  const baseUrl = normalizeBaseUrl(settings.url)
  const pageNumber = Math.max(1, options.pageNumber ?? 1)

  const dateField = (value: number | string | Date | undefined): string | null => {
    if (value == null) return null
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
    if (typeof value === "number") {
      const date = new Date(value)
      return Number.isFinite(date.getTime()) ? date.toISOString() : null
    }
    const time = Date.parse(String(value))
    return Number.isFinite(time) ? new Date(time).toISOString() : null
  }

  const form = new FormData()
  const typeFilter = options.type ?? "All"
  form.append("page", String(pageNumber))
  form.append("Page", String(pageNumber))
  form.append("types", typeFilter)
  form.append("Types", typeFilter)
  form.append("sortByLastAccessed", "false")
  form.append("SortByLastAccessed", "false")
  if (options.search) {
    form.append("searchText", options.search)
    form.append("SearchText", options.search)
  }
  if (options.starredOnly) {
    form.append("starred", "true")
    form.append("Starred", "true")
  }
  const after = dateField(options.after)
  if (after) {
    form.append("after", after)
    form.append("After", after)
  }
  const modifiedAfter = dateField(options.modifiedAfter)
  if (modifiedAfter) {
    form.append("modifiedAfter", modifiedAfter)
    form.append("ModifiedAfter", modifiedAfter)
  }

  const init = buildInit(settings, { method: "POST", body: form })
  let response: Response
  try {
    response = await safeFetch(`${baseUrl}/api/history/query`, init)
  } catch (error: any) {
    return { status: "error", message: String(error?.message ?? error ?? "网络请求失败") }
  }
  if (!response.ok) {
    return { status: "error", message: describeStatus(response.status) }
  }
  let payload: any
  try {
    payload = await response.json()
  } catch (error: any) {
    return { status: "error", message: "解析 JSON 失败：" + String(error?.message ?? error ?? "") }
  }
  return mapQueryPayload(payload)
}

function mapQueryPayload(payload: any): QueryRemoteResult {
  const rawArray: any[] =
    Array.isArray(payload) ? payload :
    Array.isArray(payload?.items) ? payload.items :
    Array.isArray(payload?.records) ? payload.records :
    Array.isArray(payload?.data) ? payload.data : []
  // 不在此处过滤 isDeleted，让 mergeRemoteItems 处理删除同步
  const items = rawArray.map(recordDtoToItem)
  const totalFromServer = Number(payload?.total ?? payload?.totalCount ?? payload?.count)
  const hasMoreFlag = payload?.hasMore != null ? Boolean(payload.hasMore) : undefined
  const hasMore = hasMoreFlag != null
    ? hasMoreFlag
    : (Number.isFinite(totalFromServer) ? items.length < totalFromServer : false)
  return { status: "ok", items, hasMore }
}

/**
 * Fetch one record's metadata by profileId (`{Type}-{Hash}`).
 */
export async function getRemoteRecord(
  settings: SyncClipboardSettings,
  profileId: string
): Promise<RemoteClipItem | null> {
  if (!isRemoteSyncConfigured(settings)) return null
  const parsed = splitProfileId(profileId)
  if (!parsed) return null
  const baseUrl = normalizeBaseUrl(settings.url)
  const init = buildInit(settings)
  try {
    const response = await safeFetch(`${baseUrl}/api/history/${encodeURIComponent(profileId)}`, init)
    if (!response.ok) return null
    const payload = await response.json()
    return recordDtoToItem(payload)
  } catch {
    return null
  }
}

/**
 * Download the binary payload for `hasData=true` records. For Text records
 * the server stores the full text in `text`, so callers usually don't need
 * to download. Returns either decoded text or a Data instance.
 */
export type DownloadResult =
  | { status: "ok"; text?: string; data?: any; mimeType?: string; contentDisposition?: string }
  | { status: "empty" }
  | { status: "error"; message: string }

export async function downloadRemoteData(
  settings: SyncClipboardSettings,
  item: RemoteClipItem,
  prefer: "text" | "binary" = "text"
): Promise<DownloadResult> {
  if (!isRemoteSyncConfigured(settings)) return { status: "error", message: "未启用同步" }
  if (!item.hasData) return { status: "empty" }
  const baseUrl = normalizeBaseUrl(settings.url)
  const url = `${baseUrl}/api/history/${encodeURIComponent(item.profileId || makeProfileId(item.type, item.hash))}/data`
  const init = buildInit(settings, { method: "GET", accept: "*/*", timeout: 30 })
  try {
    const response = await safeFetch(url, init)
    if (!response.ok) return { status: "error", message: describeStatus(response.status) }
    const mimeType = response.headers?.get?.("content-type") ?? undefined
    const contentDisposition = response.headers?.get?.("content-disposition") ?? undefined
    if (prefer === "text" || (mimeType && /^text\//i.test(mimeType))) {
      const text = await response.text()
      return { status: "ok", text, mimeType, contentDisposition }
    }
    const anyResp = response as any
    if (typeof anyResp.data === "function") {
      const data = await anyResp.data()
      return { status: "ok", data, mimeType, contentDisposition }
    }
    if (typeof anyResp.arrayBuffer === "function") {
      const buf = await anyResp.arrayBuffer()
      return { status: "ok", data: buf, mimeType, contentDisposition }
    }
    const text = await response.text()
    return { status: "ok", text, mimeType, contentDisposition }
  } catch (error: any) {
    return { status: "error", message: String(error?.message ?? error ?? "下载失败") }
  }
}

// ---------------------------------------------------------------------------
// Upload / patch / delete / clear / stats
// ---------------------------------------------------------------------------

export type UploadOutcome =
  | { status: "ok"; item: RemoteClipItem }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string }

export type UploadInput = {
  type?: SyncClipboardKind
  text: string
  /** Optional binary payload (Data instance) — uploaded as the `data` form field. */
  data?: any
  dataName?: string
  dataMimeType?: string
  starred?: boolean
  pinned?: boolean
}

/**
 * Upload a clipboard item to the remote history. The data field, if present,
 * must be the LAST entry in the multipart body (server requirement).
 */
export type CurrentClipboardUploadOutcome =
 | { status: "ok"; item: RemoteClipItem }
 | { status: "skipped"; reason: string }
 | { status: "error"; message: string }

function makeSafeDataName(name: string, fallback: string): string {
 const raw = String(name || fallback || "clipboard.bin").split(/[\\/]/).pop() || fallback || "clipboard.bin"
 const safe = raw.replace(/[\r\n\0]/g, "_").replace(/^\.+$/, "_")
 return safe || fallback || "clipboard.bin"
}

function dataSize(data: any): number {
 return Number(data?.size ?? data?.length ?? data?.byteLength ??0) ||0
}

function remoteItemFromProfile(profile: any): RemoteClipItem {
 const type = asKind(profile?.type)
 const hash = String(profile?.hash ?? "")
 return {
 id: makeProfileId(type, hash),
 profileId: makeProfileId(type, hash),
 type,
 hash,
 text: String(profile?.text ?? ""),
 dataName: profile?.dataName != null ? String(profile.dataName) : undefined,
 hasData: Boolean(profile?.hasData),
 size: profile?.size != null ? Number(profile.size) ||0 : undefined,
 createTime: Date.now(),
 lastModified: Date.now(),
 fetchedAt: Date.now(),
 }
}

/**
 * Push the current clipboard profile via the current clipboard API.
 * Text is written directly to PUT /SyncClipboard.json. Image/File payloads are
 * first written to PUT /file/{dataName}, then the current profile is updated so
 * remote SyncClipboard clients copy it into their local clipboard.
 */
export async function uploadCurrentClipboardToRemote(
 settings: SyncClipboardSettings,
 payload: UploadInput
): Promise<CurrentClipboardUploadOutcome> {
 if (!isRemoteSyncConfigured(settings)) {
 return { status: "skipped", reason: "未启用同步或未配置服务器地址" }
 }
 const baseUrl = normalizeBaseUrl(settings.url)
 const type: SyncClipboardKind = payload.type ?? (payload.data ? "File" : "Text")
 const text = payload.text ?? ""
 if (!payload.data && !text.trim()) return { status: "skipped", reason: "没有可上传内容" }

 let dataName: string | null = null
 let hash = ""
 let size =0
 try {
 if (payload.data) {
 const ext = type === "Image" ? ".png" : ".bin"
 hash = makeFileHash(payload.dataName ?? `clipboard${ext}`, payload.data)
 dataName = makeSafeDataName(payload.dataName ?? `${type}-${hash}${ext}`, `${type}-${hash}${ext}`)
 size = dataSize(payload.data)
 const fileInit = buildInit(settings, {
 method: "PUT",
 accept: "*/*",
 body: payload.data,
 extraHeaders: { "Content-Type": payload.dataMimeType ?? "application/octet-stream" },
 timeout: settings.timeoutSec ??100,
 })
 const fileResponse = await safeFetch(`${baseUrl}/file/${encodeURIComponent(dataName)}`, fileInit)
 if (!fileResponse.ok) {
 let body = ""
 try { body = (await fileResponse.text()).trim() } catch {}
 return { status: "error", message: body ? `${describeStatus(fileResponse.status)}: ${body}` : describeStatus(fileResponse.status) }
 }
 } else {
 hash = makeRemoteTextHash(text)
 size = text.length
 }

 const profile = {
 type,
 hash,
 text,
 hasData: Boolean(payload.data),
 dataName,
 size,
 }
 const profileInit = buildInit(settings, {
 method: "PUT",
 body: JSON.stringify(profile),
 extraHeaders: { "Content-Type": "application/json" },
 timeout: settings.timeoutSec ??30,
 })
 const profileResponse = await safeFetch(`${baseUrl}/SyncClipboard.json`, profileInit)
 if (!profileResponse.ok) {
 let body = ""
 try { body = (await profileResponse.text()).trim() } catch {}
 return { status: "error", message: body ? `${describeStatus(profileResponse.status)}: ${body}` : describeStatus(profileResponse.status) }
 }
 return { status: "ok", item: remoteItemFromProfile(profile) }
 } catch (error: any) {
 return { status: "error", message: String(error?.message ?? error ?? "上传当前剪切板失败") }
 }
}

export async function uploadLocalToRemote(
  settings: SyncClipboardSettings,
  payload: UploadInput
): Promise<UploadOutcome> {
  if (!isRemoteSyncConfigured(settings)) {
    return { status: "skipped", reason: "未启用同步或未配置服务器地址" }
  }
  if (!settings.autoUpload && payload.text == null) {
    // text-only short-circuit: empty payloads have nothing to send
  }
  const baseUrl = normalizeBaseUrl(settings.url)
  const type: SyncClipboardKind = payload.type ?? "Text"
  const nowIso = new Date().toISOString()
  const hash = payload.data
    ? makeFileHash(payload.dataName ?? "data.bin", payload.data)
    : makeRemoteTextHash(payload.text ?? "")
  const size = String(payload.data?.size ?? payload.data?.length ?? payload.data?.byteLength ?? (payload.text ?? "").length)
  const fields: Array<[string, string]> = [
    ["hash", hash],
    ["type", type],
    ["createTime", nowIso],
    ["lastModified", nowIso],
    ["lastAccessed", nowIso],
    ["starred", payload.starred ? "true" : "false"],
    ["pinned", payload.pinned ? "true" : "false"],
    ["version", "1"],
    ["isDeleted", "false"],
    ["text", payload.text ?? ""],
    ["size", size],
    ["hasData", payload.data ? "true" : "false"],
  ]
  const multipart = buildMultipartBody(
    fields,
    payload.data
      ? {
          fieldName: "data",
          data: payload.data,
          mimeType: payload.dataMimeType ?? "application/octet-stream",
          filename: payload.dataName ?? "data.bin",
        }
      : undefined
  )

  let body: any
  let extraHeaders: Record<string, string> | undefined
  if (multipart) {
    body = multipart.body
    extraHeaders = {
      "Content-Type": multipart.contentType,
      ...(multipart.contentLength ? { "Content-Length": multipart.contentLength } : {}),
    }
  } else {
    const form = new FormData()
    for (const [name, value] of fields) form.append(name, value)
    // `data` MUST be appended last per server contract.
    if (payload.data) {
      form.append("data", payload.data, payload.dataMimeType ?? "application/octet-stream", payload.dataName ?? "data.bin")
    }
    body = form
  }
  const init = buildInit(settings, { method: "POST", body, extraHeaders, timeout: settings.timeoutSec ?? 100 })
  let response: Response
  try {
    response = await safeFetch(`${baseUrl}/api/history`, init)
  } catch (error: any) {
    return { status: "error", message: String(error?.message ?? error ?? "网络请求失败") }
  }
  if (response.status === 409) {
    return { status: "duplicate" }
  }
  if (!response.ok) {
    let body = ""
    try {
      body = (await response.text()).trim()
    } catch {
    }
    return { status: "error", message: body ? `${describeStatus(response.status)}: ${body}` : describeStatus(response.status) }
  }
  try {
    const dto = await response.json()
    return { status: "ok", item: recordDtoToItem(dto) }
  } catch {
    // Server may return 204 with no body.
    return {
      status: "ok",
      item: {
        id: makeProfileId(type, hash),
        profileId: makeProfileId(type, hash),
        type,
        hash,
        text: payload.text ?? "",
        hasData: Boolean(payload.data),
        createTime: Date.now(),
        lastModified: Date.now(),
        fetchedAt: Date.now(),
      },
    }
  }
}

export type PatchInput = {
  starred?: boolean
  pinned?: boolean
  text?: string
  /** Required for optimistic concurrency. Server may reject with 409 if stale. */
  version?: number
  isDeleted?: boolean
}

export async function patchRemoteRecord(
  settings: SyncClipboardSettings,
  type: SyncClipboardKind,
  hash: string,
  patch: PatchInput
): Promise<{ status: "ok"; item: RemoteClipItem } | { status: "conflict"; serverItem?: RemoteClipItem } | { status: "error"; message: string }> {
  if (!isRemoteSyncConfigured(settings)) return { status: "error", message: "未启用同步" }
  const baseUrl = normalizeBaseUrl(settings.url)
  if (patch.text != null) {
    const uploaded = await uploadLocalToRemote(settings, {
      type,
      text: patch.text,
      starred: patch.starred,
      pinned: patch.pinned,
    })
    if (uploaded.status === "ok") {
      // The documented PATCH endpoint cannot update record text. Treat edits as
      // a new history record, then best-effort delete the old one.
      void deleteRemoteRecord(settings, type, hash)
      return { status: "ok", item: uploaded.item }
    }
    if (uploaded.status === "duplicate") {
      return { status: "conflict" }
    }
    return { status: "error", message: uploaded.status === "skipped" ? uploaded.reason : uploaded.message }
  }
  const body: any = {}
  if (patch.starred != null) body.starred = patch.starred
  if (patch.pinned != null) body.pinned = patch.pinned
  if (patch.version != null) body.version = patch.version
  if (patch.isDeleted != null) {
    body.isDelete = patch.isDeleted
    body.lastModified = new Date().toISOString()
    body.lastAccessed = new Date().toISOString()
  }
  const init = buildInit(settings, {
    method: "PATCH",
    body: JSON.stringify(body),
    extraHeaders: { "Content-Type": "application/json" },
  })
  try {
    const response = await safeFetch(`${baseUrl}/api/history/${encodeURIComponent(type)}/${encodeURIComponent(hash)}`, init)
    if (response.status === 409) {
      try {
        const dto = await response.json()
        return { status: "conflict", serverItem: recordDtoToItem(dto) }
      } catch {
        return { status: "conflict" }
      }
    }
    if (!response.ok) return { status: "error", message: describeStatus(response.status) }
    try {
      const dto = await response.json()
      return { status: "ok", item: recordDtoToItem(dto) }
    } catch {
      return {
        status: "ok",
        item: {
          id: makeProfileId(type, hash),
          profileId: makeProfileId(type, hash),
          type,
          hash,
          text: "",
          hasData: false,
          createTime: Date.now(),
          lastModified: Date.now(),
          starred: body.starred,
          pinned: body.pinned,
          version: body.version,
          isDeleted: body.isDelete,
          fetchedAt: Date.now(),
        },
      }
    }
  } catch (error: any) {
    return { status: "error", message: String(error?.message ?? error ?? "网络请求失败") }
  }
}

export async function deleteRemoteRecord(
  settings: SyncClipboardSettings,
  type: SyncClipboardKind,
  hash: string,
  version?: number
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  if (!isRemoteSyncConfigured(settings)) return { status: "error", message: "未启用同步" }
  const baseUrl = normalizeBaseUrl(settings.url)
  const init = buildInit(settings, {
    method: "PATCH",
    body: JSON.stringify({ isDelete: true, version, lastModified: new Date().toISOString(), lastAccessed: new Date().toISOString() }),
    extraHeaders: { "Content-Type": "application/json" },
  })
  try {
    const response = await safeFetch(`${baseUrl}/api/history/${encodeURIComponent(type)}/${encodeURIComponent(hash)}`, init)
    if (!response.ok) return { status: "error", message: describeStatus(response.status) }
    return { status: "ok" }
  } catch (error: any) {
    return { status: "error", message: String(error?.message ?? error ?? "网络请求失败") }
  }
}

export async function clearRemoteHistory(
  settings: SyncClipboardSettings
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  if (!isRemoteSyncConfigured(settings)) return { status: "error", message: "未启用同步" }
  const baseUrl = normalizeBaseUrl(settings.url)
  const init = buildInit(settings, { method: "DELETE" })
  try {
    const response = await safeFetch(`${baseUrl}/api/history/clear`, init)
    if (!response.ok) return { status: "error", message: describeStatus(response.status) }
    return { status: "ok" }
  } catch (error: any) {
    return { status: "error", message: String(error?.message ?? error ?? "网络请求失败") }
  }
}

export type RemoteStatistics = {
  totalCount: number
  textCount: number
  imageCount: number
  fileCount: number
  groupCount: number
  totalSize: number
  raw: any
}

export async function getRemoteStatistics(
  settings: SyncClipboardSettings
): Promise<{ status: "ok"; stats: RemoteStatistics } | { status: "error"; message: string }> {
  if (!isRemoteSyncConfigured(settings)) return { status: "error", message: "未启用同步" }
  const baseUrl = normalizeBaseUrl(settings.url)
  const init = buildInit(settings)
  try {
    const response = await safeFetch(`${baseUrl}/api/history/statistics`, init)
    if (!response.ok) return { status: "error", message: describeStatus(response.status) }
    const dto: any = await response.json()
    const stats: RemoteStatistics = {
      totalCount: Number(dto?.totalCount ?? dto?.total ?? 0) || 0,
      textCount: 0,
      imageCount: 0,
      fileCount: 0,
      groupCount: 0,
      totalSize: Math.round((Number(dto?.totalFileSizeMB ?? 0) || 0) * 1024 * 1024),
      raw: dto,
    }
    return { status: "ok", stats }
  } catch (error: any) {
    return { status: "error", message: String(error?.message ?? error ?? "网络请求失败") }
  }
}

// ---------------------------------------------------------------------------
// Local "already uploaded" bookkeeping (avoids replaying every clip on launch)
// ---------------------------------------------------------------------------

const UPLOADED_HASHES_KEY = "cais_sync_clipboard_uploaded_v1"
const SHARED_OPTIONS = { shared: true }

function getStorage(): any {
  return (globalThis as any).Storage
}

export function loadUploadedKeys(): Set<string> {
  const st = getStorage()
  if (!st) return new Set()
  const tryRead = (opts?: any) => {
    try {
      const raw = opts
        ? (st.get?.(UPLOADED_HASHES_KEY, opts) ?? st.getString?.(UPLOADED_HASHES_KEY, opts))
        : (st.get?.(UPLOADED_HASHES_KEY) ?? st.getString?.(UPLOADED_HASHES_KEY))
      if (raw == null) return null
      const value = typeof raw === "string" ? JSON.parse(raw) : raw
      if (!Array.isArray(value)) return null
      return new Set<string>(value.map((v) => String(v)))
    } catch {
      return null
    }
  }
  return tryRead(SHARED_OPTIONS) ?? tryRead() ?? new Set<string>()
}

export function persistUploadedKeys(keys: Set<string>): void {
  const st = getStorage()
  if (!st) return
  // cap to most recent 500 to avoid unbounded growth
  const arr = Array.from(keys).slice(-500)
  const raw = JSON.stringify(arr)
  try {
    if (typeof st.set === "function") {
      st.set(UPLOADED_HASHES_KEY, raw)
      st.set(UPLOADED_HASHES_KEY, raw, SHARED_OPTIONS)
    } else if (typeof st.setString === "function") {
      st.setString(UPLOADED_HASHES_KEY, raw)
      st.setString(UPLOADED_HASHES_KEY, raw, SHARED_OPTIONS)
    }
  } catch {
    // best effort
  }
}

export function markUploaded(key: string): void {
  const keys = loadUploadedKeys()
  if (!keys.has(key)) {
    keys.add(key)
    persistUploadedKeys(keys)
  }
}

export function isAlreadyUploaded(key: string): boolean {
  return loadUploadedKeys().has(key)
}
