import {
  Button,
  DatePicker,
  DisclosureGroup,
  Divider,
  DragGestureDetails,
  Group,
  HStack,
  Image,
  LazyHStack,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Picker,
  Script,
  ScrollView,
  Section,
  Slider,
  Spacer,
  Text,
  TextField,
  VStack,
  Widget,
  ZStack,
  useRef,
  useState,
} from "scripting"
import {
  type PhotoCrop,
  type SpecialDate,
  type PhotoDisplayMode,
  type DayReminder,
  type LoveSettings,
  PHOTO_DIR,
  readSettings,
  saveSettings as saveSettingsToFile,
  ensurePhotoHashes,
} from "./widget-common"

declare function vibrate(): void

const PHOTO_THUMBNAIL_SIZE = { width: 900, height: 900 }
const PHOTO_JPEG_QUALITY = 0.72
const CROP_PREVIEW_MAX_SIZE = 240
const CROP_EDITOR_SIDE_MARGIN = 28
const CROP_MIN_RATIO = 0.18
const CROP_HANDLE_HIT_SIZE = 52
const CROP_HANDLE_VISUAL_LENGTH = 54
const CROP_HANDLE_VISUAL_THICKNESS = 6
const CROP_EDGE_TOUCH_INSET = 32
const CROP_CORNER_HIT_SIZE = 64
const CROP_CORNER_VISUAL_SIZE = 18

