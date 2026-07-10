import type { RemoteClipItem } from "../types"

export const REMOTE_INCREMENTAL_LOOKBACK_MS = 1000

export function remoteItemKey(item: RemoteClipItem): string {
  return item.profileId || `${item.type}-${item.hash}` || item.id || ""
}

export function remoteItemTimestamp(item: RemoteClipItem): number {
  return item.lastModified || item.createTime || item.fetchedAt || 0
}

export function latestRemoteModifiedAt(items: RemoteClipItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.lastModified || item.createTime || 0), 0)
}

export function remoteModifiedAfterForIncrementalSync(items: RemoteClipItem[], lookbackMs = REMOTE_INCREMENTAL_LOOKBACK_MS): number | undefined {
  const latest = latestRemoteModifiedAt(items)
  return latest > 0 ? Math.max(0, latest - lookbackMs) : undefined
}

export function mergeRemoteItems(prev: RemoteClipItem[], next: RemoteClipItem[]): RemoteClipItem[] {
  const indexByKey = new Map<string, number>()
  const merged: RemoteClipItem[] = []

  for (const item of prev) {
    const key = remoteItemKey(item)
    if (!key) continue
    if (indexByKey.has(key)) continue
    indexByKey.set(key, merged.length)
    merged.push(item)
  }

  for (const item of next) {
    const key = remoteItemKey(item)
    if (!key) continue
    const existingIndex = indexByKey.get(key)
    if (existingIndex == null) {
      indexByKey.set(key, merged.length)
      merged.push(item)
    } else {
      merged[existingIndex] = item
    }
  }

  return merged
    .filter((item) => !item.isDeleted)
    .sort((a, b) => remoteItemTimestamp(b) - remoteItemTimestamp(a))
}
