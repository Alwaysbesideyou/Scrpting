const ICLOUD_PERSISTENT_ROOT = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/Off day"

function joinPath(base: string, name: string): string {
  if (!base) return name
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`
}

function preferredPersistentBaseDirectory(): string {
  const fm = (globalThis as any).FileManager
  const candidates = [
    ICLOUD_PERSISTENT_ROOT,
    fm?.iCloudDocumentsDirectory,
    fm?.documentsDirectory,
    fm?.appGroupDocumentsDirectory,
    fm?.scriptsDirectory,
    "",
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate
  }
  return ""
}

export function databasePath(): string {
  return joinPath(preferredPersistentBaseDirectory(), "offday.sqlite")
}

export async function ensureAppDirectories(): Promise<void> {
  const fm = (globalThis as any).FileManager
  if (!fm) return
  const dir = preferredPersistentBaseDirectory()
  if (typeof fm.exists === "function" && typeof fm.createDirectory === "function") {
    if (!(await fm.exists(dir))) await fm.createDirectory(dir, true)
    return
  }
  if (typeof fm.existsSync === "function" && typeof fm.createDirectorySync === "function") {
    if (!fm.existsSync(dir)) fm.createDirectorySync(dir, true)
  }
}
