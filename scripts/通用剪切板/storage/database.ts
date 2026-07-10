import type { ClipboardClearRange, ClipGroup, ClipItem, ClipListScope, AISettings } from "../types"
import type { KeyboardMemoGroup, KeyboardMemoItem } from "../utils/memos"
import { databasePath, ensureAppDirectories } from "./paths"

type DB = {
  execute: (sql: string, params?: any[]) => Promise<any>
  fetchAll: (sql: string, params?: any[]) => Promise<any[]>
}

let cachedDb: DB | null = null
let initialized = false
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const CLIP_ROW_SELECT = "id, kind, title, substr(content, 1, 2000) as content, content_hash, image_path, source_change_count, source, created_at, updated_at, last_copied_at, pinned, favorite, manual_favorite, deleted_at"

function rowToClip(row: any): ClipItem {
  return {
    id: String(row.id),
    kind: row.kind,
    title: String(row.title ?? ""),
    content: String(row.content ?? ""),
    contentHash: String(row.content_hash ?? ""),
    imagePath: row.image_path ? String(row.image_path) : undefined,
    sourceChangeCount: row.source_change_count == null ? undefined : Number(row.source_change_count),
    source: row.source === "remote" ? "remote" : "local",
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now()),
    lastCopiedAt: row.last_copied_at == null ? undefined : Number(row.last_copied_at),
    pinned: Number(row.pinned ?? 0) === 1,
    favorite: Number(row.favorite ?? 0) === 1,
    manualFavorite: Number(row.manual_favorite ?? 0) === 1,
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  }
}

function clipParams(item: ClipItem): any[] {
  return [
    item.id,
    item.kind,
    item.title,
    item.content,
    item.contentHash,
    item.imagePath ?? null,
    item.sourceChangeCount ?? null,
    item.source ?? "local",
    item.createdAt,
    item.updatedAt,
    item.lastCopiedAt ?? null,
    item.pinned ? 1 : 0,
    item.favorite ? 1 : 0,
    item.manualFavorite ? 1 : 0,
    item.deletedAt ?? null,
  ]
}

export async function openCaisDatabase(): Promise<DB> {
  if (cachedDb) return cachedDb
  await ensureAppDirectories()
  const sqlite = (globalThis as any).SQLite
  if (!sqlite?.open) throw new Error("SQLite.open 不可用")
  cachedDb = (await sqlite.open(databasePath())) as DB
  return cachedDb
}

async function ensureSchema(db: DB): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      image_path TEXT,
      source_change_count INTEGER,
      source TEXT NOT NULL DEFAULT 'local',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_copied_at INTEGER,
      pinned INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      manual_favorite INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    )
  `)
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN manual_favorite INTEGER NOT NULL DEFAULT 0")
  } catch {
  }
  try {
    await db.execute("ALTER TABLE clips ADD COLUMN source TEXT NOT NULL DEFAULT 'local'")
  } catch {
  }
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_active ON clips(deleted_at, pinned, updated_at)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_active_order ON clips(deleted_at, pinned DESC, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_favorite_order ON clips(deleted_at, favorite, pinned DESC, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_clipboard_order ON clips(deleted_at, manual_favorite, pinned DESC, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_trim_order ON clips(deleted_at, pinned, favorite, updated_at DESC)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash)")
  
  // Memo groups table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memo_groups (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      color TEXT,
      line_style TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      collapsed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  
  // Memos table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memos (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      title TEXT,
      text TEXT NOT NULL,
      image_path TEXT,
      insert_position TEXT DEFAULT 'end',
      enable_subfields INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES memo_groups(id) ON DELETE CASCADE
    )
  `)
  
  // Settings table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `)
  
  // Indexes for memos
  await db.execute("CREATE INDEX IF NOT EXISTS idx_memos_group_id ON memos(group_id)")
  await db.execute("CREATE INDEX IF NOT EXISTS idx_memos_sort_order ON memos(group_id, sort_order)")
}

export async function initializeDatabase(): Promise<DB> {
  const db = await openCaisDatabase()
  if (initialized) return db
  await ensureSchema(db)
  initialized = true
  return db
}

