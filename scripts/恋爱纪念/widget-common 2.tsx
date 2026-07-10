import {
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"

export type PhotoCrop = {
  x: number
  y: number
  width: number
  height: number
}

export type SpecialDate = {
  id: string
  name: string
  month: number
  day: number
  disabled?: boolean
}

export type PhotoDisplayMode = "random" | "sequence" | "single"

export type PhotoSelection = {
  path: string
  index: number
}

export type DayReminder = {
  id: string
  name: string
  days: number
  disabled?: boolean
}

export type LoveSettings = {
  photos: string[]
  photoCrops: Record<string, PhotoCrop>
  photoHashes: Record<string, string>
  selectedPhotoIndex: number
  photoDisplayMode: PhotoDisplayMode
  photoStackIndices: number[]
  emoji: string
  startDate: string
  dayReminders: DayReminder[]
  qixiDisabled?: boolean
  specialDates: SpecialDate[]
  lastPhotoSwitchAt?: number
}

export type Holiday = {
  name: string
  date: Date
}

export const ICLOUD_BASE_DIR = `${FileManager.iCloudDocumentsDirectory}/scripting/恋爱纪念`
export const SETTINGS_FILE_PATH = `${ICLOUD_BASE_DIR}/settings.json`
export const PHOTO_DIR = `${ICLOUD_BASE_DIR}/photos`
export const WIDGET_PHOTO_CACHE_DIR = `${ICLOUD_BASE_DIR}/widget-cache`
export const WIDGET_PHOTO_SIZE = { width: 420, height: 420 }
export const WIDGET_PHOTO_JPEG_QUALITY = 0.62
// 防止一次系统刷新同时渲染多个尺寸、或点击切换后的 Widget.reloadAll() 造成连续跳两张。
export const WIDGET_PHOTO_SWITCH_DEDUP_MS = 1000 * 60
export const WidgetButtonFont = {
  font: 10,
  foregroundStyle: "secondaryLabel",
  fontDesign: "rounded",
  fontWeight: "semibold"
} as const

export const DEFAULT_SETTINGS: LoveSettings = {
  photos: [],
  photoCrops: {},
  photoHashes: {},
  selectedPhotoIndex: 0,
  photoDisplayMode: "single",
  photoStackIndices: [],
  emoji: "💗",
  startDate: "2024-05-20",
  dayReminders: [
    { id: "day-1", name: "一生一世", days: 1314 },
  ],
  qixiDisabled: false,
  specialDates: [
    { id: "valentine", name: "情人节", month: 2, day: 14 },
    { id: "520", name: "520", month: 5, day: 20 },
  ],
  lastPhotoSwitchAt: 0,
}

export const QIXI_DATES: Record<number, string> = {
  2024: "2024-08-10",
  2025: "2025-08-29",
  2026: "2026-08-19",
  2027: "2027-08-08",
  2028: "2028-08-26",
  2029: "2029-08-16",
  2030: "2030-08-05",
  2031: "2031-08-24",
  2032: "2032-08-12",
  2033: "2033-08-01",
  2034: "2034-08-20",
  2035: "2035-08-10",
}

export type SavedLoveSettings = Partial<Omit<LoveSettings, "photoDisplayMode"> & {
  photoDisplayMode: PhotoDisplayMode | "hourly"
}>

function ensureBaseDir() {
  if (!FileManager.existsSync(ICLOUD_BASE_DIR)) {
    FileManager.createDirectorySync(ICLOUD_BASE_DIR, true)
  }
}

function migrateFromStorage(): SavedLoveSettings | null {
  const oldKey = "love-anniversary-settings-v1"
  const saved = Storage.get<SavedLoveSettings>(oldKey, { shared: true })
  if (!saved) return null
  // 迁移完成后清除旧数据
  Storage.remove(oldKey, { shared: true })
  Storage.remove(`${oldKey}-last-photo-switch-at`, { shared: true })
  return saved
}

/** 计算照片文件的 MD5 哈希 */
export function computePhotoHash(filePath: string): string | null {
  try {
    const data = FileManager.readAsDataSync(filePath)
    const hash = Crypto.md5(data)
    return hash.toHexString()
  } catch {
    return null
  }
}

export function readSettings(): LoveSettings {
  ensureBaseDir()
  let saved: SavedLoveSettings | null = null

  if (FileManager.existsSync(SETTINGS_FILE_PATH)) {
    try {
      const content = FileManager.readAsStringSync(SETTINGS_FILE_PATH)
      saved = JSON.parse(content)
    } catch {
      saved = null
    }
  }

  // 一次性迁移：从旧 Storage 读取并写入新文件
  if (!saved) {
    saved = migrateFromStorage()
    if (saved) {
      FileManager.writeAsStringSync(SETTINGS_FILE_PATH, JSON.stringify(saved))
    }
  }

  return {
    ...DEFAULT_SETTINGS,
    ...(saved ?? {}),
    photos: saved?.photos ?? DEFAULT_SETTINGS.photos,
    photoCrops: saved?.photoCrops ?? DEFAULT_SETTINGS.photoCrops,
    photoHashes: (saved as any)?.photoHashes ?? {},
    photoDisplayMode: saved?.photoDisplayMode === "hourly" ? "sequence" : (saved?.photoDisplayMode ?? (saved?.selectedPhotoIndex === -1 ? "random" : DEFAULT_SETTINGS.photoDisplayMode)),
    selectedPhotoIndex: saved?.selectedPhotoIndex === -1 ? DEFAULT_SETTINGS.selectedPhotoIndex : (saved?.selectedPhotoIndex ?? DEFAULT_SETTINGS.selectedPhotoIndex),
    photoStackIndices: (saved?.photoStackIndices ?? DEFAULT_SETTINGS.photoStackIndices).filter(index => Number.isFinite(index) && index >= 0 && index < (saved?.photos?.length ?? 0)),
    dayReminders: (saved?.dayReminders ?? DEFAULT_SETTINGS.dayReminders).map(item => ({
      ...item,
      name: item.name ?? `${item.days}天`,
      disabled: item.disabled ?? false,
    })),
    qixiDisabled: saved?.qixiDisabled ?? DEFAULT_SETTINGS.qixiDisabled,
    specialDates: (saved?.specialDates ?? DEFAULT_SETTINGS.specialDates).map(item => ({
      ...item,
      disabled: item.disabled ?? false,
    })),
    lastPhotoSwitchAt: saved?.lastPhotoSwitchAt ?? 0,
  }
}

/** 为已有照片补充计算哈希（仅在设置页面调用，Widget 不需要） */
export function ensurePhotoHashes(settings: LoveSettings): LoveSettings {
  const photos = settings.photos
  const photoHashes = { ...settings.photoHashes }
  let dirty = false
  for (const path of photos) {
    if (!photoHashes[path]) {
      const hash = computePhotoHash(path)
      if (hash) {
        photoHashes[path] = hash
        dirty = true
      }
    }
  }
  // 清理已删除照片的哈希
  for (const key of Object.keys(photoHashes)) {
    if (!photos.includes(key)) {
      delete photoHashes[key]
      dirty = true
    }
  }
  if (!dirty) return settings
  const result = { ...settings, photoHashes }
  saveSettings(result)
  return result
}

export function saveSettings(settings: LoveSettings) {
  ensureBaseDir()
  FileManager.writeAsStringSync(SETTINGS_FILE_PATH, JSON.stringify(settings))
}

export function recordPhotoSwitch(timestamp = Date.now()) {
  const settings = readSettings()
  settings.lastPhotoSwitchAt = timestamp
  saveSettings(settings)
}

function recentlySwitchedPhoto(timestamp = Date.now()) {
  const settings = readSettings()
  const lastSwitchAt = settings.lastPhotoSwitchAt ?? 0
  return Number.isFinite(lastSwitchAt)
    && timestamp - lastSwitchAt >= 0
    && timestamp - lastSwitchAt < WIDGET_PHOTO_SWITCH_DEDUP_MS
}

export function switchToNextPhoto(settings: LoveSettings) {
  if (settings.photos.length <= 1 || settings.photoDisplayMode === "single") return settings

  const currentStack = selectedPhotoStack(settings)
  const currentIndices = currentStack.length > 0
    ? currentStack.map(item => item.index)
    : [Math.min(Math.max(0, settings.selectedPhotoIndex), settings.photos.length - 1)]
  const nextStack = nextPhotoStackIndices(settings, currentIndices)

  return {
    ...settings,
    selectedPhotoIndex: nextStack[0] ?? 0,
    photoStackIndices: nextStack,
  }
}

export function switchPhotoOnWidgetRefresh() {
  const settings = readSettings()
  if (settings.photos.length <= 1 || recentlySwitchedPhoto()) {
    return settings
  }

  const nextSettings = switchToNextPhoto(settings)
  saveSettings(nextSettings)
  recordPhotoSwitch()
  return nextSettings
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function dayDiff(from: Date, to: Date) {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime()
  return Math.floor(ms / 86400000)
}

export function dateInYear(year: number, month: number, day: number) {
  return new Date(year, month - 1, day)
}

export function nextAnnualDate(month: number, day: number, today: Date) {
  const year = today.getFullYear()
  const thisYear = dateInYear(year, month, day)
  return dayDiff(today, thisYear) >= 0 ? thisYear : dateInYear(year + 1, month, day)
}

export function qixiDate(year: number) {
  const value = QIXI_DATES[year]
  return value ? parseDate(value) : new Date(year, 7, 14)
}

export function nextQixi(today: Date) {
  const year = today.getFullYear()
  const thisYear = qixiDate(year)
  return dayDiff(today, thisYear) >= 0 ? thisYear : qixiDate(year + 1)
}

export function nextHoliday(settings: LoveSettings, today: Date): Holiday {
  const candidates: Holiday[] = [
    ...(settings.qixiDisabled ? [] : [{ name: "七夕节", date: nextQixi(today) }]),
    ...settings.specialDates
      .filter(item => !item.disabled)
      .map(item => ({ name: item.name, date: nextAnnualDate(item.month, item.day, today) })),
  ]

  return candidates.sort((a, b) => dayDiff(today, a.date) - dayDiff(today, b.date))[0]
    ?? { name: "相恋纪念", date: today }
}

/** 返回按日期排序的前 N 个最近节日 */
export function nextNHolidays(settings: LoveSettings, today: Date, count: number): Holiday[] {
  const candidates: Holiday[] = [
    ...(settings.qixiDisabled ? [] : [{ name: "七夕节", date: nextQixi(today) }]),
    ...settings.specialDates
      .filter(item => !item.disabled)
      .map(item => ({ name: item.name, date: nextAnnualDate(item.month, item.day, today) })),
  ]

  return candidates.sort((a, b) => dayDiff(today, a.date) - dayDiff(today, b.date)).slice(0, count)
}

export function selectedPhotoStack(settings: LoveSettings, count = 3): PhotoSelection[] {
  return photoStackIndices(settings, count).map(index => ({
    path: settings.photos[index],
    index,
  }))
}

export function photoStackIndices(settings: LoveSettings, count = 3): number[] {
  const total = settings.photos.length
  if (total === 0) return []

  const size = Math.min(count, total)
  const selectedIndex = Math.min(Math.max(0, settings.selectedPhotoIndex), total - 1)
  const savedStack = (settings.photoStackIndices ?? [])
    .filter(index => Number.isFinite(index) && index >= 0 && index < total)
    .filter((index, itemIndex, array) => array.indexOf(index) === itemIndex)

  // “固定”模式始终以用户指定照片为当前照片；其余底部照片只作为叠放装饰。
  if (settings.photoDisplayMode === "single") {
    const result = savedStack.length > 0 && savedStack[0] === selectedIndex
      ? savedStack.slice(0, size)
      : [selectedIndex]
    let cursor = result[result.length - 1] ?? selectedIndex
    while (result.length < size) {
      cursor = (cursor + 1) % total
      if (!result.includes(cursor) || total <= result.length) {
        result.push(cursor)
      }
    }
    return result
  }

  // 随机/顺序模式默认按用户添加顺序先展示前三张，之后点击时再补入第 4 张。
  if (savedStack.length === 0) {
    return settings.photos.slice(0, size).map((_, index) => index)
  }

  const result = savedStack.slice(0, size)
  let cursor = result[result.length - 1] ?? 0
  while (result.length < size) {
    cursor = (cursor + 1) % total
    if (!result.includes(cursor) || total <= result.length) {
      result.push(cursor)
    }
  }

  return result
}

export function nextPhotoStackIndices(settings: LoveSettings, currentStack: number[], count = 3): number[] {
  const total = settings.photos.length
  if (total === 0) return []

  const size = Math.min(count, total)
  const normalizedStack = currentStack
    .filter(index => Number.isFinite(index) && index >= 0 && index < total)
    .filter((index, itemIndex, array) => array.indexOf(index) === itemIndex)
    .slice(0, size)

  // 固定模式下，点击 Widget 不切换照片。
  if (settings.photoDisplayMode === "single") {
    return normalizedStack.length > 0 ? normalizedStack : photoStackIndices(settings, count)
  }

  const shifted = normalizedStack.slice(1)

  while (shifted.length < size) {
    shifted.push(nextIndexAfterStack(settings, normalizedStack, shifted, total))
  }

  return shifted
}

function nextIndexAfterStack(settings: LoveSettings, currentStack: number[], nextStack: number[], total: number) {
  if (settings.photoDisplayMode === "random") {
    const candidates = settings.photos
      .map((_, index) => index)
      // 当前界面前三张已经显示过，补入的第 4 张随机照片应避开它们。
      .filter(index => !currentStack.includes(index) && !nextStack.includes(index))
    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)]
    }
  }

  const lastIndex = currentStack[currentStack.length - 1] ?? settings.selectedPhotoIndex
  return (lastIndex + 1 + total) % total
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function safeCacheName(path: string) {
  let hash = 0
  for (let index = 0; index < path.length; index += 1) {
    hash = ((hash << 5) - hash + path.charCodeAt(index)) | 0
  }
  return `photo-${Math.abs(hash)}.jpg`
}

