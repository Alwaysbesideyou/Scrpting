import type { CalendarState, DayOverrideKind, HolidayCalendarSource } from "../types"
import { databasePath, ensureAppDirectories } from "./paths"

// 与通用剪切板完全一致的DB类型和打开方式
type DB = {
 execute: (sql: string, params?: any[]) => Promise<any>
 fetchAll: (sql: string, params?: any[]) => Promise<any[]>
}

let cachedDb: DB | null = null
let initialized = false

async function sleep(ms: number): Promise<void> {
 await new Promise(resolve => setTimeout(() => resolve(undefined), ms))
}

export async function openDatabase(): Promise<DB> {
 if (cachedDb) return cachedDb
 await ensureAppDirectories()
 const sqlite = (globalThis as any).SQLite
 if (!sqlite?.open) throw new Error("SQLite.open 不可用")
 const path = databasePath()
 console.log(`[db] 打开数据库: ${path}`)
 cachedDb = (await sqlite.open(path)) as DB
 return cachedDb
}

async function ensureSchema(db: DB): Promise<void> {
 await db.execute(`
 CREATE TABLE IF NOT EXISTS holiday_sources (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 url TEXT NOT NULL,
 last_synced_at INTEGER
 )
 `)
 await db.execute(`
 CREATE TABLE IF NOT EXISTS holiday_dates (
 source_id TEXT NOT NULL,
 date_key TEXT NOT NULL,
 PRIMARY KEY (source_id, date_key)
 )
 `)
 await db.execute(`
 CREATE TABLE IF NOT EXISTS holiday_items (
 id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL,
 date_key TEXT NOT NULL,
 title TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'unknown'
 )
 `)
 await db.execute("CREATE INDEX IF NOT EXISTS idx_holiday_items_date ON holiday_items(date_key)")
 await db.execute("CREATE INDEX IF NOT EXISTS idx_holiday_items_source ON holiday_items(source_id)")
 await db.execute(`
 CREATE TABLE IF NOT EXISTS fixed_off_weekdays (
 weekday INTEGER PRIMARY KEY
 )
 `)
 await db.execute(`
 CREATE TABLE IF NOT EXISTS day_overrides (
 date_key TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 note TEXT,
 updated_at INTEGER NOT NULL
 )
 `)
 console.log("[db] Schema 初始化完成")
}