export async function insertClip(item: ClipItem): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(`
    INSERT OR REPLACE INTO clips (
      id, kind, title, content, content_hash, image_path, source_change_count, source,
      created_at, updated_at, last_copied_at, pinned, favorite, manual_favorite, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, clipParams(item))
}

export async function findClipByHash(contentHash: string, kind?: string): Promise<ClipItem | null> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    kind
      ? "SELECT * FROM clips WHERE content_hash = ? AND kind = ? AND deleted_at IS NULL LIMIT 1"
      : "SELECT * FROM clips WHERE content_hash = ? AND deleted_at IS NULL LIMIT 1",
    kind ? [contentHash, kind] : [contentHash]
  )
  return rows[0] ? rowToClip(rows[0]) : null
}

export async function findTextClipsByContent(content: string): Promise<ClipItem[]> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    "SELECT * FROM clips WHERE content = ? AND kind IN ('text', 'url') AND manual_favorite = 0 AND deleted_at IS NULL ORDER BY pinned DESC, favorite DESC, updated_at DESC",
    [content]
  )
  return rows.map(rowToClip)
}

async function fetchClipRows(db: DB, options: {
  scope?: ClipListScope
  search?: string
  limit?: number
}): Promise<any[]> {
  const params: any[] = []
  const clauses: string[] = ["deleted_at IS NULL"]
  if (options.scope) clauses.push(scopeClause(options.scope))
  const search = String(options.search ?? "").trim()
  if (search) {
    clauses.push("(title LIKE ? OR content LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(500, Number(options.limit ?? 100) || 100))
  params.push(limit)
  return db.fetchAll(
    `SELECT ${CLIP_ROW_SELECT} FROM clips ${where} ORDER BY pinned DESC, updated_at DESC LIMIT ?`,
    params
  )
}

export async function listClips(options: {
  scope?: ClipListScope
  search?: string
  limit?: number
} = {}): Promise<ClipItem[]> {
  const db = await openCaisDatabase()
  let rows: any[]
  try {
    rows = await fetchClipRows(db, options)
  } catch (error) {
    if (initialized) throw error
    await ensureSchema(db)
    initialized = true
    rows = await fetchClipRows(db, options)
  }
  return rows.map(rowToClip)
}

type TimeGroup = {
  title: string
  clause: string
  params: number[]
}

function clipTimeGroups(now: number): TimeGroup[] {
  const oneDayAgo = now - ONE_DAY_MS
  const threeDaysAgo = now - ONE_DAY_MS * 3
  const sevenDaysAgo = now - ONE_DAY_MS * 7
  return [
    { title: "最近内容", clause: "updated_at >= ?", params: [oneDayAgo] },
    { title: "近三天", clause: "updated_at < ? AND updated_at >= ?", params: [oneDayAgo, threeDaysAgo] },
    { title: "近七天", clause: "updated_at < ? AND updated_at >= ?", params: [threeDaysAgo, sevenDaysAgo] },
    { title: "更久", clause: "updated_at < ?", params: [sevenDaysAgo] },
  ]
}

function clipboardRangeClause(range: ClipboardClearRange, now = Date.now()): { clause: string; params: number[] } {
  const oneDayAgo = now - ONE_DAY_MS
  const threeDaysAgo = now - ONE_DAY_MS * 3
  const sevenDaysAgo = now - ONE_DAY_MS * 7
  switch (range) {
    case "recent":
      return { clause: "updated_at >= ?", params: [oneDayAgo] }
    case "threeDays":
      return { clause: "updated_at < ? AND updated_at >= ?", params: [oneDayAgo, threeDaysAgo] }
    case "sevenDays":
      return { clause: "updated_at < ? AND updated_at >= ?", params: [threeDaysAgo, sevenDaysAgo] }
    case "older":
      return { clause: "updated_at < ?", params: [sevenDaysAgo] }
  }
}

function scopeClause(scope: ClipListScope): string {
  if (scope === "favorites") return "favorite = 1"
  if (scope === "clipboard") return "manual_favorite = 0"
  return "1 = 1"
}

async function fetchClipGroupRows(db: DB, options: {
  scope: ClipListScope
  search?: string
  limit?: number
  offset?: number
  group: TimeGroup
}): Promise<any[]> {
  const params: any[] = []
  const clauses = ["deleted_at IS NULL", scopeClause(options.scope), options.group.clause]
  params.push(...options.group.params)
  const search = String(options.search ?? "").trim()
  if (search) {
    clauses.push("(title LIKE ? OR content LIKE ?)")
    params.push(`%${search}%`, `%${search}%`)
  }
  const limit = Math.max(1, Math.min(300, Number(options.limit ?? 120) || 120))
  const offset = Math.max(0, Number(options.offset ?? 0) || 0)
  params.push(limit, offset)
  return db.fetchAll(
    `SELECT ${CLIP_ROW_SELECT} FROM clips WHERE ${clauses.join(" AND ")} ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?`,
    params
  )
}

async function fetchClipGroups(db: DB, options: {
  scope: ClipListScope
  search?: string
  limit?: number
  offset?: number
}): Promise<ClipGroup[]> {
  const groups: ClipGroup[] = []
  for (const group of clipTimeGroups(Date.now())) {
    const rows = await fetchClipGroupRows(db, { ...options, group })
    groups.push({ title: group.title, items: rows.map(rowToClip) })
  }
  return groups
}

export async function listClipGroups(options: {
  scope: ClipListScope
  search?: string
  limit?: number
  offset?: number
}): Promise<ClipGroup[]> {
  const db = await openCaisDatabase()
  try {
    return await fetchClipGroups(db, options)
  } catch (error) {
    if (initialized) throw error
    await ensureSchema(db)
    initialized = true
    return fetchClipGroups(db, options)
  }
}

export async function updateClipState(id: string, updates: Partial<Pick<ClipItem, "updatedAt" | "lastCopiedAt" | "pinned" | "favorite">>): Promise<void> {
  const db = await initializeDatabase()
  const sets: string[] = []
  const params: any[] = []
  if (updates.updatedAt != null) {
    sets.push("updated_at = ?")
    params.push(updates.updatedAt)
  }
  if (updates.lastCopiedAt != null) {
    sets.push("last_copied_at = ?")
    params.push(updates.lastCopiedAt)
  }
  if (updates.pinned != null) {
    sets.push("pinned = ?")
    params.push(updates.pinned ? 1 : 0)
  }
  if (updates.favorite != null) {
    sets.push("favorite = ?")
    params.push(updates.favorite ? 1 : 0)
  }
  if (!sets.length) return
  params.push(id)
  await db.execute(`UPDATE clips SET ${sets.join(", ")} WHERE id = ?`, params)
}

export async function deleteClip(id: string): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM clips WHERE id = ?", [id])
}

export async function deleteClipboardClipsByRange(range: ClipboardClearRange): Promise<void> {
  const db = await initializeDatabase()
  const filter = clipboardRangeClause(range)
  await db.execute(
    `DELETE FROM clips WHERE manual_favorite = 0 AND ${filter.clause}`,
    filter.params
  )
}

export async function deleteAllClipboardClips(): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM clips WHERE manual_favorite = 0")
}

export async function deleteTextClipsByContent(content: string): Promise<number> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    "SELECT id FROM clips WHERE content = ? AND kind IN ('text', 'url') AND manual_favorite = 0",
    [content]
  )
  for (const row of rows) {
    await db.execute("DELETE FROM clips WHERE id = ?", [row.id])
  }
  return rows.length
}

export async function deleteFavoriteClips(): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM clips WHERE favorite = 1")
}

export async function listImagePaths(options: { favoritesOnly?: boolean; clipboardRange?: ClipboardClearRange } = {}): Promise<string[]> {
  const db = await initializeDatabase()
  const clauses = ["image_path IS NOT NULL"]
  const params: any[] = []
  if (options.favoritesOnly) {
    clauses.push("favorite = 1")
  } else {
    clauses.push("manual_favorite = 0")
  }
  if (options.clipboardRange) {
    const filter = clipboardRangeClause(options.clipboardRange)
    clauses.push(filter.clause)
    params.push(...filter.params)
  }
  const rows = await db.fetchAll(`SELECT image_path FROM clips WHERE ${clauses.join(" AND ")}`, params)
  return rows.map((row) => String(row.image_path ?? "")).filter(Boolean)
}

export async function updateClipContent(row: Pick<ClipItem, "id" | "kind" | "title" | "content" | "contentHash" | "updatedAt">): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(
    "UPDATE clips SET kind = ?, title = ?, content = ?, content_hash = ?, updated_at = ? WHERE id = ?",
    [row.kind, row.title, row.content, row.contentHash, row.updatedAt, row.id]
  )
}

export async function updateClipTitle(id: string, title: string): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("UPDATE clips SET title = ? WHERE id = ?", [title, id])
}

export async function trimActiveClips(maxItems: number): Promise<void> {
  const limit = Math.max(50, Number(maxItems) || 1000)
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    "SELECT id FROM clips WHERE deleted_at IS NULL AND pinned = 0 AND favorite = 0 ORDER BY updated_at DESC LIMIT -1 OFFSET ?",
    [limit]
  )
  if (!rows.length) return
  for (const row of rows) {
    await db.execute("DELETE FROM clips WHERE id = ?", [row.id])
  }
}

export async function getClipById(id: string): Promise<ClipItem | null> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll(
    `SELECT ${CLIP_ROW_SELECT} FROM clips WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id]
  )
  return rows[0] ? rowToClip(rows[0]) : null
}