export function compressedWidgetPhotoPath(path: string | null) {
  if (!path) return null
  if (!FileManager.existsSync(path)) return null

  if (!FileManager.existsSync(WIDGET_PHOTO_CACHE_DIR)) {
    FileManager.createDirectorySync(WIDGET_PHOTO_CACHE_DIR, true)
  }

  const cachePath = `${WIDGET_PHOTO_CACHE_DIR}/${safeCacheName(path)}`
  if (FileManager.existsSync(cachePath)) return cachePath

  const image = UIImage.fromFile(path)
  if (!image) return null
  const thumbnail = image.preparingThumbnail(WIDGET_PHOTO_SIZE) ?? image
  const data = thumbnail.toJPEGData(WIDGET_PHOTO_JPEG_QUALITY)
  if (!data) return path

  FileManager.writeAsDataSync(cachePath, data)
  return cachePath
}

export function nextSpecialNumberInfo(settings: LoveSettings, daysTogether: number) {
  const candidates = settings.dayReminders
    .filter(item => !item.disabled)
    .map(item => {
      const base = Math.max(1, item.days)
      const multiplier = Math.max(1, Math.ceil(daysTogether / base))
      const target = base * multiplier
      return {
        target,
        remaining: target - daysTogether,
      }
    })
    .sort((a, b) => a.remaining - b.remaining)

  const nearest = candidates[0]
  if (nearest) {
    return { target: nearest.target, remaining: nearest.remaining, progress: clamp(daysTogether / nearest.target, 0, 1) }
  }

  const fallbackTarget = Math.max(1, daysTogether)
  return { target: fallbackTarget, remaining: 0, progress: 1 }
}