// 本地 saveSettings 包装，保存后刷新 Widget
function saveSettings(settings: LoveSettings) {
  saveSettingsToFile(settings)
  Widget.reloadAll()
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function dateStringFromTimestamp(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function clampEmojiInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""

  const Segmenter = (Intl as any)?.Segmenter
  if (Segmenter) {
    const segments = Array.from(new Segmenter("en", { granularity: "grapheme" }).segment(trimmed)) as Array<{ segment: string }>
    return segments[0]?.segment ?? ""
  }

  return Array.from(trimmed)[0] ?? ""
}

function daysInMonth(month: number, year = 2024) {
  return new Date(year, clamp(month, 1, 12), 0).getDate()
}

function currentAnnualDateTimestamp(month: number, day: number) {
  const now = new Date()
  const year = now.getFullYear()
  const safeMonth = clamp(month, 1, 12)
  const safeDay = clamp(day, 1, daysInMonth(safeMonth, year))
  return new Date(year, safeMonth - 1, safeDay).getTime()
}

function monthDayFromTimestamp(timestamp: number) {
  const date = new Date(timestamp)
  return {
    month: date.getMonth() + 1,
    day: date.getDate(),
  }
}

function annualDateText(month: number, day: number) {
  const year = new Date().getFullYear()
  const safeDay = clamp(day, 1, daysInMonth(month, year))
  return `${year}年${month}月${safeDay}日`
}

function sanitizePositiveInteger(value: string, fallback: number) {
  const parsed = Number(value.replace(/[^0-9]/g, ""))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fitSize(width: number, height: number, maxSize: number) {
  const scale = Math.min(maxSize / Math.max(1, width), maxSize / Math.max(1, height), 1)
  return {
    width: Math.max(120, Math.round(width * scale)),
    height: Math.max(120, Math.round(height * scale)),
  }
}

function previewSizeForPhoto(path: string) {
  const image = UIImage.fromFile(path)
  if (!image) return { width: CROP_PREVIEW_MAX_SIZE, height: CROP_PREVIEW_MAX_SIZE }
  return fitSize(image.width, image.height, CROP_PREVIEW_MAX_SIZE)
}

function fullScreenPreviewSizeForPhoto(path: string) {
  const maxWidth = Math.max(240, Device.screen.width - CROP_EDITOR_SIDE_MARGIN * 2)
  const maxHeight = Math.max(320, Device.screen.height - 220)
  const image = UIImage.fromFile(path)
  if (!image) return { width: maxWidth, height: Math.min(maxWidth, maxHeight) }
  const scale = Math.min(maxWidth / Math.max(1, image.width), maxHeight / Math.max(1, image.height), 1)
  return {
    width: Math.max(220, Math.round(image.width * scale)),
    height: Math.max(220, Math.round(image.height * scale)),
  }
}

function clampCropToBounds(crop: PhotoCrop): PhotoCrop {
  const width = clamp(crop.width, CROP_MIN_RATIO, 1)
  const height = clamp(crop.height, CROP_MIN_RATIO, 1)
  return {
    x: clamp(crop.x, 0, 1 - width),
    y: clamp(crop.y, 0, 1 - height),
    width,
    height,
  }
}

function normalizedCrop(crop?: PhotoCrop): PhotoCrop {
  return clampCropToBounds({
    x: crop?.x ?? 0,
    y: crop?.y ?? 0,
    width: crop?.width ?? 1,
    height: crop?.height ?? 1,
  })
}

type CropEdge = "left" | "right" | "top" | "bottom"
type CropCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight"
type CropHandle = CropEdge | CropCorner

type CropDragSession = {
  handle: CropHandle
  origin: PhotoCrop
}

function cropFromEdges(left: number, top: number, right: number, bottom: number): PhotoCrop {
  const minWidth = CROP_MIN_RATIO
  const minHeight = CROP_MIN_RATIO
  const nextLeft = clamp(left, 0, 1 - minWidth)
  const nextTop = clamp(top, 0, 1 - minHeight)
  const nextRight = clamp(right, nextLeft + minWidth, 1)
  const nextBottom = clamp(bottom, nextTop + minHeight, 1)
  return {
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  }
}

function resizeCropFromHandle(
  crop: PhotoCrop,
  handle: CropHandle,
  translation: { width: number; height: number },
  previewSize: { width: number; height: number },
) {
  const start = clampCropToBounds(crop)
  const dx = translation.width / Math.max(1, previewSize.width)
  const dy = translation.height / Math.max(1, previewSize.height)
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height

  if (handle === "left" || handle === "topLeft" || handle === "bottomLeft") {
    left = clamp(start.x + dx, 0, right - CROP_MIN_RATIO)
  }
  if (handle === "right" || handle === "topRight" || handle === "bottomRight") {
    right = clamp(start.x + start.width + dx, left + CROP_MIN_RATIO, 1)
  }
  if (handle === "top" || handle === "topLeft" || handle === "topRight") {
    top = clamp(start.y + dy, 0, bottom - CROP_MIN_RATIO)
  }
  if (handle === "bottom" || handle === "bottomLeft" || handle === "bottomRight") {
    bottom = clamp(start.y + start.height + dy, top + CROP_MIN_RATIO, 1)
  }

  return cropFromEdges(left, top, right, bottom)
}

function cropRectInPreview(crop: PhotoCrop, previewSize: { width: number; height: number }) {
  const normalized = clampCropToBounds(crop)
  return {
    left: normalized.x * previewSize.width,
    top: normalized.y * previewSize.height,
    width: normalized.width * previewSize.width,
    height: normalized.height * previewSize.height,
    right: (normalized.x + normalized.width) * previewSize.width,
    bottom: (normalized.y + normalized.height) * previewSize.height,
  }
}

function selectCropHandleFromPoint(
  point: { x: number; y: number },
  crop: PhotoCrop,
  previewSize: { width: number; height: number },
): CropHandle | null {
  const rect = cropRectInPreview(crop, previewSize)
  const insideExpandedCrop =
    point.x >= rect.left - CROP_EDGE_TOUCH_INSET &&
    point.x <= rect.right + CROP_EDGE_TOUCH_INSET &&
    point.y >= rect.top - CROP_EDGE_TOUCH_INSET &&
    point.y <= rect.bottom + CROP_EDGE_TOUCH_INSET

  if (!insideExpandedCrop) return null

  const nearLeft = Math.abs(point.x - rect.left) <= CROP_CORNER_HIT_SIZE / 2
  const nearRight = Math.abs(point.x - rect.right) <= CROP_CORNER_HIT_SIZE / 2
  const nearTop = Math.abs(point.y - rect.top) <= CROP_CORNER_HIT_SIZE / 2
  const nearBottom = Math.abs(point.y - rect.bottom) <= CROP_CORNER_HIT_SIZE / 2

  if (nearLeft && nearTop) return "topLeft"
  if (nearRight && nearTop) return "topRight"
  if (nearLeft && nearBottom) return "bottomLeft"
  if (nearRight && nearBottom) return "bottomRight"

  const distances: Array<{ handle: CropEdge; value: number }> = [
    { handle: "left", value: Math.abs(point.x - rect.left) },
    { handle: "right", value: Math.abs(point.x - rect.right) },
    { handle: "top", value: Math.abs(point.y - rect.top) },
    { handle: "bottom", value: Math.abs(point.y - rect.bottom) },
  ]
  const nearest = distances.sort((a, b) => a.value - b.value)[0]
  return nearest.value <= CROP_HANDLE_HIT_SIZE ? nearest.handle : null
}

function cropEdgeDistances(crop: PhotoCrop, previewSize: { width: number; height: number }) {
  const rect = cropRectInPreview(crop, previewSize)
  return {
    left: rect.left,
    top: rect.top,
    right: Math.max(0, previewSize.width - rect.right),
    bottom: Math.max(0, previewSize.height - rect.bottom),
    width: rect.width,
    height: rect.height,
  }
}


function cropDescription(crop?: PhotoCrop) {
  const value = normalizedCrop(crop)
  if (value.x === 0 && value.y === 0 && value.width === 1 && value.height === 1) return "全图"
  return `左${Math.round(value.x * 100)}% 上${Math.round(value.y * 100)}% 宽${Math.round(value.width * 100)}% 高${Math.round(value.height * 100)}%`
}

async function ensurePhotoDir() {
  if (!FileManager.existsSync(PHOTO_DIR)) {
    await FileManager.createDirectory(PHOTO_DIR, true)
  }
}

function compressedPhotoData(image: UIImage) {
  const thumbnail = image.preparingThumbnail(PHOTO_THUMBNAIL_SIZE) ?? image
  return thumbnail.toJPEGData(PHOTO_JPEG_QUALITY)
}

async function addPhotos(current: LoveSettings): Promise<LoveSettings> {
  await ensurePhotoDir()
  const results = await Photos.pick({ mode: "default", filter: PHPickerFilter.images(), limit: 100 })
  const newPaths: string[] = []
  const nextPhotoHashes = { ...current.photoHashes }
  // 收集已有照片的哈希集合用于去重
  const existingHashes = new Set(Object.values(nextPhotoHashes))
  let duplicateCount = 0

  for (const result of results) {
    const image = await result.uiImage()
    const data = image ? compressedPhotoData(image) : null
    if (!data) continue

    // 计算新照片的哈希，检查是否重复
    const hash = Crypto.md5(data).toHexString()
    if (existingHashes.has(hash)) {
      duplicateCount++
      continue
    }

    const path = `${PHOTO_DIR}/photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
    FileManager.writeAsDataSync(path, data)
    newPaths.push(path)
    if (hash) {
      nextPhotoHashes[path] = hash
      existingHashes.add(hash)
    }
  }

  if (duplicateCount > 0) {
    console.log(`已跳过 ${duplicateCount} 张重复照片`)
  }

  const nextPhotoCrops = { ...current.photoCrops }
  for (const path of newPaths) {
    nextPhotoCrops[path] = normalizedCrop()
  }

  return {
    ...current,
    photos: [...current.photos, ...newPaths].slice(-100),
    photoCrops: nextPhotoCrops,
    photoHashes: nextPhotoHashes,
    photoStackIndices: [],
    selectedPhotoIndex: current.photos.length === 0 && newPaths.length > 0 ? 0 : current.selectedPhotoIndex,
  }
}

async function replacePhoto(current: LoveSettings, index: number): Promise<LoveSettings | null> {
  await ensurePhotoDir()
  const results = await Photos.pick({ mode: "default", filter: PHPickerFilter.images(), limit: 1 })
  const image = await results[0]?.uiImage()
  const data = image ? compressedPhotoData(image) : null
  if (!data) return null

  const nextPath = `${PHOTO_DIR}/photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  FileManager.writeAsDataSync(nextPath, data)
  const nextPhotos = [...current.photos]
  const oldPath = nextPhotos[index]
  nextPhotos[index] = nextPath
  if (oldPath && FileManager.existsSync(oldPath)) {
    FileManager.removeSync(oldPath)
  }

  // 更新哈希记录
  const nextPhotoHashes = { ...current.photoHashes }
  if (oldPath) delete nextPhotoHashes[oldPath]
  nextPhotoHashes[nextPath] = Crypto.md5(data).toHexString()

  return {
    ...current,
    photos: nextPhotos,
    photoCrops: { ...current.photoCrops, [nextPath]: normalizedCrop() },
    photoHashes: nextPhotoHashes,
    photoStackIndices: [],
    selectedPhotoIndex: Math.min(Math.max(0, current.selectedPhotoIndex), nextPhotos.length - 1),
  }
}

function deletePhoto(current: LoveSettings, index: number): LoveSettings {
  const nextPhotos = current.photos.filter((_, itemIndex) => itemIndex !== index)
  const oldPath = current.photos[index]
  if (oldPath && FileManager.existsSync(oldPath)) {
    FileManager.removeSync(oldPath)
  }

  const nextCrops = { ...current.photoCrops }
  if (oldPath) delete nextCrops[oldPath]

  const nextHashes = { ...current.photoHashes }
  if (oldPath) delete nextHashes[oldPath]

  return {
    ...current,
    photos: nextPhotos,
    photoCrops: nextCrops,
    photoHashes: nextHashes,
    selectedPhotoIndex: nextPhotos.length === 0
      ? 0
      : Math.min(current.selectedPhotoIndex > index ? current.selectedPhotoIndex - 1 : current.selectedPhotoIndex, nextPhotos.length - 1),
    photoStackIndices: [],
  }
}

function PhotoThumb(props: {
  path?: string
  index: number
  selected: boolean
}) {
  const borderColor = props.selected ? "rgba(255, 82, 120, 1)" : "rgba(142, 142, 147, 0.25)"

  return (
    <VStack
      frame={{ width: 88, height: 100 }}
      spacing={6}
    >
      <VStack
        frame={{ width: 88, height: 88 }}
        background="rgba(118, 118, 128, 0.12)"
        clipShape={{ type: "rect", cornerRadius: 18 }}
        overlay={
          <Group>
            {!props.path ? (
              <Text font={24} foregroundStyle="rgba(142, 142, 147, 1)">{props.index + 1}</Text>
            ) : null}
          </Group>
        }
        border={{ style: borderColor, width: props.selected ? 3 : 1 }}
      >
        {props.path ? (
          <Image
            filePath={props.path}
            resizable
            scaleToFill
            frame={{ width: 88, height: 88 }}
            clipped
          />
        ) : null}
      </VStack>
      <Text font={11} foregroundStyle={props.selected ? "rgba(255, 82, 120, 1)" : "rgba(142, 142, 147, 1)"} lineLimit={1}>
        {props.selected ? "当前显示" : `照片 ${props.index + 1}`}
      </Text>
    </VStack>
  )
}

function PhotoCropEditor(props: {
  path: string
  index: number
  crop: PhotoCrop
  onChanged: (crop: PhotoCrop) => void
  onReset: () => void
  onClose?: () => void
  previewSize?: { width: number; height: number }
}) {
  const [activeHandle, setActiveHandle] = useState<CropHandle | null>(null)
  const [draftCrop, setDraftCrop] = useState<PhotoCrop>(normalizedCrop(props.crop))
  const dragSessionRef = useRef<CropDragSession | null>(null)
  const latestCropRef = useRef<PhotoCrop>(draftCrop)
  const previewSize = props.previewSize ?? previewSizeForPhoto(props.path)
  const crop = clampCropToBounds(draftCrop)
  latestCropRef.current = crop

  const cropDistances = cropEdgeDistances(crop, previewSize)

  function commitCrop(nextCrop: PhotoCrop) {
    const normalized = normalizedCrop(nextCrop)
    latestCropRef.current = normalized
    setDraftCrop(normalized)
    props.onChanged(normalized)
  }

  function beginHandleDrag(handle: CropHandle) {
    const origin = latestCropRef.current
    dragSessionRef.current = { handle, origin }
    setActiveHandle(handle)
    vibrate()
  }

  function handleFrame(handle: CropHandle, hitArea = false) {
    const vertical = handle === "left" || handle === "right"
    const horizontal = handle === "top" || handle === "bottom"
    const corner = !vertical && !horizontal
    if (hitArea) {
      if (corner) return { width: CROP_CORNER_HIT_SIZE, height: CROP_CORNER_HIT_SIZE }
      return {
        width: vertical ? CROP_HANDLE_HIT_SIZE : Math.max(CROP_HANDLE_HIT_SIZE, cropDistances.width),
        height: vertical ? Math.max(CROP_HANDLE_HIT_SIZE, cropDistances.height) : CROP_HANDLE_HIT_SIZE,
      }
    }
    if (corner) return { width: CROP_CORNER_VISUAL_SIZE, height: CROP_CORNER_VISUAL_SIZE }
    return {
      width: vertical ? CROP_HANDLE_VISUAL_THICKNESS : Math.max(CROP_HANDLE_VISUAL_LENGTH, cropDistances.width * 0.62),
      height: vertical ? Math.max(CROP_HANDLE_VISUAL_LENGTH, cropDistances.height * 0.62) : CROP_HANDLE_VISUAL_THICKNESS,
    }
  }

  function handleColor(handle: CropHandle) {
    return activeHandle === handle ? "rgba(255, 82, 120, 1)" : "rgba(255,255,255,0.96)"
  }

  function resetCrop() {
    commitCrop(normalizedCrop())
    props.onReset()
  }

  function closeEditor() {
    commitCrop(latestCropRef.current)
    props.onClose?.()
  }

  function CropHandleView(props: { handle: CropHandle }) {
    const corner = props.handle === "topLeft" || props.handle === "topRight" || props.handle === "bottomLeft" || props.handle === "bottomRight"
    return (
      <VStack
        frame={handleFrame(props.handle)}
        background={handleColor(props.handle)}
        clipShape={{ type: "rect", cornerRadius: corner ? 5 : 3 }}
        border={corner ? { style: "rgba(0,0,0,0.20)", width: 1 } : undefined}
        shadow={{ color: "rgba(0,0,0,0.35)", radius: 4 }}
      />
    )
  }

  function CenteredEdgeHandle(props: { handle: CropHandle }) {
    const vertical = props.handle === "left" || props.handle === "right"
    return vertical ? (
      <VStack frame={{ width: CROP_HANDLE_VISUAL_THICKNESS, height: cropDistances.height }} alignment="center">
        <Spacer />
        <CropHandleView handle={props.handle} />
        <Spacer />
      </VStack>
    ) : (
      <HStack frame={{ width: cropDistances.width, height: CROP_HANDLE_VISUAL_THICKNESS }} alignment="center">
        <Spacer />
        <CropHandleView handle={props.handle} />
        <Spacer />
      </HStack>
    )
  }

  function CropBox() {
    return (
      <ZStack frame={{ width: cropDistances.width, height: cropDistances.height }}>
        <VStack
          frame={{ width: cropDistances.width, height: cropDistances.height }}
          background="rgba(255,255,255,0.06)"
          border={{ style: activeHandle ? "rgba(255, 82, 120, 1)" : "rgba(255,255,255,0.98)", width: activeHandle ? 3 : 2 }}
          clipShape={{ type: "rect", cornerRadius: 4 }}
        />
        <VStack frame={{ width: cropDistances.width, height: cropDistances.height }} spacing={0}>
          <CenteredEdgeHandle handle="top" />
          <Spacer />
          <CenteredEdgeHandle handle="bottom" />
        </VStack>
        <HStack frame={{ width: cropDistances.width, height: cropDistances.height }} spacing={0}>
          <CenteredEdgeHandle handle="left" />
          <Spacer />
          <CenteredEdgeHandle handle="right" />
        </HStack>
        <VStack frame={{ width: cropDistances.width, height: cropDistances.height }} spacing={0}>
          <HStack frame={{ width: cropDistances.width }} spacing={0}>
            <CropHandleView handle="topLeft" />
            <Spacer />
            <CropHandleView handle="topRight" />
          </HStack>
          <Spacer />
          <HStack frame={{ width: cropDistances.width }} spacing={0}>
            <CropHandleView handle="bottomLeft" />
            <Spacer />
            <CropHandleView handle="bottomRight" />
          </HStack>
        </VStack>
      </ZStack>
    )
  }

  function CropOverlay() {
    return (
      <VStack frame={{ width: previewSize.width, height: previewSize.height }} spacing={0} alignment="leading">
        <VStack frame={{ width: previewSize.width, height: cropDistances.top }} />
        <HStack frame={{ width: previewSize.width, height: cropDistances.height }} spacing={0} alignment="top">
          <VStack frame={{ width: cropDistances.left, height: cropDistances.height }} />
          <CropBox />
          <VStack frame={{ width: cropDistances.right, height: cropDistances.height }} />
        </HStack>
        <VStack frame={{ width: previewSize.width, height: cropDistances.bottom }} />
      </VStack>
    )
  }

  return (
    <Section
      header={<Text>照片 {props.index + 1} · 显示区域</Text>}
      footer={<Text>像 iOS 原生照片裁剪一样，按住白色裁剪框的四边或四角拖动；拖四边时对边固定，拖四角时同时调整相邻两边。当前：{cropDescription(crop)}</Text>}
    >
      <VStack spacing={10} alignment="center">
        <ZStack
          frame={{ width: previewSize.width, height: previewSize.height }}
          clipShape={{ type: "rect", cornerRadius: 18 }}
          background="rgba(118, 118, 128, 0.10)"
          onDragGesture={{
            minDistance: 1,
            coordinateSpace: "local",
            onChanged: (action: DragGestureDetails) => {
              let session = dragSessionRef.current
              if (!session) {
                const handle = selectCropHandleFromPoint(action.startLocation, latestCropRef.current, previewSize)
                if (!handle) return
                beginHandleDrag(handle)
                session = dragSessionRef.current
              }
              if (!session) return
              const nextCrop = resizeCropFromHandle(session.origin, session.handle, action.translation, previewSize)
              latestCropRef.current = nextCrop
              setDraftCrop(nextCrop)
            },
            onEnded: () => {
              commitCrop(latestCropRef.current)
              dragSessionRef.current = null
              setActiveHandle(null)
            },
          }}
          contentShape={{ type: "rect", cornerRadius: 18 }}
        >
          <Image
            filePath={props.path}
            resizable
            scaleToFill
            frame={{ width: previewSize.width, height: previewSize.height }}
            clipped
          />
          <VStack
            frame={{ width: previewSize.width, height: previewSize.height }}
            background="rgba(0,0,0,0.30)"
          />
          <CropOverlay />
        </ZStack>
        <Text font={12} foregroundStyle="rgba(142, 142, 147, 1)">
          四边可单独拖动且对边固定；四角可同时拖动相邻两边来调整显示范围。
        </Text>
      </VStack>
      <Button title="恢复整张照片" action={resetCrop} />
      {props.onClose ? <Button title="锁定显示区域" action={closeEditor} /> : null}
    </Section>
  )
}

function PhotoDetailPage(props: {
  path: string
  index: number
  selected: boolean
  crop: PhotoCrop
  onChanged: (crop: PhotoCrop) => void
  onReset: () => void
  onSetSelected: () => void
  onReplace: () => Promise<void>
  onDelete: () => void
}) {
  const dismiss = Navigation.useDismiss()
  const previewSize = fullScreenPreviewSizeForPhoto(props.path)

  async function replaceAndClose() {
    await props.onReplace()
    dismiss()
  }

  function deleteAndClose() {
    props.onDelete()
    dismiss()
  }

  return (
    <List
      navigationTitle={`照片 ${props.index + 1}`}
      navigationBarTitleDisplayMode="inline"
    >
      <PhotoCropEditor
        path={props.path}
        index={props.index}
        crop={props.crop}
        previewSize={previewSize}
        onChanged={props.onChanged}
        onReset={props.onReset}
      />
      <Section
        header={<Text>照片操作</Text>}
        footer={<Text>按住显示框的四边或四角拖动，即可像 iOS 照片裁剪一样调整 Widget 显示范围；拖四边时对边固定，拖四角时同时调整两条边。这里的预览比列表内更大，便于精确拖拽。</Text>}
      >
        <Button title={props.selected ? "已设为小组件照片" : "设为小组件照片"} action={props.onSetSelected} />
        <Button title="替换照片" action={replaceAndClose} />
        <Button title="删除照片" role="destructive" action={deleteAndClose} />
      </Section>
    </List>
  )
}

function SettingsView() {
  const dismiss = Navigation.useDismiss()
  const [settings, setSettings] = useState<LoveSettings>(() => ensurePhotoHashes(readSettings()))

  function update(next: LoveSettings) {
    setSettings(next)
    saveSettings(next)
  }

  async function handleAddPhotos() {
    const next = await addPhotos(settings)
    update(next)
  }

  function updatePhotoCrop(index: number, crop: PhotoCrop) {
    const path = settings.photos[index]
    if (!path) return
    update({
      ...settings,
      photoCrops: {
        ...settings.photoCrops,
        [path]: normalizedCrop(crop),
      },
    })
  }

  function resetPhotoCrop(index: number) {
    const path = settings.photos[index]
    if (!path) return
    update({
      ...settings,
      photoCrops: {
        ...settings.photoCrops,
        [path]: normalizedCrop(),
      },
    })
  }

  async function handleReplacePhoto(index: number) {
    const next = await replacePhoto(settings, index)
    if (next) update(next)
  }

  function handleDeletePhoto(index: number) {
    update(deletePhoto(settings, index))
  }

  function deleteDayReminder(id: string) {
    update({
      ...settings,
      dayReminders: settings.dayReminders.filter(item => item.id !== id),
    })
  }

  function setDayReminder(id: string, patch: Partial<DayReminder>) {
    update({
      ...settings,
      dayReminders: settings.dayReminders.map(item =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    })
  }

  function toggleDayReminderDisabled(id: string) {
    const target = settings.dayReminders.find(item => item.id === id)
    setDayReminder(id, { disabled: !target?.disabled })
  }

  function deleteSpecialDate(id: string) {
    update({
      ...settings,
      specialDates: settings.specialDates.filter(item => item.id !== id),
    })
  }

  function setSpecialDate(id: string, patch: Partial<SpecialDate>) {
    update({
      ...settings,
      specialDates: settings.specialDates.map(item =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    })
  }

  function toggleSpecialDateDisabled(id: string) {
    const target = settings.specialDates.find(item => item.id === id)
    setSpecialDate(id, { disabled: !target?.disabled })
  }

  function toggleQixiDisabled() {
    update({
      ...settings,
      qixiDisabled: !settings.qixiDisabled,
    })
  }

  function addDayReminder() {
    update({
      ...settings,
      dayReminders: [
        ...settings.dayReminders,
        { id: `day-${Date.now()}`, name: "新的纪念数字", days: 520 },
      ],
    })
  }

  function addSpecialDate() {
    update({
      ...settings,
      specialDates: [
        ...settings.specialDates,
        {
          id: `special-${Date.now()}`,
          name: "新的特定日子",
          month: new Date().getMonth() + 1,
          day: new Date().getDate(),
        },
      ],
    })
  }

  function SettingIcon(props: { systemName: string }) {
    return (
      <Image
        systemName={props.systemName}
        frame={{ width: 22, height: 22 }}
        foregroundStyle="rgba(255, 82, 120, 1)"
      />
    )
  }

  function AddRowButton(props: { title: string; icon: string; action: () => void }) {
    return (
      <Button action={props.action}>
        <HStack>
          <SettingIcon systemName={props.icon} />
          <Text>{props.title}</Text>
          <Spacer />
        </HStack>
      </Button>
    )
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="恋爱纪念"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <Button title="完成" action={dismiss} /> }}
      >
        <Section
          header={<Text>Widget 照片</Text>}
          footer={<Text>照片会先压缩后保存，降低小组件内存占用。随机切换和顺序切换都会先按添加顺序显示前三张；点击小组件照片时，当前三张仍按界面里的顺序往前切换，补进来的第 4 张会按所选方式决定：顺序切换补下一张，随机切换则从未显示的照片中随机补一张。</Text>}
        >
          {settings.photos.length > 0 ? (
            settings.photos.length > 12 ? (
              <ScrollView
                axes="horizontal"
                scrollIndicator="hidden"
                scrollTargetBehavior="viewAlignedLimitAlwaysByOne"
              >
                <VStack spacing={12} alignment="leading">
                  <LazyHStack spacing={12} scrollTargetLayout>
                    {settings.photos.slice(0, Math.ceil(settings.photos.length / 2)).map((path, index) => (
                      <NavigationLink
                        key={path}
                        destination={
                          <PhotoDetailPage
                            path={path}
                            index={index}
                            selected={settings.selectedPhotoIndex === index}
                            crop={settings.photoCrops[path] ?? normalizedCrop()}
                            onChanged={crop => updatePhotoCrop(index, crop)}
                            onReset={() => resetPhotoCrop(index)}
                            onSetSelected={() => update({ ...settings, selectedPhotoIndex: index, photoDisplayMode: "single", photoStackIndices: [] })}
                            onReplace={() => handleReplacePhoto(index)}
                            onDelete={() => handleDeletePhoto(index)}
                          />
                        }
                      >
                        <PhotoThumb
                          index={index}
                          path={path}
                          selected={settings.selectedPhotoIndex === index}
                        />
                      </NavigationLink>
                    ))}
                  </LazyHStack>
                  <LazyHStack spacing={12} scrollTargetLayout>
                    {settings.photos.slice(Math.ceil(settings.photos.length / 2)).map((path, index) => (
                      <NavigationLink
                        key={path}
                        destination={
                          <PhotoDetailPage
                            path={path}
                            index={Math.ceil(settings.photos.length / 2) + index}
                            selected={settings.selectedPhotoIndex === Math.ceil(settings.photos.length / 2) + index}
                            crop={settings.photoCrops[path] ?? normalizedCrop()}
                            onChanged={crop => updatePhotoCrop(Math.ceil(settings.photos.length / 2) + index, crop)}
                            onReset={() => resetPhotoCrop(Math.ceil(settings.photos.length / 2) + index)}
                            onSetSelected={() => update({ ...settings, selectedPhotoIndex: Math.ceil(settings.photos.length / 2) + index, photoDisplayMode: "single", photoStackIndices: [] })}
                            onReplace={() => handleReplacePhoto(Math.ceil(settings.photos.length / 2) + index)}
                            onDelete={() => handleDeletePhoto(Math.ceil(settings.photos.length / 2) + index)}
                          />
                        }
                      >
                        <PhotoThumb
                          index={Math.ceil(settings.photos.length / 2) + index}
                          path={path}
                          selected={settings.selectedPhotoIndex === Math.ceil(settings.photos.length / 2) + index}
                        />
                      </NavigationLink>
                    ))}
                  </LazyHStack>
                </VStack>
              </ScrollView>
            ) : (
              <ScrollView
                axes="horizontal"
                scrollIndicator="hidden"
                scrollTargetBehavior="viewAlignedLimitAlwaysByOne"
              >
                <LazyHStack spacing={12} scrollTargetLayout>
                  {settings.photos.map((path, index) => (
                    <NavigationLink
                      key={path}
                      destination={
                        <PhotoDetailPage
                          path={path}
                          index={index}
                          selected={settings.selectedPhotoIndex === index}
                          crop={settings.photoCrops[path] ?? normalizedCrop()}
                          onChanged={crop => updatePhotoCrop(index, crop)}
                          onReset={() => resetPhotoCrop(index)}
                          onSetSelected={() => update({ ...settings, selectedPhotoIndex: index, photoDisplayMode: "single", photoStackIndices: [] })}
                          onReplace={() => handleReplacePhoto(index)}
                          onDelete={() => handleDeletePhoto(index)}
                        />
                      }
                    >
                      <PhotoThumb
                        index={index}
                        path={path}
                        selected={settings.selectedPhotoIndex === index}
                      />
                    </NavigationLink>
                  ))}
                </LazyHStack>
              </ScrollView>
            )
          ) : (
            <Text foregroundStyle="rgba(142, 142, 147, 1)">还没有照片，添加后可在这里左滑浏览。</Text>
          )}
          <Button action={handleAddPhotos}>
            <HStack>
              <Image systemName="photo.badge.plus" frame={{ width: 22, height: 22 }} foregroundStyle="rgba(255, 82, 120, 1)" />
              <Text>添加照片</Text>
              <Spacer />
              <Text foregroundStyle="rgba(142, 142, 147, 1)">{settings.photos.length} 张</Text>
            </HStack>
          </Button>
          <Picker
            title="Widget 显示照片方式"
            value={settings.photoDisplayMode}
            onChanged={(value: string) => update({
              ...settings,
              photoDisplayMode: value as PhotoDisplayMode,
              selectedPhotoIndex: value === "single" ? settings.selectedPhotoIndex : 0,
              photoStackIndices: [],
            })}
          >
            <Text tag="random">随机切换</Text>
            <Text tag="sequence">顺序切换</Text>
            <Text tag="single">固定</Text>
          </Picker>
        </Section>

        <Section title="个性化">
          <HStack alignment="center">
            <SettingIcon systemName="heart.text.square" />
            <Text>Emoji</Text>
            <Spacer />
            <TextField
              multilineTextAlignment="trailing"
              title=""
              prompt="例如 💗"
              value={settings.emoji}
              onChanged={value => update({ ...settings, emoji: clampEmojiInput(value) })}
            />
          </HStack>
        </Section>

        <Section title="相恋日期">
          <HStack>
            <SettingIcon systemName="heart.text.square" />
            <DatePicker
              title="相恋日期"
              displayedComponents={["date"]}
              value={new Date(`${settings.startDate}T00:00:00`).getTime()}
              onChanged={value => update({ ...settings, startDate: dateStringFromTimestamp(value) })}
            />
          </HStack>
        </Section>

        <Section
          header={<Text>心动数字</Text>}
          footer={<Text>给每个特殊数字加上名称，备注它代表的意义；禁用后不会在 Widget 中显示或参与倒计时。</Text>}
        >
          <DisclosureGroup
            label={
              <HStack>
                <SettingIcon systemName="number.circle" />
                <Text>心动数字</Text>
              </HStack>
            }
          >
            {settings.dayReminders.map(item => (
              <HStack
                key={item.id}
                opacity={item.disabled ? 0.45 : 1}
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [
                    <Button
                      title={item.disabled ? "启用" : "禁用"}
                      action={() => toggleDayReminderDisabled(item.id)}
                    />,
                    <Button
                      title="删除"
                      role="destructive"
                      action={() => deleteDayReminder(item.id)}
                    />,
                  ],
                }}
              >
                <SettingIcon systemName={item.disabled ? "bell.slash" : "bell.badge"} />
                <TextField
                  title=""
                  prompt="名称"
                  value={item.name}
                  onChanged={value => setDayReminder(item.id, { name: value })}
                />
                <Spacer />
                <TextField
                  multilineTextAlignment="trailing"
                  title=""
                  prompt="例如 1314"
                  value={String(item.days)}
                  onChanged={value => setDayReminder(item.id, {
                    days: sanitizePositiveInteger(value, item.days || 1),
                  })}
                />
                <Text>天</Text>
              </HStack>
            ))}
            <AddRowButton title="新增心动数字" icon="plus.circle" action={addDayReminder} />
          </DisclosureGroup>
        </Section>

        <Section
          header={<Text>每年的特定日子</Text>}
          footer={<Text>系统日期选择器必须带年份；这里会自动用当前年份展示，保存时只记录你选择的月和日。比如 2025 年选 2025 年 5 月 20 日，到了 2026 年这里会显示为 2026 年 5 月 20 日，Widget 也会按当年的日期倒计时。</Text>}
        >
          <HStack
            opacity={settings.qixiDisabled ? 0.45 : 1}
            trailingSwipeActions={{
              allowsFullSwipe: false,
              actions: [
                <Button
                  title={settings.qixiDisabled ? "启用" : "禁用"}
                  action={toggleQixiDisabled}
                />,
              ],
            }}
          >
            <SettingIcon systemName={settings.qixiDisabled ? "clock.badge.xmark" : "clock.badge.checkmark.fill"} />
            <Text>七夕节</Text>
            <Spacer />
            <Text foregroundStyle="rgba(142, 142, 147, 1)">农历七月初七</Text>
          </HStack>
          {settings.specialDates.map(item => (
            <DatePicker
              key={item.id}
              displayedComponents={["date"]}
              value={currentAnnualDateTimestamp(item.month, item.day)}
              onChanged={value => {
                const nextDate = monthDayFromTimestamp(value)
                setSpecialDate(item.id, nextDate)
              }}
              opacity={item.disabled ? 0.45 : 1}
              trailingSwipeActions={{
                allowsFullSwipe: false,
                actions: [
                  <Button
                    title={item.disabled ? "启用" : "禁用"}
                    action={() => toggleSpecialDateDisabled(item.id)}
                  />,
                  <Button
                    title="删除"
                    role="destructive"
                    action={() => deleteSpecialDate(item.id)}
                  />,
                ],
              }}
            >
              <HStack>
                <SettingIcon systemName={item.disabled ? "clock.badge.xmark" : "clock.badge.checkmark.fill"} />
                <TextField
                  title=""
                  value={item.name}
                  onChanged={value => setSpecialDate(item.id, { name: value })}
                />
              </HStack>
            </DatePicker>
          ))}
          <AddRowButton title="新增特定日子" icon="plus.circle" action={addSpecialDate} />
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<SettingsView />)
  Script.exit()
}

run()