export async function listSpotlightClips(limit = 1000): Promise<ClipItem[]> {
  const db = await initializeDatabase()
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 1000))
  const rows = await db.fetchAll(
    `SELECT id, kind, title, content, content_hash, image_path, source_change_count, source, created_at, updated_at, last_copied_at, pinned, favorite, manual_favorite, deleted_at
     FROM clips
     WHERE deleted_at IS NULL
     ORDER BY pinned DESC, favorite DESC, updated_at DESC
     LIMIT ?`,
    [safeLimit]
  )
  return rows.map(rowToClip)
}

export async function getFullClipContent(id: string): Promise<string> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll("SELECT content FROM clips WHERE id = ?", [id])
  return rows[0] ? String(rows[0].content ?? "") : ""
}

// Memo operations

export async function insertMemoGroup(group: KeyboardMemoGroup): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(`
    INSERT OR REPLACE INTO memo_groups (id, title, color, line_style, sort_order, collapsed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    group.id,
    group.title,
    group.color ?? null,
    group.lineStyle ?? null,
    group.sortOrder,
    group.collapsed ? 1 : 0,
    group.createdAt,
    group.updatedAt
  ])
}

export async function insertMemo(memo: KeyboardMemoItem, groupId: string): Promise<void> {
  const db = await initializeDatabase()
  await db.execute(`
    INSERT OR REPLACE INTO memos (id, group_id, kind, title, text, image_path, insert_position, enable_subfields, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    memo.id,
    groupId,
    memo.kind ?? "text",
    memo.title ?? null,
    memo.text,
    memo.imagePath ?? null,
    memo.insertPosition ?? "end",
    memo.enableSubfields ? 1 : 0,
    memo.sortOrder,
    memo.createdAt,
    memo.updatedAt
  ])
}