export function PlaceholderPhoto() {
  return (
    <ZStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="rgba(255, 139, 170, 0.28)"
      />
      <Text font={28}>💞</Text>
    </ZStack>
  )
}

export function PhotoView(props: { path: string | null; width: number; height: number; radius: number }) {
  return (
    <VStack
      frame={{ width: props.width, height: props.height }}
      clipShape={{ type: "rect", cornerRadius: props.radius }}
      clipped
    >
      {props.path ? (
        <Image
          filePath={props.path}
          resizable
          scaleToFill
          frame={{ width: props.width, height: props.height }}
          clipped
        />
      ) : (
        <PlaceholderPhoto />
      )}
    </VStack>
  )
}

export function StackedPhotoView(props: {
  paths: (string | null)[]
  width: number
  height: number
  radius: number
  offStepX?: number
  offStepY?: number
}) {
  const offStepX = props.offStepX ?? 7
  const offStepY = props.offStepY ?? -4
  const stackW = props.width + offStepX * 2
  const stackH = props.height + Math.abs(offStepY) * 2

  return (
    <ZStack
      // alignment="bottomLeading"
      frame={{ width: stackW, height: stackH }}
    >
      {[2, 1, 0]
        .filter((origIdx) => origIdx < props.paths.length)
        .map((origIdx) => {
          const offX = origIdx * offStepX
          const offY = origIdx * offStepY
          const rot = origIdx * 3
          const scale = 1 - origIdx * 0.04
          const path = props.paths[origIdx] ?? null
          return (
            <ZStack
              key={`${origIdx}-${path ?? "placeholder"}`}
              frame={{ width: props.width, height: props.height }}
              offset={{ x: offX, y: offY }}
              rotationEffect={{ degrees: rot, anchor: "bottomLeading" }}
              scaleEffect={{ x: scale, y: scale, anchor: "bottomLeading" }}
              shadow={{
                color: "rgba(0,0,0,0.22)",
                radius: 3,
                y: 2,
              }}
            >
              <PhotoView path={path} width={props.width} height={props.height} radius={props.radius} />
            </ZStack>
          )
        })}
    </ZStack>
  )
}

