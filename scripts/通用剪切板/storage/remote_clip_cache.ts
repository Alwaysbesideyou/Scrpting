import type { RemoteClipItem, SyncClipboardKind, SyncClipboardSettings } from "../types"

const REMOTE_CLIP_CACHE_KEY = "cais_remote_clip_cache_v1"
const SHARED_OPTIONS = { shared: true }
const MAX_CACHED_REMOTE_ITEMS = 500

type RemoteClipCacheBucket = {
  items: RemoteClipItem[]
  page: number
  hasMore: boolean
  lastSyncAt?: number
  updatedAt: number
}

type RemoteClipCacheStore = {
  version: 1
  buckets: Record<string, RemoteClipCacheBucket>
}

const VALID_KINDS: SyncClipboardKind[] = ["Text", "Image", "File", "Group", "Unknown", "None"]

function getStorage(): any {
  return (globalThis as any).Storage
}

function accountKey(settings: SyncClipboardSettings): string {
  const url = String(settings.url || "").trim().replace(/\/+$/, "")
  const username = String(settings.username || "")
  return `${url}\n${username}`
}

function readStore(): RemoteClipCacheStore {
  const st = getStorage()
  const fallback: RemoteClipCacheStore = { version: 1, buckets: {} }
  try {
    const raw = st?.get?.(REMOTE_CLIP_CACHE_KEY, SHARED_OPTIONS) ?? st?.getString?.(REMOTE_CLIP_CACHE_KEY, SHARED_OPTIONS)
    if (!raw) return fallback
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== "object") return fallback
    return { version: 1, buckets: parsed.buckets && typeof parsed.buckets === "object" ? parsed.buckets : {} }
  } catch {
    return fallback
  }
}

function writeStore(store: RemoteClipCacheStore): void {
  const st = getStorage()
  const raw = JSON.stringify(store)
  try {
    if (typeof st?.set === "function") {
      st.set(REMOTE_CLIP_CACHE_KEY, raw)
      st.set(REMOTE_CLIP_CACHE_KEY, raw, SHARED_OPTIONS)
    } else if (typeof st?.setString === "function") {
      st.setString(REMOTE_CLIP_CACHE_KEY, raw)
      st.setString(REMOTE_CLIP_CACHE_KEY, raw, SHARED_OPTIONS)
    }
  } catch {
  }
}

function sanitizeKind(value: any): SyncClipboardKind {
  const text = String(value ?? "")
  const exact = VALID_KINDS.find((kind) => kind === text)
  if (exact) return exact
  const folded = VALID_KINDS.find((kind) => kind.toLowerCase() === text.toLowerCase())
  return folded ?? "Unknown"
}

function sanitizeRemoteItem(raw: any): RemoteClipItem | null {
  if (!raw || typeof raw !== "object") return null
  const type = sanitizeKind(raw.type)
  const hash = String(raw.hash ?? "")
  const profileId = String(raw.profileId ?? (hash ? `${type}-${hash}` : ""))
  if (!profileId && !hash) return null
  return {
    id: String(raw.id ?? profileId ?? `${type}-${hash}`),
    profileId,
    type,
    hash,
    text: String(raw.text ?? ""),
    fullText: raw.fullText != null ? String(raw.fullText) : undefined,
    dataName: raw.dataName != null ? String(raw.dataName) : undefined,
    hasData: Boolean(raw.hasData),
    size: raw.size != null ? Number(raw.size) || 0 : undefined,
    createTime: Number(raw.createTime) || 0,
    lastModified: Number(raw.lastModified) || 0,
    lastAccessed: raw.lastAccessed != null ? Number(raw.lastAccessed) || 0 : undefined,
    starred: raw.starred != null ? Boolean(raw.starred) : undefined,
    pinned: raw.pinned != null ? Boolean(raw.pinned) : undefined,
    version: raw.version != null ? Number(raw.version) || 0 : undefined,
    isDeleted: raw.isDeleted != null ? Boolean(raw.isDeleted) : undefined,
    fetchedAt: Number(raw.fetchedAt) || Date.now(),
  }
}

function sanitizeBucket(raw: any): RemoteClipCacheBucket | null {
  if (!raw || typeof raw !== "object") return null
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map(sanitizeRemoteItem)
    .filter(Boolean) as RemoteClipItem[]
  return {
    items,
    page: Math.max(0, Number(raw.page) || 0),
    hasMore: Boolean(raw.hasMore),
    lastSyncAt: raw.lastSyncAt != null ? Number(raw.lastSyncAt) || undefined : undefined,
    updatedAt: Number(raw.updatedAt) || 0,
  }
}

export function loadRemoteClipCache(settings: SyncClipboardSettings): RemoteClipCacheBucket | null {
  const key = accountKey(settings)
  if (!key.trim()) return null
  const bucket = sanitizeBucket(readStore().buckets[key])
  if (!bucket || !bucket.items.length) return bucket
  return { ...bucket, items: bucket.items.slice(0, MAX_CACHED_REMOTE_ITEMS) }
}

export function saveRemoteClipCache(
  settings: SyncClipboardSettings,
  bucket: Pick<RemoteClipCacheBucket, "items" | "page" | "hasMore" | "lastSyncAt">
): void {
  const key = accountKey(settings)
  if (!key.trim()) return
  const store = readStore()
  store.buckets[key] = {
    items: bucket.items.slice(0, MAX_CACHED_REMOTE_ITEMS),
    page: Math.max(0, bucket.page || 0),
    hasMore: Boolean(bucket.hasMore),
    lastSyncAt: bucket.lastSyncAt,
    updatedAt: Date.now(),
  }
  writeStore(store)
}

export function updateRemoteClipCacheItems(
  settings: SyncClipboardSettings,
  updater: (items: RemoteClipItem[]) => RemoteClipItem[],
  fallback?: Pick<RemoteClipCacheBucket, "items" | "page" | "hasMore" | "lastSyncAt">
): void {
  const current = loadRemoteClipCache(settings) ?? fallback
  if (!current) return
  saveRemoteClipCache(settings, {
    ...current,
    items: updater(current.items),
  })
}
