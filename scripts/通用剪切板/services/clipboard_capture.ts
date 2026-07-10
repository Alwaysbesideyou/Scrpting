import type { CaptureResult, CaisSettings, MonitorStatus, ClipPayload } from "../types"
import { addClipFromPayload } from "../storage/clip_repository"
import { currentChangeCount, readPasteboardPayload } from "./pasteboard_adapter"
import { isRemoteSyncConfigured, uploadCurrentClipboardToRemote } from "./sync_clipboard"

export type MonitorListener = (status: MonitorStatus) => void
type MonitorOptions = {
  skipInitialCapture?: boolean
  shouldSkipPayload?: (payload: ClipPayload) => string | false | null | undefined | Promise<string | false | null | undefined>
  /**
   * 采集成功后立即使用“当前剪切板”API 推送到远端：
   *   PUT /SyncClipboard.json
   * 图片会先 PUT /file/{dataName}，再 PUT /SyncClipboard.json。
   * 不会写入远端历史 POST /api/history。
   */
  uploadCurrentToRemote?: boolean
}

let monitorTimer: any = null
let monitorActive = false
let lastChangeCount = -1
let lastMessage = "未启动"
let lastStatus: MonitorStatus = { active: false, lastMessage }
let capturedCount = 0
const listeners = new Set<MonitorListener>()

function emit(status: MonitorStatus) {
  lastStatus = status.active ? { ...status, capturedCount } : status
  for (const listener of listeners) listener(lastStatus)
}

function imageUploadData(image: UIImage | undefined): { data: Data; mimeType: string; name: string } | null {
  if (!image) return null
  const now = Date.now()
  if (typeof image.toPNGData === "function") {
    const data = image.toPNGData()
    if (data) return { data, mimeType: "image/png", name: `clipboard-${now}.png` }
  }
  if (typeof image.toJPEGData === "function") {
    const data = image.toJPEGData(0.9)
    if (data) return { data, mimeType: "image/jpeg", name: `clipboard-${now}.jpg` }
  }
  const dataClass = (globalThis as any).Data
  if (typeof dataClass?.fromPNG === "function") {
    const data = dataClass.fromPNG(image)
    if (data) return { data, mimeType: "image/png", name: `clipboard-${now}.png` }
  }
  if (typeof dataClass?.fromJPEG === "function") {
    const data = dataClass.fromJPEG(image, 0.9)
    if (data) return { data, mimeType: "image/jpeg", name: `clipboard-${now}.jpg` }
  }
  return null
}

function dataSize(data: any): number {
  return Number(data?.size ?? data?.length ?? data?.byteLength ?? 0) || 0
}

async function uploadCapturedPayloadAsCurrentClipboard(settings: CaisSettings, payload: ClipPayload): Promise<void> {
  const sync = settings.syncClipboard
  if (!isRemoteSyncConfigured(sync)) return
  if (!sync.autoUpload) return

  try {
    if (payload.kind === "image") {
      if (!sync.uploadSingleFile) return
      const upload = imageUploadData(payload.image)
      if (!upload) return
      const maxBytes = Math.max(0, Number(sync.maxUploadFileSizeMb) || 0) * 1024 * 1024
      if (maxBytes > 0 && dataSize(upload.data) > maxBytes) return
      await uploadCurrentClipboardToRemote(sync, {
        type: "Image",
        text: upload.name,
        data: upload.data,
        dataName: upload.name,
        dataMimeType: upload.mimeType,
      })
      return
    }

    if (!sync.uploadText) return
    const text = payload.kind === "url" ? (payload.url ?? payload.text ?? "") : (payload.text ?? "")
    if (!String(text).trim()) return
    await uploadCurrentClipboardToRemote(sync, { type: "Text", text })
  } catch (error) {
    console.error("[CAIS][ClipboardCapture] 上传当前剪切板失败", error)
  }
}

export async function captureCurrentClipboard(settings: CaisSettings, options: Pick<MonitorOptions, "shouldSkipPayload" | "uploadCurrentToRemote"> = {}): Promise<CaptureResult> {
  const payload = await readPasteboardPayload()
  if (!payload) return { status: "skipped", reason: "没有可采集内容" }
  const skipReason = await options.shouldSkipPayload?.(payload)
  if (skipReason) return { status: "skipped", reason: skipReason }
  const result = await addClipFromPayload(payload, settings)
  if ((result.status === "created" || result.status === "updated") && options.uploadCurrentToRemote) {
    await uploadCapturedPayloadAsCurrentClipboard(settings, payload)
  }
  return result
}

export function stopClipboardMonitor(): void {
  const previousListeners = Array.from(listeners)
  monitorActive = false
  listeners.clear()
  if (monitorTimer) {
    clearTimeout(monitorTimer)
    monitorTimer = null
  }
  lastMessage = "监听已停止"
  capturedCount = 0
  lastStatus = { active: false, lastMessage, lastCheckedAt: Date.now() }
  for (const previousListener of previousListeners) previousListener(lastStatus)
}

export function startClipboardMonitor(settings: CaisSettings, listener?: MonitorListener, options: MonitorOptions = {}): () => void {
  if (listener) listeners.add(listener)
  if (monitorActive) {
    if (listener) listener(lastStatus)
    return () => {
      if (listener) listeners.delete(listener)
    }
  }
  monitorActive = true
  lastMessage = "监听中"
  capturedCount = 0
  emit({ active: true, lastMessage, lastCheckedAt: Date.now() })
  let skipInitialCapture = Boolean(options.skipInitialCapture)
  let firstTick = true

  const tick = async () => {
    if (!monitorActive) return
    const now = Date.now()
    try {
      const current = await currentChangeCount()
      if (skipInitialCapture && firstTick) {
        firstTick = false
        lastChangeCount = current
        emit({ active: true, lastMessage, lastCheckedAt: now })
        return
      }
      firstTick = false
      if (current !== lastChangeCount) {
        lastChangeCount = current
        const result = await captureCurrentClipboard(settings, {
          shouldSkipPayload: options.shouldSkipPayload,
          uploadCurrentToRemote: options.uploadCurrentToRemote,
        })
        lastMessage =
          result.status === "created" ? `已采集：${result.item.title}` :
          result.status === "updated" ? `已更新：${result.item.title}` :
          result.reason
        if (result.status === "created" || result.status === "updated") {
          capturedCount += 1
        }
        emit({
          active: true,
          lastMessage,
          lastCheckedAt: now,
          lastCapturedAt: result.status === "created" || result.status === "updated" ? now : undefined,
        })
      } else {
        emit({ active: true, lastMessage, lastCheckedAt: now })
      }
    } catch (error: any) {
      lastMessage = String(error?.message ?? error ?? "监听失败")
      emit({ active: true, lastMessage, lastCheckedAt: now })
    } finally {
      if (monitorActive) {
        monitorTimer = setTimeout(tick, settings.monitorIntervalMs)
      }
    }
  }

  monitorTimer = setTimeout(tick, 100)
  return () => {
    if (listener) listeners.delete(listener)
    if (!listeners.size) stopClipboardMonitor()
  }
}