export async function saveMemoGroups(groups: KeyboardMemoGroup[]): Promise<void> {
  const db = await initializeDatabase()
  
  // Delete existing data (order matters: memos first due to foreign key)
  await db.execute("DELETE FROM memos")
  await db.execute("DELETE FROM memo_groups")
  
  // Insert new memo groups and memos
  for (const group of groups) {
    await insertMemoGroup(group)
    for (const memo of group.memos) {
      await insertMemo(memo, group.id)
    }
  }
}

export async function loadMemoGroups(): Promise<KeyboardMemoGroup[]> {
  const db = await initializeDatabase()
  
  // Get all memo groups
  const groupRows = await db.fetchAll(
    "SELECT * FROM memo_groups ORDER BY sort_order ASC, created_at ASC"
  )
  
  const groups: KeyboardMemoGroup[] = []
  
  for (const groupRow of groupRows) {
    // Get memos for this group
    const memoRows = await db.fetchAll(
      "SELECT * FROM memos WHERE group_id = ? ORDER BY sort_order ASC, created_at ASC",
      [groupRow.id]
    )
    
    const memos: KeyboardMemoItem[] = memoRows.map(memoRow => ({
      id: String(memoRow.id),
      kind: memoRow.kind === "image" ? "image" : "text",
      title: memoRow.title ? String(memoRow.title) : undefined,
      text: String(memoRow.text),
      imagePath: memoRow.image_path ? String(memoRow.image_path) : undefined,
      insertPosition: memoRow.insert_position === "start" ? "start" : "end",
      enableSubfields: Number(memoRow.enable_subfields) === 1,
      sortOrder: Number(memoRow.sort_order),
      createdAt: Number(memoRow.created_at),
      updatedAt: Number(memoRow.updated_at)
    }))
    
    groups.push({
      id: String(groupRow.id),
      title: String(groupRow.title),
      color: groupRow.color ? String(groupRow.color) : undefined,
      lineStyle: groupRow.line_style === "dashed" ? "dashed" : "solid",
      sortOrder: Number(groupRow.sort_order),
      collapsed: Number(groupRow.collapsed) === 1,
      createdAt: Number(groupRow.created_at),
      updatedAt: Number(groupRow.updated_at),
      memos
    })
  }
  
  return groups
}

// Settings operations

export async function loadSetting(key: string): Promise<any | null> {
  const db = await initializeDatabase()
  const rows = await db.fetchAll("SELECT value FROM settings WHERE key = ?", [key])
  if (!rows[0]) return null
  try {
    return JSON.parse(String(rows[0].value))
  } catch {
    return null
  }
}

export async function saveSetting(key: string, value: any): Promise<void> {
  const db = await initializeDatabase()
  const jsonValue = JSON.stringify(value)
  await db.execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)", [key, jsonValue, Date.now()])
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await initializeDatabase()
  await db.execute("DELETE FROM settings WHERE key = ?", [key])
}