export function RemainingDaysLabel(props: {
  remaining: number
  prefixFont?: number
  numberFont: number
}) {
  return props.remaining >= 4 ? (
    <>
      <Text {...WidgetButtonFont} font={props.prefixFont} lineLimit={1} monospacedDigit>
        {'剩'}
      </Text>
      <Text {...WidgetButtonFont} font={props.numberFont} foregroundStyle="label" lineLimit={1} monospacedDigit>
        {props.remaining}
      </Text>
      <Text {...WidgetButtonFont} font={props.prefixFont} lineLimit={1} monospacedDigit>
        {'天'}
      </Text>
    </>
  ) : props.remaining === 3 ? (
    <Text {...WidgetButtonFont} font={props.numberFont} foregroundStyle="label" lineLimit={1} monospacedDigit>
      {"大后天"}
    </Text>
  ) : props.remaining === 2 ? (
    <Text {...WidgetButtonFont} font={props.numberFont} foregroundStyle="label" lineLimit={1} monospacedDigit>
      {"后天"}
    </Text>
  ) : props.remaining === 1 ? (
    <Text {...WidgetButtonFont} font={props.numberFont} foregroundStyle="label" lineLimit={1} monospacedDigit>
      {"明天"}
    </Text>
  ) : props.remaining === 0 ? (
    <Text {...WidgetButtonFont} font={props.numberFont} foregroundStyle="label" lineLimit={1} monospacedDigit>
      {"今天"}
    </Text>
  ) : null
}

export function WidgetMetricRow(props: {
  icon: string
  left: string
  right: number
  spacing: number
  iconFont: number
  iconSize: number
  leftFont?: number
  prefixFont?: number
  numberFont: number
}) {
  return (
    <HStack spacing={props.spacing} frame={{ maxWidth: "infinity" }}>
      <Image
        systemName={props.icon}
        font={props.iconFont}
        imageScale="small"
        foregroundStyle="rgba(255,255,255,0.88)"
        frame={{ width: props.iconSize, height: props.iconSize }}
      />
      <Text {...WidgetButtonFont} font={props.leftFont} lineLimit={1}>
        {props.left}
      </Text>
      <Spacer minLength={0} />
      <RemainingDaysLabel
        remaining={props.right}
        prefixFont={props.prefixFont}
        numberFont={props.numberFont}
      />
    </HStack>
  )
}

export function holidayCountdownDays(today: Date, holiday: Holiday) {
  return Math.max(0, dayDiff(today, holiday.date))
}
