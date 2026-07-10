const APP_DIR_NAME = ""
const IMAGE_DIR_NAME = "images"
const FILES_DIR_NAME = "files"
const ICLOUD_PERSISTENT_ROOT = "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/通用剪切板"

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

export function appRootDirectory(): string {
  return preferredPersistentBaseDirectory()
}

export function databasePath(): string {
  return joinPath(appRootDirectory(), "cais.sqlite")
}

export function imageDirectory(): string {
  return joinPath(appRootDirectory(), IMAGE_DIR_NAME)
}

export function filesDirectory(): string {
  return joinPath(appRootDirectory(), FILES_DIR_NAME)
}

export function imagePathForId(id: string): string {
  return joinPath(imageDirectory(), `${id}.png`)
}

export function thumbnailPathForId(id: string): string {
  return joinPath(imageDirectory(), `${id}.thumb.jpg`)
}

export function thumbnailPathForImagePath(path?: string | null): string | undefined {
  if (!path) return undefined
  const slashIndex = path.lastIndexOf("/")
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : ""
  const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path
  const baseName = fileName.replace(/\.[^.]+$/, "")
  return `${directory}${baseName}.thumb.jpg`
}

export async function ensureAppDirectories(): Promise<void> {
  const fm = (globalThis as any).FileManager
  if (!fm) return
  const root = appRootDirectory()
  const images = imageDirectory()
  const files = filesDirectory()
  if (typeof fm.exists === "function" && typeof fm.createDirectory === "function") {
    if (!(await fm.exists(root))) await fm.createDirectory(root, true)
    if (!(await fm.exists(images))) await fm.createDirectory(images, true)
    if (!(await fm.exists(files))) await fm.createDirectory(files, true)
    return
  }
  if (typeof fm.existsSync === "function" && typeof fm.createDirectorySync === "function") {
    if (!fm.existsSync(root)) fm.createDirectorySync(root, true)
    if (!fm.existsSync(images)) fm.createDirectorySync(images, true)
    if (!fm.existsSync(files)) fm.createDirectorySync(files, true)
  }
}
