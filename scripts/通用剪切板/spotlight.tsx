import { Script } from "scripting"
import { getClipById, getFullClipContent, markCopied } from "./storage/clip_repository"
import { writeClipToPasteboard } from "./services/pasteboard_adapter"
import { clipIdFromSpotlightId, rebuildSpotlightIndex, spotlightItemForClip } from "./services/spotlight_index"

async function run() {
  const current = Spotlight.current
  if (!current) {
    const count = await rebuildSpotlightIndex()
    Script.exit(`已索引 ${count} 条剪切板内容`)
    return
  }

  const clipId = String(current.parameters?.clipId ?? clipIdFromSpotlightId(current.id))
  const item = await getClipById(clipId)
  if (!item) {
    await Spotlight.delete(current.id)
    Script.exit("这条剪切板内容已不存在")
    return
  }

  const fullContent = await getFullClipContent(item.id)
  await writeClipToPasteboard(item, fullContent)
  await markCopied(item)
  await Spotlight.index(spotlightItemForClip({ ...item, lastCopiedAt: Date.now() }))
  Script.exit("已复制到剪切板")
}

void run()
