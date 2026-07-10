import { formatDateTime } from "./common"
import { renderRuntimeTemplate } from "./template"
import { loadMemoGroups, saveMemoGroups } from "../storage/database"

export type MemoLineStyle = "solid" | "dashed"

export const MEMO_GROUP_COLORS = [
  "systemRed",
  "systemOrange",
  "systemYellow",
  "systemGreen",
  "systemTeal",
  "systemBlue",
  "systemIndigo",
  "systemPurple",
  "systemPink",
  "secondaryLabel",
]
export const DEFAULT_MEMO_GROUP_COLOR = "systemRed"
export const DEFAULT_MEMO_GROUP_LINE_STYLE: MemoLineStyle = "solid"

export type KeyboardMemoItem = {
  id: string
  kind?: "text" | "image"
  title?: string
  text: string
  imagePath?: string
  insertPosition?: "end" | "start"
  enableSubfields?: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type KeyboardMemoGroup = {
  id: string
  title: string
  color?: string
  lineStyle?: MemoLineStyle
  sortOrder: number
  collapsed?: boolean
  createdAt: number
  updatedAt: number
  memos: KeyboardMemoItem[]
}

export type MemoSubfield = { key: string; value: string }

export function createMemoId(): string {
  return `memo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function memoSortOrder(value: any, fallback: number): number {
  const order = Number(value)
  return Number.isFinite(order) ? order : fallback
}

export function sortedMemoGroups(groups: KeyboardMemoGroup[]): KeyboardMemoGroup[] {
  return groups
    .map((group, groupIndex) => ({
      ...group,
      sortOrder: memoSortOrder(group.sortOrder, groupIndex),
      memos: sortedMemos(group).map((memo, memoIndex) => ({ ...memo, sortOrder: memoSortOrder(memo.sortOrder, memoIndex) })),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
}

export function normalizeMemoSortOrders(groups: KeyboardMemoGroup[]): KeyboardMemoGroup[] {
  return groups.map((group, groupIndex) => ({
    ...group,
    sortOrder: groupIndex,
    memos: group.memos.map((memo, memoIndex) => ({ ...memo, sortOrder: memoIndex })),
  }))
}

export function reorderedItems<T>(items: T[], indices: number[], newOffset: number): T[] {
  const movingIndices = Array.from(new Set(indices)).sort((a, b) => a - b)
  if (!movingIndices.length) return items
  const moving = movingIndices.map((index) => items[index]).filter((item): item is T => item != null)
  const remaining = items.filter((_, index) => !movingIndices.includes(index))
  const removedBeforeOffset = movingIndices.filter((index) => index < newOffset).length
  const target = Math.max(0, Math.min(remaining.length, newOffset - removedBeforeOffset))
  remaining.splice(target, 0, ...moving)
  return remaining
}

export function sortedMemos(group: KeyboardMemoGroup): KeyboardMemoItem[] {
  return group.memos.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
}

export function normalizeMemoGroups(value: any): KeyboardMemoGroup[] {
  const rawGroups = Array.isArray(value?.groups) ? value.groups : Array.isArray(value) ? value : []
  return rawGroups.map((group: any) => {
    const title = String(group?.title ?? "").trim()
    if (!title) return null
    const now = Date.now()
    const memos = Array.isArray(group?.memos) ? group.memos : []
    return {
      id: String(group?.id || createMemoId()),
      title,
      color: String(group?.color || DEFAULT_MEMO_GROUP_COLOR),
      lineStyle: group?.lineStyle === "dashed" ? "dashed" : DEFAULT_MEMO_GROUP_LINE_STYLE,
      sortOrder: memoSortOrder(group?.sortOrder, rawGroups.indexOf(group)),
      collapsed: Boolean(group?.collapsed),
      createdAt: Number(group?.createdAt) || now,
      updatedAt: Number(group?.updatedAt) || now,
      memos: memos.map((memo: any) => {
        const text = String(memo?.text ?? memo?.content ?? "").trim()
        if (!text) return null
        return {
          id: String(memo?.id || createMemoId()),
          title: String(memo?.title ?? "").trim() || undefined,
          kind: memo?.kind === "image" ? "image" : "text",
          text,
          imagePath: String(memo?.imagePath ?? "").trim() || undefined,
          insertPosition: memo?.insertPosition === "start" ? "start" : "end",
          enableSubfields: Boolean(memo?.enableSubfields ?? false),
          sortOrder: memoSortOrder(memo?.sortOrder, memos.indexOf(memo)),
          createdAt: Number(memo?.createdAt) || now,
          updatedAt: Number(memo?.updatedAt) || now,
        }
      }).filter(Boolean) as KeyboardMemoItem[],
    }
  }).filter(Boolean) as KeyboardMemoGroup[]
}

// In-memory cache for memo groups
let memoGroupsCache: KeyboardMemoGroup[] | null = null
let memoGroupsLoading = false
let memoGroupsLoadPromise: Promise<KeyboardMemoGroup[]> | null = null

export async function loadMemoGroupsFromDB(): Promise<KeyboardMemoGroup[]> {
  if (memoGroupsCache) return memoGroupsCache
  if (memoGroupsLoadPromise) return memoGroupsLoadPromise
  
  memoGroupsLoading = true
  memoGroupsLoadPromise = loadMemoGroups()
    .then(groups => {
      memoGroupsCache = sortedMemoGroups(groups)
      return memoGroupsCache
    })
    .finally(() => {
      memoGroupsLoading = false
      memoGroupsLoadPromise = null
    })
  
  return memoGroupsLoadPromise
}

export function readKeyboardMemos(): KeyboardMemoGroup[] {
  // If cache is loaded, return it
  if (memoGroupsCache) return memoGroupsCache
  
  // If loading is in progress, return empty array (will be updated when loading completes)
  if (memoGroupsLoading) return []
  
  // If cache is not loaded yet, return empty array (will be populated by loadMemoGroupsFromDB)
  return []
}

export async function writeKeyboardMemos(groups: KeyboardMemoGroup[]) {
  const normalized = normalizeMemoSortOrders(sortedMemoGroups(groups))
  
  // Save to SQLite FIRST — only update cache after successful write
  await saveMemoGroups(normalized)
  
  // Update cache after successful DB write
  memoGroupsCache = normalized
}

export function isMemoGroupsLoading(): boolean {
  return memoGroupsLoading
}

export function memoTitle(memo: KeyboardMemoItem): string {
  return memo.title || memo.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || (memo.kind === "image" ? "图片 Memo" : "Memo")
}

export function memoTextCount(memo: KeyboardMemoItem): string {
  return `${Array.from(memo.text || "").length} 字`
}

function escapeRegexChar(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function memoSubfields(text: string, separators: string): MemoSubfield[] {
  const chars = Array.from(separators || ":：；").map(escapeRegexChar).join("") || ":：；"
  const regex = new RegExp(`^([^${chars}]{1,32})[${chars}]\\s*(.*)$`)
  const fields: MemoSubfield[] = []
  let current: MemoSubfield | null = null
  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const match = line.match(regex)
    if (match) {
      if (current && current.value.trim()) fields.push({ key: current.key, value: current.value.trim() })
      current = { key: match[1].trim(), value: match[2].trim() }
    } else if (current) {
      current.value = current.value ? `${current.value}\n${line}` : line
    }
  }
  if (current && current.value.trim()) fields.push({ key: current.key, value: current.value.trim() })
  return fields
}

export function renderMemoOutput(memo: KeyboardMemoItem): string {
  return renderRuntimeTemplate(memo.text)
}

export function memoUpdatedFooter(memo: KeyboardMemoItem): string {
  const parts = [formatDateTime(memo.updatedAt), memo.kind === "image" ? `图片 Memo · ${memoTextCount(memo)}` : memoTextCount(memo)].filter(Boolean)
  return parts.join(" · ")
}
