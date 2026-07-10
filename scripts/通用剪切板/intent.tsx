/**
 * intent.tsx — 快捷指令入口：将传入的文本或文件推送为远程当前剪切板。
 *
 * ## 调用方式（快捷指令）
 * 1. 在快捷指令中添加「文本」或「文件」action。
 * 2. 添加「运行 Scripting 脚本」action，选择 CAIS 脚本。
 * 3. 快捷指令会收到返回值（文本）：
 *    - `OK` — 推送成功。
 *    - `跳过: <原因>` — 配置不满足，未执行上传。
 *    - `失败: <错误信息>` — 网络或其他错误。
 *
 * ## 参数格式
 * - 文本：通过 textsParameter 或 shortcutParameter (type="text") 传入。
 * - 文件：通过 fileURLsParameter 传入文件路径数组（需在 Intent Settings 中启用 FileURLs）。
 * - 脚本会自动判断类型：有文件时上传文件，否则上传文本。
 */

import { Intent, Script } from "scripting"
import { loadSettingsFromDB } from "./storage/settings_store"
import { uploadCurrentClipboardToRemote, isRemoteSyncConfigured } from "./services/sync_clipboard"

function getMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || ""
  const mimeMap: Record<string, string> = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "heic": "image/heic",
    "heif": "image/heif",
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "zip": "application/zip",
    "rar": "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "txt": "text/plain",
    "json": "application/json",
    "xml": "application/xml",
    "html": "text/html",
    "css": "text/css",
    "js": "application/javascript",
    "ts": "application/typescript",
  }
  return mimeMap[ext] || "application/octet-stream"
}

async function run() {
  // 1. 检查是否传入了文件
  const fileURLs = Intent.fileURLsParameter
  let inputFilePath: string | undefined
  let inputFileName: string | undefined
  
  if (Array.isArray(fileURLs) && fileURLs.length > 0) {
    inputFilePath = fileURLs[0]
    // 从路径中提取文件名
    inputFileName = inputFilePath.split("/").pop() || "file"
  }

  // 2. 如果没有文件，检查文本
  let inputText: string | undefined
  if (!inputFilePath) {
    const texts = Intent.textsParameter
    if (Array.isArray(texts) && texts.length > 0) {
      inputText = texts[0]
    } else {
      const sp = Intent.shortcutParameter
      if (sp && sp.type === "text" && typeof sp.value === "string") {
        inputText = sp.value
      }
    }
  }

  // 3. 检查是否有输入
  if (!inputFilePath && (!inputText || inputText.trim() === "")) {
    Script.exit(Intent.text("跳过: 未传入文本或文件"))
    return
  }

  // 4. 读取同步设置
  let settings
  try {
    settings = await loadSettingsFromDB()
  } catch (error: any) {
    Script.exit(Intent.text(`失败: 读取设置出错 - ${String(error?.message ?? error)}`))
    return
  }

  const sync = settings.syncClipboard

  // 5. 检查是否已配置并启用远程同步
  if (!isRemoteSyncConfigured(sync)) {
    Script.exit(Intent.text("跳过: 未启用远程同步或未配置服务器地址，请在 CAIS 设置中配置"))
    return
  }

  // 6. 上传文件或文本
  let result
  if (inputFilePath) {
    // 上传文件
    const fm = (globalThis as any).FileManager
    if (!fm) {
      Script.exit(Intent.text("失败: 无法访问文件系统"))
      return
    }
    
    // 检查文件是否存在
    const exists = typeof fm.exists === "function"
      ? await fm.exists(inputFilePath)
      : (typeof fm.existsSync === "function" ? fm.existsSync(inputFilePath) : false)
    
    if (!exists) {
      Script.exit(Intent.text(`失败: 文件不存在 - ${inputFilePath}`))
      return
    }
    
    // 读取文件数据
    const data = typeof fm.readAsData === "function"
      ? await fm.readAsData(inputFilePath)
      : null
    
    if (!data) {
      Script.exit(Intent.text("失败: 无法读取文件数据"))
      return
    }
    
    // 检查文件大小
    const size = Number(data?.size ?? data?.length ?? data?.byteLength ?? 0) || 0
    const maxBytes = (sync.maxUploadFileSizeMb || 20) * 1024 * 1024
    if (size > maxBytes) {
      Script.exit(Intent.text(`失败: 文件大小 ${formatBytes(size)} 超过限制 ${sync.maxUploadFileSizeMb}MB`))
      return
    }
    
    // 获取 MIME 类型
    const mimeType = typeof fm.mimeType === "function"
      ? fm.mimeType(inputFilePath)
      : getMimeType(inputFileName || "")
    
    // 上传
    result = await uploadCurrentClipboardToRemote(sync, {
      type: "File",
      text: inputFileName || "file",
      data: data,
      dataName: inputFileName || "file",
      dataMimeType: mimeType,
    })
  } else {
    // 上传文本
    result = await uploadCurrentClipboardToRemote(sync, {
      type: "Text",
      text: inputText!,
    })
  }

  // 7. 返回结果
  if (result.status === "ok") {
    const type = inputFilePath ? "文件" : "文本"
    Script.exit(Intent.text(`OK: ${type}上传成功`))
  } else if (result.status === "skipped") {
    Script.exit(Intent.text(`跳过: ${result.reason}`))
  } else {
    Script.exit(Intent.text(`失败: ${result.message}`))
  }
}

function formatBytes(size: number): string {
  if (!size || size <= 0) return "0 B"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

void run()