export async function initializeDatabase(): Promise<DB> {
 const db = await openDatabase()
 if (initialized) return db

 let lastError: unknown
 for (let attempt =0; attempt <5; attempt++) {
 try {
 await ensureSchema(db)
 initialized = true
 return db
 } catch (error) {
 lastError = error
 if (!String(error).includes("database is locked")) {
 throw error
 }
 await sleep(100 * (attempt +1))
 }
 }

 throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

// 加载完整状态
export async function loadCalendarState(): Promise<CalendarState> {
 const db = await initializeDatabase()

 const sources = await db.fetchAll("SELECT * FROM holiday_sources")
 console.log(`[db] 加载到 ${sources.length} 个节假日源`)
 const holidaySources: HolidayCalendarSource[] = []

 for (const source of sources) {
 const dates = await db.fetchAll(
 "SELECT date_key FROM holiday_dates WHERE source_id = ? ORDER BY date_key",
 [source.id]
 )
 const items = await db.fetchAll(
 "SELECT * FROM holiday_items WHERE source_id = ?",
 [source.id]
 )
 console.log(`[db] 源 ${source.id}: ${dates.length} 日期, ${items.length} 项目, lastSynced=${source.last_synced_at}`)

 holidaySources.push({
 id: source.id,
 title: source.title,
 url: source.url,
 holidayDates: dates.map((d: any) => d.date_key),
 holidayItems: items.map((item: any) => ({
 id: item.id,
 dateKey: item.date_key,
 title: item.title,
 kind: item.kind as "off" | "work" | "unknown",
 })),
 lastSyncedAt: source.last_synced_at,
 })
 }

 const weekdays = await db.fetchAll("SELECT weekday FROM fixed_off_weekdays ORDER BY weekday")
 const fixedOffWeekdays = weekdays.map((w: any) => w.weekday)

 const overrides = await db.fetchAll("SELECT date_key, kind FROM day_overrides")
 const dayOverrides: Record<string, DayOverrideKind> = {}
 for (const row of overrides) {
 dayOverrides[row.date_key] = row.kind as DayOverrideKind
 }

 const notes = await db.fetchAll("SELECT date_key, note FROM day_overrides WHERE note IS NOT NULL AND note != ''")
 const dayNotes: Record<string, string> = {}
 for (const row of notes) {
 dayNotes[row.date_key] = row.note
 }

 return { holidaySources, fixedOffWeekdays, dayOverrides, dayNotes }
}

// 保存完整状态 —逐条 execute，和通用剪切板一致
export async function saveCalendarState(state: CalendarState): Promise<void> {
 const db = await initializeDatabase()

 const totalDates = state.holidaySources.reduce((n, s) => n + s.holidayDates.length,0)
 const totalItems = state.holidaySources.reduce((n, s) => n + s.holidayItems.length,0)
 console.log(`[db] 开始保存: ${state.holidaySources.length} 源, ${totalDates} 日期, ${totalItems} 项目`)

 //1. DELETE旧数据
 await db.execute("DELETE FROM holiday_items")
 await db.execute("DELETE FROM holiday_dates")
 await db.execute("DELETE FROM holiday_sources")
 await db.execute("DELETE FROM fixed_off_weekdays")
 await db.execute("DELETE FROM day_overrides")
 console.log("[db] 已清除旧数据")

 //2. INSERT 新数据
 for (const source of state.holidaySources) {
 await db.execute(
 "INSERT INTO holiday_sources (id, title, url, last_synced_at) VALUES (?, ?, ?, ?)",
 [source.id, source.title, source.url, source.lastSyncedAt]
 )
 console.log(`[db] 已插入源 ${source.id}`)

 for (const dateKey of source.holidayDates) {
 await db.execute(
 "INSERT OR IGNORE INTO holiday_dates (source_id, date_key) VALUES (?, ?)",
 [source.id, dateKey]
 )
 }
 console.log(`[db] 已插入 ${source.holidayDates.length} 个日期`)

 for (const item of source.holidayItems) {
 await db.execute(
 "INSERT INTO holiday_items (id, source_id, date_key, title, kind) VALUES (?, ?, ?, ?, ?)",
 [item.id, source.id, item.dateKey, item.title, item.kind]
 )
 }
 console.log(`[db] 已插入 ${source.holidayItems.length} 个项目`)
 }

 for (const weekday of state.fixedOffWeekdays) {
 await db.execute("INSERT INTO fixed_off_weekdays (weekday) VALUES (?)", [weekday])
 }

 const now = Date.now()
 for (const [dateKey, kind] of Object.entries(state.dayOverrides)) {
 const note = state.dayNotes[dateKey] || null
 await db.execute(
 "INSERT INTO day_overrides (date_key, kind, note, updated_at) VALUES (?, ?, ?, ?)",
 [dateKey, kind, note, now]
 )
 }

 //3.立即验证
 const vSources = await db.fetchAll("SELECT COUNT(*) as cnt FROM holiday_sources")
 const vDates = await db.fetchAll("SELECT COUNT(*) as cnt FROM holiday_dates")
 const vItems = await db.fetchAll("SELECT COUNT(*) as cnt FROM holiday_items")
 const vWeekdays = await db.fetchAll("SELECT COUNT(*) as cnt FROM fixed_off_weekdays")
 console.log(`[db] 保存验证 → sources=${vSources[0]?.cnt}, dates=${vDates[0]?.cnt}, items=${vItems[0]?.cnt}, weekdays=${vWeekdays[0]?.cnt}`)
}

// 设置单个日期的状态
export async function setDayOverride(dateKey: string, kind: DayOverrideKind, note?: string): Promise<void> {
 const db = await initializeDatabase()
 const now = Date.now()
 await db.execute(
 "INSERT OR REPLACE INTO day_overrides (date_key, kind, note, updated_at) VALUES (?, ?, ?, ?)",
 [dateKey, kind, note || null, now]
 )
}

// 获取单个日期的状态
export async function getDayOverride(dateKey: string): Promise<{ kind: DayOverrideKind; note?: string } | null> {
 const db = await initializeDatabase()
 const rows = await db.fetchAll(
 "SELECT kind, note FROM day_overrides WHERE date_key = ?",
 [dateKey]
 )
 if (rows.length ===0) return null
 return {
 kind: rows[0].kind as DayOverrideKind,
 note: rows[0].note || undefined,
 }
}

// 删除单个日期的状态
export async function deleteDayOverride(dateKey: string): Promise<void> {
 const db = await initializeDatabase()
 await db.execute("DELETE FROM day_overrides WHERE date_key = ?", [dateKey])
}
