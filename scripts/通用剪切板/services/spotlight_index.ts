import type { ClipItem } from "../types"
import { listSpotlightClips } from "../storage/database"
import { thumbnailPathForImagePath } from "../storage/paths"

const SPOTLIGHT_ID_PREFIX = "clip:"
const SPOTLIGHT_KIND = "剪切板"
const MAX_INDEX_CONTENT_LENGTH = 8000

function spotlightIdForClip(id: string): string {
  return `${SPOTLIGHT_ID_PREFIX}${id}`
}

export function clipIdFromSpotlightId(id: string): string {
  return id.startsWith(SPOTLIGHT_ID_PREFIX) ? id.slice(SPOTLIGHT_ID_PREFIX.length) : id
}

function trimForSpotlight(value: string, maxLength = MAX_INDEX_CONTENT_LENGTH): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}…`
}

function contentTypeForClip(item: ClipItem): UTType {
  if (item.kind === "image") return "public.image" as UTType
  if (item.kind === "url") return "public.url" as UTType
  return "public.text" as UTType
}

function descriptionForClip(item: ClipItem): string {
  if (item.kind === "image") return item.title || "图片剪切板"
  return trimForSpotlight(item.content, 600)
}

export function spotlightItemForClip(item: ClipItem): SpotlightItem {
  const textContent = item.kind === "image" ? item.title : trimForSpotlight(item.content)
  const thumbnailURL = item.kind === "image" ? thumbnailPathForImagePath(item.imagePath) ?? item.imagePath : undefined
  const titlePrefix = item.favorite ? "⭐️ " : item.pinned ? "📌 " : ""
  return {
    id: spotlightIdForClip(item.id),
    parameters: { clipId: item.id },
    title: `${titlePrefix}${item.title || "剪切板内容"}`,
    displayName: item.title || "剪切板内容",
    alternateNames: [item.title, item.kind === "image" ? "图片剪切板" : item.content]
      .filter(Boolean)
      .map((value) => trimForSpotlight(String(value), 1000))
      .slice(0, 2),
    contentType: contentTypeForClip(item),
    contentURL: item.kind === "url" ? item.content : undefined,
    thumbnailURL,
    keywords: ["剪切板", "clipboard", item.kind, item.favorite ? "收藏" : "", item.pinned ? "置顶" : ""].filter(Boolean),
    rankingHint: (item.pinned ? 10 : 0) + (item.favorite ? 5 : 0) + Math.min(1, Math.max(0, (item.updatedAt || item.createdAt || 0) / Date.now())),
    contentDescription: descriptionForClip(item),
    subject: item.title,
    kind: SPOTLIGHT_KIND,
    creator: "通用剪切板",
    textContent,
    contentCreationDate: item.createdAt,
    contentModificationDate: item.updatedAt,
    lastUsedDate: item.lastCopiedAt ?? item.updatedAt,
  }
}

export async function indexClipForSpotlight(item: ClipItem): Promise<void> {
  const spotlight = (globalThis as any).Spotlight
  if (!item.deletedAt && spotlight?.index) {
    await spotlight.index(spotlightItemForClip(item))
  }
}

export async function deleteClipFromSpotlight(id: string): Promise<void> {
  const spotlight = (globalThis as any).Spotlight
  if (spotlight?.delete) await spotlight.delete(spotlightIdForClip(id))
}

export async function rebuildSpotlightIndex(limit = 5000): Promise<number> {
  const spotlight = (globalThis as any).Spotlight
  if (!spotlight?.indexItems || !spotlight?.deleteAll) {
    throw new Error("Spotlight API 不可用，请确认 Scripting 版本并启用 PRO")
  }
  const clips = await listSpotlightClips(limit)
  await spotlight.deleteAll()
  if (!clips.length) return 0
  const batchSize = 200
  for (let index = 0; index < clips.length; index += batchSize) {
    await spotlight.indexItems(clips.slice(index, index + batchSize).map(spotlightItemForClip))
  }
  return clips.length
}
