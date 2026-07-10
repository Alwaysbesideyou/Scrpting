import {
  Button,
  Capsule,
  EmptyView,
  Editor,
  ForEach,
  Form,
  Group,
  HStack,
  Image,
  List,
  Menu,
  Navigation,
  NavigationLink,
  NavigationStack,
  Picker,
  ScrollView,
  Section,
  Script,
  Spacer,
  Tab,
  TabView,
  Text,
  TextField,
  Toggle,
  useColorScheme,
  useEffect,
  useObservable,
  useRef,
  useState,
  VStack,
  ZStack,
} from "scripting"

import type { AIAssistant, AISettings, CaisSettings, ClipboardClearRange, ClipGroup, ClipItem, ClipPayload, KeyboardCustomAction, KeyboardMenuBuiltinAction, MonitorStatus, RemoteClipItem } from "../types"
import { DEFAULT_AI_SETTINGS } from "../types"
import { captureCurrentClipboard, startClipboardMonitor, stopClipboardMonitor } from "../services/clipboard_capture"
import { rebuildSpotlightIndex } from "../services/spotlight_index"
import { currentChangeCount, writeClipToPasteboard, writeImageToPasteboard, writeTextToPasteboard } from "../services/pasteboard_adapter"
import {
  clearRemoteHistory,
  deleteRemoteRecord,
  downloadRemoteData,
  getRemoteStatistics,
  isAlreadyUploaded,
  isRemoteSyncConfigured,
  loadUploadedKeys,
  makeRemoteFileProfileId,
  makeRemoteTextProfileId,
  markUploaded,
  patchRemoteRecord,
  queryRemoteHistory,
  remoteItemContent,
  uploadCurrentClipboardToRemote,
  uploadLocalToRemote,
} from "../services/sync_clipboard"
import {
  addClipFromPayload,
  clearClipboardClipsByRange,
  clearAllClipboardClips,
  clearFavoriteClips,
  deleteClipboardTextClipsByContent,
  editClipContent,
  getClipGroups,
  getFullClipContent,
  markCopied,
  softDeleteClip,
  toggleFavorite,
  togglePinned,
  updateClipTitle,
  addFavoriteFromInput,
} from "../storage/clip_repository"
import { initializeDatabase, findTextClipsByContent } from "../storage/database"
import { imageDirectory, filesDirectory, ensureAppDirectories, thumbnailPathForImagePath } from "../storage/paths"
import { imageContentHash } from "../storage/image_store"
import { readClipDataVersion } from "../storage/change_signal"
import { loadSettings, saveSettings, loadSettingsFromDB } from "../storage/settings_store"
import { loadRemoteClipCache, saveRemoteClipCache } from "../storage/remote_clip_cache"
import { formatDateTime, isLikelyURL, normalizeClipContent, withHaptic } from "../utils/common"
import { renderRuntimeTemplate } from "../utils/template"
import {
  createMemoId,
  DEFAULT_MEMO_GROUP_COLOR,
  DEFAULT_MEMO_GROUP_LINE_STYLE,
  KeyboardMemoGroup,
  KeyboardMemoItem,
  MEMO_GROUP_COLORS,
  memoSubfields,
  memoTitle,
  memoUpdatedFooter,
  normalizeMemoSortOrders,
  readKeyboardMemos,
  renderMemoOutput,
  reorderedItems,
  sortedMemoGroups,
  sortedMemos,
  writeKeyboardMemos,
  loadMemoGroupsFromDB,
} from "../utils/memos"
import { readAppFullscreen, writeAppFullscreen } from "../utils/window_state"
import { ClipboardCard, ClipRow } from "./ClipRow"
import { PipStatusView } from "./PipStatusView"
import { FavoritePage } from "../pages/FavoritePage"
import { NetworkPage } from "../pages/NetworkPage"
import { MemosPage } from "../pages/MemosPage"
import { AIPage } from "../pages/AIPage"
import { SettingsPage } from "../pages/SettingsPage"
import { TokenSelectionPanel } from "./TokenSelectionPanel"
import { createAIAssistantId, normalizeAssistantOrders, removeAssistant, reorderAssistants, sortedAssistants, updateAssistant } from "../storage/ai_store"
import { readPipControlState, writePipControlState } from "../services/pip_control"
import { selectedTokenText, tokenizeWords, type CaisToken } from "../utils/tokenize"
import {
  applyBuiltinMenuAction,
  applyCustomMenuAction,
  customActionSystemImage,
  getOrderedMenuBuiltins,
  menuBuiltinSystemImage,
  menuBuiltinTitle,
  type MenuActionResult,
} from "../utils/menu_actions"
import {
  TAB_FAVORITES,
  TAB_CLIPS,
  TAB_NETWORK,
  TAB_MEMOS,
  TAB_AI,
  TAB_SETTINGS,
  tabTitle,
  tabIcon,
  tabForStartPage,
} from "../utils/tab_config"
import {
  mergeRemoteItems,
  remoteItemTimestamp,
  remoteModifiedAfterForIncrementalSync,
} from "../utils/remote_clip_items"
const APP_GROUP_PAGE_SIZE = 300
const CLIP_PAGE_STEP = 60
const REMOTE_PAGE_STEP = 100
const REMOTE_REFRESH_INTERACTION_GRACE_MS = 900
const TOAST_DURATION_MS = 1200
const CAIS_APP_RESUME_HANDLER = "__CAIS_APP_RESUME_HANDLER__"
const APP_SCROLL_CONTENT_MARGINS = {
  insets: { top: 0, bottom: 0, leading: 0, trailing: 0 },
  placement: "scrollContent" as const,
}
type ClearScope = "favorites" | ClipboardClearRange
type NetworkClipFilter = "all" | "text" | "image" | "file" | "verificationCode" | "link"
type ClipboardSourceFilter = "universal" | "local" | "remote"
type UniversalClipItem =
  | { origin: "local"; key: string; timestamp: number; item: ClipItem }
  | { origin: "remote"; key: string; timestamp: number; item: RemoteClipItem }
type RemoteImageCache = Record<string, { path?: string; previewPath?: string; loading?: boolean; error?: string }>
type BulkSelectionMode = "clips" | "memos"
let intentionalMinimize = false
let appRefreshGeneration = 0
let appMonitorStopper: (() => void) | null = null

function renderClipOutput(item: ClipItem, content: string): string {
  return item.manualFavorite ? renderRuntimeTemplate(content) : content
}

function formatBytes(size: number): string {
  if (!size || size <= 0) return ""
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 从文件名中提取扩展名（不含点号，转为小写）
 */
function getFileExtension(fileName: string | undefined): string {
  if (!fileName) return ""
  const parts = fileName.split(".")
  if (parts.length < 2) return ""
  return parts[parts.length - 1].toLowerCase()
}

/**
 * 检查文件是否通过自动下载过滤规则
 * @returns true 表示允许下载，false 表示阻止下载
 */
function passesFileAutoDownloadFilter(
  fileName: string | undefined,
  filterMode: "disabled" | "whitelist" | "blacklist",
  allowedExtensions: string[]
): boolean {
  if (filterMode === "disabled") return true
  const ext = getFileExtension(fileName)
  if (!ext) return true // 没有扩展名的文件默认允许
  const isInList = allowedExtensions.includes(ext)
  return filterMode === "whitelist" ? isInList : !isInList
}

/**
 * 从 Content-Disposition header 中提取文件名
 * 支持 filename="name.ext" 和 filename*=UTF-8''name.ext 格式
 */
function extractFileNameFromContentDisposition(header: string | undefined): string | undefined {
  if (!header) return undefined
  
  // 尝试 filename*=UTF-8''encoded_name.ext (RFC 5987)
  const utf8Match = header.match(/filename\*=UTF-8''([^;\s]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {}
  }
  
  // 尝试 filename="name.ext"
  const quotedMatch = header.match(/filename="([^"]+)"/i)
  if (quotedMatch?.[1]) return quotedMatch[1]
  
  // 尝试 filename=name.ext (不带引号)
  const unquotedMatch = header.match(/filename=([^;\s]+)/i)
  if (unquotedMatch?.[1]) return unquotedMatch[1]
  
  return undefined
}

/**
 * 根据 MIME 类型推断文件扩展名
 */
function guessExtensionFromMimeType(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined
  const mime = mimeType.toLowerCase().split(';')[0].trim()
  const mimeToExt: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/x-rar-compressed': 'rar',
    'application/x-7z-compressed': '7z',
    'application/gzip': 'gz',
    'application/x-tar': 'tar',
    'application/json': 'json',
    'application/xml': 'xml',
    'application/javascript': 'js',
    'application/typescript': 'ts',
    'text/plain': 'txt',
    'text/html': 'html',
    'text/css': 'css',
    'text/csv': 'csv',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.ms-powerpoint': 'ppt',
  }
  return mimeToExt[mime]
}

function MemoStatusLine(props: { dashed: boolean; color?: string }) {
  const lineFill = (props.color || DEFAULT_MEMO_GROUP_COLOR) as any
  if (props.dashed) {
    return (
      <VStack spacing={4} frame={{ width: 22, height: 32, alignment: "center" as any }}>
        <Capsule fill={lineFill} frame={{ width: 5, height: 7 }} />
        <Capsule fill={lineFill} frame={{ width: 5, height: 7 }} />
        <Capsule fill={lineFill} frame={{ width: 5, height: 7 }} />
      </VStack>
    )
  }
  return (
    <VStack frame={{ width: 22, height: 32, alignment: "center" as any }}>
      <Capsule fill={lineFill} frame={{ width: 5, height: 30 }} />
    </VStack>
  )
}

function MemoGroupDot(props: { color?: string }) {
  return (
    <Capsule
      fill={(props.color || DEFAULT_MEMO_GROUP_COLOR) as any}
      frame={{ width: 10, height: 10 }}
    />
  )
}

function EmptyState(props: {
  title: string
  message: string
  systemImage: string
}) {
  const colorScheme = useColorScheme()
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"

  return (
    <HStack
      frame={{ maxWidth: "infinity", alignment: "center" as any }}
      listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
      listRowSeparator="hidden"
      listRowBackground={<EmptyView />}
    >
      <VStack
        frame={{ maxWidth: "infinity", alignment: "center" as any }}
        padding={{ top: 40, bottom: 40, leading: 16, trailing: 16 }}
        spacing={12}
        background={{ style: cardFill, shape: { type: "rect", cornerRadius: 18 } }}
        shadow={{
          color: colorScheme === "dark" ? "rgba(0,0,0,0.20)" : "rgba(0,0,0,0.07)",
          radius: 10,
          y: 4,
        }}
      >
        <Image systemName={props.systemImage} font="largeTitle" foregroundStyle="secondaryLabel" />
        <Text font="headline">{props.title}</Text>
        <Text foregroundStyle="secondaryLabel" multilineTextAlignment="center">{props.message}</Text>
      </VStack>
    </HStack>
  )
}

function AddFavoriteView() {
  const dismiss = Navigation.useDismiss()
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  return (
    <NavigationStack>
      <Form
        navigationTitle="添加收藏"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        presentationDetents={[0.72, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="取消" role="cancel" action={() => dismiss(null)} />,
          topBarTrailing: <Button title="保存" disabled={!content.trim()} action={() => {
            dismiss({ title, content })
          }} />
        }}
      >
        <Section>
          <TextField title="标题" value={title} prompt="可选，留空则自动生成" onChanged={setTitle} />
        </Section>
        <Section
          header={<Text>内容</Text>}
          footer={<Text>{"可使用 {{text}}、{{date}}、{{time}}、{{datetime}}、{{timestamp}}。"}</Text>}
        >
          <TextField
            title=""
            value={content}
            prompt="输入你想收藏的内容"
            axis="vertical"
            frame={{ minHeight: 120, maxWidth: "infinity", alignment: "topLeading" as any }}
            onChanged={setContent}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}

const MEMO_DATE_TEMPLATES = ["dd/MM/yy", "yyyy-MM-dd", "yyyy/MM/dd", "MM/dd/yyyy", "dd.MM.yyyy", "yyyy年MM月dd日", "HH:mm", "yyyy-MM-dd HH:mm"]

type MemoEditorResult = {
  groupId: string
  kind: "text" | "image"
  title: string
  text: string
  insertPosition: "end" | "start"
  enableSubfields: boolean
}

type MemoGroupEditorResult = {
  title: string
  color: string
}

type MemoGroupDeleteChoice = "groupOnly" | "withMemos"



function MemoGroupEditorView(props: { group?: KeyboardMemoGroup }) {
  const dismiss = Navigation.useDismiss()
  const [title, setTitle] = useState(props.group?.title ?? "")
  const [color, setColor] = useState(props.group?.color ?? DEFAULT_MEMO_GROUP_COLOR)
  function save() {
    const name = title.trim()
    if (!name) return
    dismiss({ title: name, color } as MemoGroupEditorResult)
  }
  return (
    <NavigationStack>
      <Form
        navigationTitle={props.group ? "编辑列表" : "新增列表"}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        toolbar={{
          topBarLeading: <Button title="取消" role="cancel" action={() => dismiss(null)} />,
          topBarTrailing: <Button title="保存" disabled={!title.trim()} action={save} />,
        }}
      >
        <Section>
          <TextField title="名称" value={title} prompt="例如：邮箱、公司、地址" onChanged={setTitle} />
        </Section>
        <Section header={<Text>颜色</Text>}>
          <Picker title="颜色" pickerStyle="menu" value={color} onChanged={(value: any) => setColor(String(value))}>
            {MEMO_GROUP_COLORS.map((item) => <Text key={item} tag={item}>{memoColorLabel(item)}</Text>)}
          </Picker>
        </Section>
      </Form>
    </NavigationStack>
  )
}

function memoColorLabel(color: string): string {
  switch (color) {
    case "systemRed": return "红色"
    case "systemOrange": return "橙色"
    case "systemYellow": return "黄色"
    case "systemGreen": return "绿色"
    case "systemTeal": return "青色"
    case "systemBlue": return "蓝色"
    case "systemIndigo": return "靛蓝"
    case "systemPurple": return "紫色"
    case "systemPink": return "粉色"
    case "secondaryLabel": return "灰色"
    default: return color
  }
}

function MemoEditorView(props: { memo?: KeyboardMemoItem; groups: KeyboardMemoGroup[]; defaultGroupId?: string }) {
  const dismiss = Navigation.useDismiss()
  const initialGroupId = props.defaultGroupId || props.groups[0]?.id || ""
  const [kind, setKind] = useState<"text" | "image">(props.memo?.kind === "image" ? "image" : "text")
  const [groupId, setGroupId] = useState(props.memo ? initialGroupId : initialGroupId)
  const [insertPosition, setInsertPosition] = useState<"end" | "start">(props.memo?.insertPosition === "start" ? "start" : "end")
  const [title, setTitle] = useState(props.memo?.title ?? "")
  const [text, setText] = useState(props.memo?.text ?? "")
  const [enableSubfields, setEnableSubfields] = useState(Boolean(props.memo?.enableSubfields ?? false))
  const [datePickerVisible, setDatePickerVisible] = useState(false)
  const [dateTemplateIndex, setDateTemplateIndex] = useState(0)
  const [memoTextFocusToken, setMemoTextFocusToken] = useState(0)

  function focusMemoTextField() {
    setMemoTextFocusToken((value) => value + 1)
  }

  function appendVariable(value: string) {
    setText((current) => current ? `${current}${value}` : value)
    focusMemoTextField()
  }

  async function createGroup() {
    const name = String(await Dialog.prompt({ title: "新增列表", placeholder: "例如：邮箱、公司、地址", cancelLabel: "取消", confirmLabel: "保存" }) ?? "").trim()
    if (!name) return
    dismiss({ createGroup: name, memo: props.memo, draft: { groupId, kind, title, text, insertPosition, enableSubfields } } as any)
  }

  function save() {
    const fixedText = text.trim()
    if (!fixedText) return
    dismiss({ groupId, kind, title: title.trim(), text: fixedText, insertPosition, enableSubfields } as MemoEditorResult)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle={props.memo ? "编辑 Memo" : "新增 Memo"}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        presentationDetents={[0.82, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="关闭" role="cancel" action={() => dismiss(null)} />,
          topBarTrailing: <Button title="保存" disabled={!text.trim() || !groupId} action={save} />,
        }}
      >
        <Section>
          <Picker title="" pickerStyle="segmented" value={kind} onChanged={(value: any) => setKind(value)}>
            <Text tag="text">文字 Memo</Text>
            <Text tag="image">图片 Memo</Text>
          </Picker>
        </Section>
        <Section header={<HStack frame={{ maxWidth: "infinity", alignment: "trailing" as any }}><Button title="新增列表" systemImage="plus" action={() => void createGroup()} /></HStack>}>
          <Picker title="选择列表" pickerStyle="menu" value={groupId} onChanged={(value: any) => setGroupId(String(value))}>
            {props.groups.map((group) => <Text key={group.id} tag={group.id}>{group.title}</Text>)}
          </Picker>
          <Picker title="添加位置" pickerStyle="menu" value={insertPosition} onChanged={(value: any) => setInsertPosition(value)}>
            <Text tag="end">末行</Text>
            <Text tag="start">首行</Text>
          </Picker>
        </Section>
        <Section>
          <TextField title="标题" value={title} prompt="例如：公司税号" onChanged={setTitle} />
        </Section>
        <Section
          header={<Text>{kind === "image" ? "图片 Memo 说明" : "Memo"}</Text>}
          footer={<Text>{"变量会在键盘粘贴时自动替换：{{CURSOR}} 标记光标位置，{{CLIPBOARD}} 插入当前剪贴板文本，{{DATE:dd/MM/yy}} 插入日期。"}</Text>}
        >
          <VStack
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
            onTapGesture={focusMemoTextField}
          >
            <TextField
              key={`memo-text-${memoTextFocusToken}`}
              title=""
              value={text}
              prompt={kind === "image" ? "先用文字记录图片说明；图片文件选择能力后续可继续接入。" : "输入长期记忆内容"}
              axis="vertical"
              autofocus={memoTextFocusToken > 0}
              frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
              lineLimit={{
                max: 10,
                reservesSpace: true
              }}
              onChanged={setText}
              onFocus={() => { }}
            />
          </VStack>
          <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" as any }} buttonStyle="borderless">
            <Button title="光标" systemImage="cursorarrow" action={() => appendVariable("{{CURSOR}}")} />
            <Spacer />
            <Button title="剪切板" systemImage="doc.on.clipboard" action={() => appendVariable("{{CLIPBOARD}}")} />
            <Spacer />
            <Button title={datePickerVisible ? "确定" : "日期"} systemImage="calendar" action={() => {
              if (datePickerVisible) appendVariable(`{{DATE:${MEMO_DATE_TEMPLATES[dateTemplateIndex] ?? "dd/MM/yy"}}}`)
              setDatePickerVisible(!datePickerVisible)
            }} />
          </HStack>
          {datePickerVisible ? (
            <Picker title="日期模板" pickerStyle="wheel" value={dateTemplateIndex} onChanged={setDateTemplateIndex}>
              {MEMO_DATE_TEMPLATES.map((item, index) => <Text key={item} tag={index}>{item}</Text>)}
            </Picker>
          ) : null}
        </Section>
        <Section footer={<Text>开启后，键盘和主界面长按会按设置里的分隔符识别子字段。</Text>}>
          <Toggle title="识别子字段" value={enableSubfields} onChanged={setEnableSubfields} toggleStyle="switch" />
        </Section>
      </Form>
    </NavigationStack>
  )
}

function MemoListManagerPanel(props: { onChanged?: (groups: KeyboardMemoGroup[]) => void }) {
  const colorScheme = useColorScheme()
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"
  const [groups, setGroups] = useState<KeyboardMemoGroup[]>(() => sortedMemoGroups(readKeyboardMemos()))
  const groupsRef = useRef(groups)

  useEffect(() => {
    groupsRef.current = groups
  }, [groups])

  async function saveGroups(next: KeyboardMemoGroup[]) {
    const normalized = normalizeMemoSortOrders(sortedMemoGroups(next))
    setGroups(normalized)
    groupsRef.current = normalized
    try {
      await writeKeyboardMemos(normalized)
      props.onChanged?.(normalized)
    } catch (error) {
      console.error("Failed to save memo groups:", error)
    }
  }

  async function addGroup() {
    const result = await Navigation.present<MemoGroupEditorResult | null>({
      element: <MemoGroupEditorView />,
      modalPresentationStyle: "pageSheet",
    })
    if (!result) return
    const name = String(result.title ?? "").trim()
    if (!name) return
    const now = Date.now()
    const latestGroups = groupsRef.current
    const group = {
      id: createMemoId(),
      title: name,
      color: result.color || DEFAULT_MEMO_GROUP_COLOR,
      lineStyle: DEFAULT_MEMO_GROUP_LINE_STYLE,
      sortOrder: latestGroups.length,
      createdAt: now,
      updatedAt: now,
      memos: [],
    }
    await saveGroups([...latestGroups, group])
  }

  async function editGroup(group: KeyboardMemoGroup) {
    const result = await Navigation.present<MemoGroupEditorResult | null>({
      element: <MemoGroupEditorView group={group} />,
      modalPresentationStyle: "pageSheet",
    })
    if (!result) return
    const name = String(result.title ?? "").trim()
    if (!name) return
    const now = Date.now()
    const latestGroups = groupsRef.current
    const next = latestGroups.map((item) => item.id === group.id ? {
      ...item,
      title: name,
      color: result.color || DEFAULT_MEMO_GROUP_COLOR,
      updatedAt: now,
    } : item)
    await saveGroups(next)
  }

  async function deleteGroup(group: KeyboardMemoGroup) {
    const latestGroups = groupsRef.current
    const latestGroup = latestGroups.find((item) => item.id === group.id) ?? group
    const memoCount = latestGroup.memos.length
    
    let choice: MemoGroupDeleteChoice | null = null
    
    if (!memoCount) {
      // 没有 memo，直接确认删除
      const confirmed = await Dialog.confirm({
        title: "删除列表？",
        message: `确认删除「${latestGroup.title}」？`,
        cancelLabel: "取消",
        confirmLabel: "删除",
      })
      if (!confirmed) return
      choice = "withMemos"
    } else {
      // 有 memo，弹出选择弹窗
      const actions = [
        { label: "仅删除分组，保留 Memo" },
        { label: "删除分组和所有内容", destructive: true },
      ]
      const actionIndex = await Dialog.actionSheet({
        title: `删除「${latestGroup.title}」？`,
        message: `此列表中有 ${memoCount} 条 Memo，请选择删除方式。`,
        actions,
      })
      if (actionIndex == null) return
      choice = actionIndex === 0 ? "groupOnly" : "withMemos"
    }
    
    const now = Date.now()
    const remaining = latestGroups.filter((item) => item.id !== latestGroup.id)
    if (choice === "groupOnly" && memoCount) {
      const targetGroups = remaining.length ? remaining : [{
        id: createMemoId(),
        title: "默认",
        color: DEFAULT_MEMO_GROUP_COLOR,
        lineStyle: DEFAULT_MEMO_GROUP_LINE_STYLE,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        memos: [],
      }]
      const next = targetGroups.map((item, index) => index === 0 ? {
        ...item,
        updatedAt: now,
        memos: [...item.memos, ...latestGroup.memos].map((memo, i) => ({ ...memo, sortOrder: i })),
      } : item)
      await saveGroups(next)
      return
    }
    await saveGroups(remaining)
  }

  async function reorderGroups(indices: number[], newOffset: number) {
    const reordered = reorderedItems(sortedMemoGroups(groupsRef.current), indices, newOffset)
    const now = Date.now()
    await saveGroups(reordered.map((group, index) => ({ ...group, sortOrder: index, updatedAt: now })))
  }

  async function addMemoToGroup(group: KeyboardMemoGroup) {
    if (!groupsRef.current.length) return
    const result = await Navigation.present<({ groupId: string; kind: string; title: string; text: string; insertPosition: string; enableSubfields: boolean } & { createGroup?: undefined }) | { createGroup: string } | null>({
      element: <MemoEditorView groups={groupsRef.current} defaultGroupId={group.id} />,
      modalPresentationStyle: "pageSheet",
    })
    if (!result) return
    if ((result as any).createGroup) {
      const name = String((result as any).createGroup).trim()
      if (!name) return
      const now = Date.now()
      const newGroup: KeyboardMemoGroup = {
        id: createMemoId(),
        title: name,
        color: DEFAULT_MEMO_GROUP_COLOR,
        lineStyle: DEFAULT_MEMO_GROUP_LINE_STYLE,
        sortOrder: groupsRef.current.length,
        createdAt: now,
        updatedAt: now,
        memos: [],
      }
      await saveGroups([...groupsRef.current, newGroup])
      return
    }
    const payload = result as { groupId: string; kind: string; title: string; text: string; insertPosition: string; enableSubfields: boolean }
    const now = Date.now()
    const targetGroupId = payload.groupId || group.id
    const memoPayload: KeyboardMemoItem = {
      id: createMemoId(),
      kind: payload.kind as any,
      title: payload.title || undefined,
      text: payload.text.trim(),
      insertPosition: payload.insertPosition as any,
      enableSubfields: payload.enableSubfields,
      sortOrder: payload.insertPosition === "start" ? 0 : Number.MAX_SAFE_INTEGER,
      createdAt: now,
      updatedAt: now,
    }
    const next = groupsRef.current.map((g) => {
      if (g.id !== targetGroupId) return g
      const memos = payload.insertPosition === "start" ? [memoPayload, ...g.memos] : [...g.memos, memoPayload]
      return { ...g, updatedAt: now, memos: memos.map((m, i) => ({ ...m, sortOrder: i })) }
    })
    await saveGroups(next)
  }

  async function deleteMemoInGroup(group: KeyboardMemoGroup, memo: KeyboardMemoItem) {
    const ok = await Dialog.confirm({ title: "删除 Memo？", message: memoTitle(memo), cancelLabel: "取消", confirmLabel: "删除" })
    if (!ok) return
    const now = Date.now()
    const next = groupsRef.current.map((g) => g.id === group.id ? {
      ...g,
      updatedAt: now,
      memos: g.memos.filter((m) => m.id !== memo.id),
    } : g)
    await saveGroups(next)
  }

  function renderMemoRowInPanel(group: KeyboardMemoGroup, memo: KeyboardMemoItem) {
    return (
      <HStack
        key={memo.id}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
        listRowSeparator="hidden"
        trailingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            <Button title="" systemImage="trash" tint="systemRed" action={() => void deleteMemoInGroup(group, memo)} />,
          ],
        }}
      >
        <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" as any }} padding={{ top: 10, bottom: 10, leading: 12, trailing: 8 }} background={{ style: cardFill, shape: { type: "rect", cornerRadius: 16 } }}>
          <MemoStatusLine dashed={Boolean(memo.enableSubfields)} color={group.color ?? DEFAULT_MEMO_GROUP_COLOR} />
          <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text font="body" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">{memoTitle(memo)}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">{memoUpdatedFooter(memo)}</Text>
          </VStack>
        </HStack>
      </HStack>
    )
  }

  function renderGroupLink(group: KeyboardMemoGroup) {
    const freshGroup = groupsRef.current.find((g) => g.id === group.id) ?? group
    return (
      <NavigationLink
        key={freshGroup.id}
        destination={(
          <Form
            navigationTitle={freshGroup.title}
            navigationBarTitleDisplayMode="inline"
            formStyle="grouped"
            listRowSpacing={10}
            contentMargins={APP_SCROLL_CONTENT_MARGINS}
            toolbar={{
              topBarTrailing: (
                <HStack spacing={10}>
                  <Button title="编辑" systemImage="paintpalette" action={() => void editGroup(freshGroup)} />
                  <Button title="" systemImage="plus" action={() => void addMemoToGroup(freshGroup)} />
                </HStack>
              ),
            }}
          >
            {freshGroup.memos.length ? (
              <Section listSectionSeparator="hidden">
                <ForEach
                  count={sortedMemos(freshGroup).length}
                  itemBuilder={(index) => renderMemoRowInPanel(freshGroup, sortedMemos(freshGroup)[index])}
                  onMove={(indices, newOffset) => {
                    const reordered = reorderedItems(sortedMemos(freshGroup), indices, newOffset)
                    const now = Date.now()
                    const next = groupsRef.current.map((g) => g.id === freshGroup.id ? {
                      ...g,
                      updatedAt: now,
                      memos: reordered.map((memo, i) => ({ ...memo, sortOrder: i })),
                    } : g)
                    void saveGroups(next)
                  }}
                />
              </Section>
            ) : (
              <EmptyState title="暂无 Memo" message="点击右上角 + 在此列表中新增 Memo。" systemImage="text.badge.plus" />
            )}
          </Form>
        )}
      >
        <HStack spacing={12} padding={{ top: 10, bottom: 10, leading: 4, trailing: 4 }} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <MemoGroupDot color={freshGroup.color ?? DEFAULT_MEMO_GROUP_COLOR} />
          <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text font="body" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">{freshGroup.title}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">{freshGroup.memos.length} 条 Memo</Text>
          </VStack>
          <Button title="" systemImage="plus.circle" tint="systemBlue" action={() => void addMemoToGroup(freshGroup)} />
          <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" />
        </HStack>
      </NavigationLink>
    )
  }

  if (!groups.length) {
    return (
      <NavigationStack>
        <Form
          navigationTitle="编辑列表"
          navigationBarTitleDisplayMode="inline"
          formStyle="grouped"
          listRowSpacing={10}
          contentMargins={APP_SCROLL_CONTENT_MARGINS}
          toolbar={{
            topBarTrailing: <Button title="" systemImage="plus" action={() => void addGroup()} />
          }}
        >
          <EmptyState title="暂无列表" message="点击右上角 + 新增 Memo 列表。" systemImage="list.bullet.rectangle" />
        </Form>
      </NavigationStack>
    )
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="编辑列表"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        listRowSpacing={10}
        contentMargins={APP_SCROLL_CONTENT_MARGINS}
        toolbar={{
          topBarTrailing: <Button title="" systemImage="plus" action={() => void addGroup()} />
        }}
      >
        <Section footer={<Text>长按列表可拖动排序；左滑可删除列表。</Text>} listSectionSeparator="hidden">
          <ForEach
            count={groups.length}
            itemBuilder={(index) => {
              const group = groups[index]
              return (
                <HStack
                  key={group.id}
                  listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
                  listRowSeparator="hidden"
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [<Button title="" systemImage="trash" tint="systemRed" action={() => void deleteGroup(group)} />],
                  }}
                  contextMenu={{
                    menuItems: (
                      <Group>
                        <Button title="编辑列表" systemImage="paintpalette" action={() => void editGroup(group)} />
                        <Button title="添加 Memo" systemImage="plus" action={() => void addMemoToGroup(group)} />
                        <Button title="删除列表" systemImage="trash" role="destructive" action={() => void deleteGroup(group)} />
                      </Group>
                    ),
                  }}
                >
                  {renderGroupLink(group)}
                </HStack>
              )
            }}
            onMove={(indices, newOffset) => {
              void reorderGroups(indices, newOffset)
            }}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}

const AI_PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "script", label: "脚本默认" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "anthropic", label: "Anthropic" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "openrouter", label: "OpenRouter" },
]

type AIAssistantEditorResult = {
  assistant?: AIAssistant
  name: string
  systemPrompt: string
  provider: string
  modelId: string
  deleteId?: string
}

function AIAssistantEditorView(props: { assistant?: AIAssistant }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(props.assistant?.name ?? "")
  const [systemPrompt, setSystemPrompt] = useState(props.assistant?.systemPrompt ?? "")
  const [provider, setProvider] = useState(props.assistant?.provider ?? "script")
  const [modelId, setModelId] = useState(props.assistant?.modelId ?? "")
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false)

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    dismiss({
      assistant: props.assistant,
      name: trimmed,
      systemPrompt: systemPrompt.trim(),
      provider: provider,
      modelId: modelId.trim(),
    } as AIAssistantEditorResult)
  }

  async function requestDelete() {
    const confirmed = await Dialog.confirm({
      title: "删除助手",
      message: `确认删除「${props.assistant?.name}」？删除后无法撤销。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (confirmed) {
      dismiss({ assistant: props.assistant, deleteId: props.assistant?.id, name, systemPrompt, provider, modelId } as AIAssistantEditorResult)
    }
  }

  async function generatePromptFromInput() {
    const trimmedInput = systemPrompt.trim()
    if (!trimmedInput || isGeneratingPrompt) return
    
    setIsGeneratingPrompt(true)
    try {
      const currentName = name.trim()
      const metaPrompt = `你是一个专业的 AI 助手配置助手。用户会输入一段描述，你需要分析用户的意图并完成以下任务：

1. 判断用户是否想要修改助手标题：
   - 如果用户明确说"把标题改成..."、"名字改为..."、"叫..."等，则设置 shouldUpdateTitle 为 true，并提供 newTitle
   - 如果用户只是描述助手功能，则 shouldUpdateTitle 为 false

2. 根据用户描述生成系统提示词：
   - 提示词应该明确助手的角色和能力
   - 说明助手应该如何处理用户输入
   - 语言简洁专业，不要超过 200 字
   - 保持用户原始描述的核心意图

当前助手标题：${currentName || "未设置"}
用户输入：${trimmedInput}`
      
      const result = await Assistant.requestStructuredData<{
        shouldUpdateTitle: boolean
        newTitle: string
        systemPrompt: string
      }>(metaPrompt, {
        type: "object",
        description: "AI助手配置结果",
        properties: {
          shouldUpdateTitle: {
            type: "boolean",
            description: "是否需要更新助手标题"
          },
          newTitle: {
            type: "string",
            description: "新的助手标题（仅在shouldUpdateTitle为true时有效）"
          },
          systemPrompt: {
            type: "string",
            description: "生成的系统提示词"
          }
        }
      })
      
      if (result) {
        if (result.shouldUpdateTitle && result.newTitle) {
          setName(result.newTitle)
        }
        if (result.systemPrompt) {
          setSystemPrompt(result.systemPrompt)
        }
      }
    } catch (e) {
      console.error("生成提示词失败：", e)
    } finally {
      setIsGeneratingPrompt(false)
    }
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle={props.assistant ? name || "编辑助手" : "新增助手"}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        presentationDetents={[0.82, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="关闭" role="cancel" action={() => dismiss(null)} />,
          topBarTrailing: <Button title="保存" disabled={!name.trim()} action={save} />,
        }}
      >
        <Section header={<Text>名称</Text>}>
          <TextField title="" value={name} prompt="助手名称，例如：翻译助手" onChanged={setName} />
        </Section>
        <Section header={<Text>提示词</Text>} footer={<Text>助手将根据此提示词处理你输入的文字。</Text>}>
          <TextField
            title=""
            value={systemPrompt}
            prompt="例如：你是一个翻译助手，请将用户输入的内容翻译成英文。"
            axis="vertical"
            frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
            lineLimit={{
              min: 4,
              max: 20,
              reservesSpace: true,
            }}
            onChanged={setSystemPrompt}
          />
          <Button
            title={isGeneratingPrompt ? "生成中..." : "AI生成"}
            systemImage={isGeneratingPrompt ? "arrow.triangle.2.circlepath" : "wand.and.stars"}
            disabled={!systemPrompt.trim() || isGeneratingPrompt}
            action={generatePromptFromInput}
          />
        </Section>
        <Section header={<Text>AI 模型</Text>} footer={<Text>选择「脚本默认」将使用 Scripting 助理的默认模型。</Text>}>
          <Picker title="提供商" pickerStyle="menu" value={provider} onChanged={(value: any) => setProvider(String(value))}>
            {AI_PROVIDER_OPTIONS.map((opt) => <Text key={opt.value} tag={opt.value}>{opt.label}</Text>)}
          </Picker>
          <TextField title="模型 ID" value={modelId} prompt="留空则使用默认模型" onChanged={setModelId} />
        </Section>
        {props.assistant ? (
          <Section>
            <Button title="删除助手" systemImage="trash" role="destructive" action={requestDelete} />
          </Section>
        ) : null}
      </Form>
    </NavigationStack>
  )
}

type AISettingsResult = {
  defaultProvider: string
  defaultModelId: string
  columnsPerRow: number
}

function AISettingsView(props: { defaultProvider: string; defaultModelId: string; columnsPerRow: number }) {
  const dismiss = Navigation.useDismiss()
  const [provider, setProvider] = useState(props.defaultProvider ?? "script")
  const [modelId, setModelId] = useState(props.defaultModelId ?? "")
  const [columnsPerRow, setColumnsPerRow] = useState(props.columnsPerRow ?? 2)
  const [customProvider, setCustomProvider] = useState(
    AI_PROVIDER_OPTIONS.some((opt) => opt.value === props.defaultProvider) ? "" : (props.defaultProvider || "")
  )

  const resolvedProvider = provider === "__custom__" ? customProvider.trim() : provider

  function save() {
    dismiss({ defaultProvider: resolvedProvider || "script", defaultModelId: modelId.trim(), columnsPerRow } as AISettingsResult)
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="AI 设置"
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        presentationDetents={[0.64, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="关闭" role="cancel" action={() => dismiss(null)} />,
          topBarTrailing: <Button title="保存" action={save} />,
        }}
      >
        <Section header={<Text>默认提供商</Text>} footer={<Text>新建助手时将使用此提供商。助手也可以选择自己的提供商。</Text>}>
          <Picker title="提供商" pickerStyle="menu" value={provider} onChanged={(value: any) => setProvider(String(value))}>
            {AI_PROVIDER_OPTIONS.map((opt) => <Text key={opt.value} tag={opt.value}>{opt.label}</Text>)}
            <Text tag="__custom__">自定义…</Text>
          </Picker>
          {provider === "__custom__" ? (
            <TextField
              title="自定义提供商"
              value={customProvider}
              prompt="例如：openai / custom:my-provider"
              onChanged={setCustomProvider}
            />
          ) : null}
        </Section>
        <Section header={<Text>默认模型 ID</Text>} footer={<Text>留空则使用提供商默认模型。助手可单独设置自己的模型。</Text>}>
          <TextField
            title=""
            value={modelId}
            prompt="例如：gpt-4-turbo（留空使用默认）"
            onChanged={setModelId}
          />
        </Section>
        <Section header={<Text>键盘 AI 助手布局</Text>}>
          <Picker title="每行助手数" pickerStyle="menu" value={String(columnsPerRow)} onChanged={(value: any) => setColumnsPerRow(Number(value))}>
            <Text tag="2">2 个</Text>
            <Text tag="3">3 个</Text>
            <Text tag="4">4 个</Text>
          </Picker>
        </Section>
      </Form>
    </NavigationStack>
  )
}

function ClipContentEditorView(props: {
  content: string
}) {
  const dismiss = Navigation.useDismiss()
  const [controller] = useState(() => new EditorController({
    content: props.content,
    ext: "txt",
    readOnly: false,
  }))

  useEffect(() => {
    return () => {
      controller.dispose()
    }
  }, [controller])

  return (
    <NavigationStack>
      <VStack
        navigationTitle="编辑内容"
        navigationBarTitleDisplayMode="inline"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        presentationDetents={["large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: <Button title="取消" role="cancel" action={() => dismiss(null)} />,
          topBarTrailing: <Button title="保存" action={() => dismiss(controller.content)} />,
        }}
      >
        <Editor
          controller={controller}
          scriptName="CAIS"
          showAccessoryView
        />
      </VStack>
    </NavigationStack>
  )
}

function AppTokenResultView(props: {
  tokens: CaisToken[]
}) {
  const dismiss = Navigation.useDismiss()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedText = selectedTokenText(props.tokens, selectedIds)

  function toggleToken(token: CaisToken) {
    setSelectedIds((ids) => ids.includes(token.id)
      ? ids.filter((id) => id !== token.id)
      : [...ids, token.id])
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle="分词结果"
        navigationBarTitleDisplayMode="inline"
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        padding={16}
        toolbar={{
          topBarLeading: <Button title="清空" systemImage="arrow.counterclockwise.circle" disabled={!selectedText} action={() => setSelectedIds([])} />,
          topBarTrailing: <Button title="复制" systemImage="doc.on.doc" disabled={!selectedText} action={() => dismiss(selectedText)} />,
        }}
      >
        <TokenSelectionPanel
          tokens={props.tokens}
          selectedIds={selectedIds}
          selectedText={selectedText}
          minHeight={420}
          onToggle={toggleToken}
        />
      </VStack>
    </NavigationStack>
  )
}

function ZoomableImageViewerView(props: {
  title: string
  imagePath?: string
}) {
  const dismiss = Navigation.useDismiss()
  const [scale, setScale] = useState(1)

  function zoomIn() {
    setScale((value) => Math.min(5, Number((value + 0.5).toFixed(2))))
  }

  function zoomOut() {
    setScale((value) => Math.max(1, Number((value - 0.5).toFixed(2))))
  }

  function resetZoom() {
    setScale(1)
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={props.title || "图片"}
        navigationBarTitleDisplayMode="inline"
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
        padding={16}
        toolbar={{
          topBarLeading: (
            <HStack spacing={12}>
              <Button title="" systemImage="minus.magnifyingglass" disabled={scale <= 1} action={zoomOut} />
              <Button title="" systemImage="plus.magnifyingglass" disabled={scale >= 5} action={zoomIn} />
            </HStack>
          ),
          topBarTrailing: <Button title="完成" action={() => dismiss(null)} />,
        }}
      >
        {props.imagePath ? (
          <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }} spacing={10}>
            <ScrollView axes="all">
              <Image
                filePath={props.imagePath}
                resizable
                scaleToFit
                scaleEffect={scale}
                frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
                onTapGesture={{ count: 2, perform: resetZoom }}
              />
            </ScrollView>
            <Text font="caption" foregroundStyle="secondaryLabel">缩放：{Math.round(scale * 100)}% · 双击图片复位</Text>
          </VStack>
        ) : (
          <Text foregroundStyle="secondaryLabel">图片文件不可读取</Text>
        )}
      </VStack>
    </NavigationStack>
  )
}

function ImageViewerView(props: {
  item: ClipItem
}) {
  return <ZoomableImageViewerView title={props.item.title || "图片"} imagePath={props.item.imagePath} />
}

function remoteImageCacheKey(item: RemoteClipItem): string {
  return item.profileId || `${item.type}-${item.hash}`
}

function localSelectionKey(item: ClipItem): string {
  return `local-${item.id}`
}

function remoteSelectionKey(item: RemoteClipItem): string {
  return `remote-${remoteImageCacheKey(item)}`
}

function memoSelectionKey(group: KeyboardMemoGroup, memo: KeyboardMemoItem): string {
  return `${group.id}::${memo.id}`
}

function selectedSetHas(set: Set<string>, key: string): boolean {
  return set.has(key)
}

function toggledSelection(set: Set<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function safeFileName(name: string): string {
  return (name || "image").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "image"
}

function remoteImageFileName(item: RemoteClipItem): string {
  const base = safeFileName(item.dataName || item.text || item.hash.slice(0, 12) || "remote-image")
  const hasExt = /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(base)
  return hasExt ? base : `${base}.png`
}

function joinPath(base: string, name: string): string {
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`
}

async function writeDataFile(path: string, data: Data): Promise<void> {
  const fm = (globalThis as any).FileManager
  if (typeof fm?.writeAsData === "function") {
    await fm.writeAsData(path, data)
    return
  }
  const bytes = typeof data.toUint8Array === "function" ? data.toUint8Array() : null
  if (bytes && typeof fm?.writeAsBytes === "function") {
    await fm.writeAsBytes(path, bytes)
  }
}

function remoteImageTitle(item: RemoteClipItem): string {
  return item.dataName || item.text || `图片-${item.hash.slice(0, 8) || "远程"}`
}

function debugRemoteItem(item: RemoteClipItem) {
  return {
    profileId: item.profileId,
    type: item.type,
    hash: item.hash,
    textLength: item.text?.length ?? 0,
    textHead: item.text ? item.text.slice(0, 80) : "",
    fullTextLength: item.fullText?.length ?? 0,
    dataName: item.dataName,
    hasData: item.hasData,
    size: item.size,
    isDeleted: item.isDeleted,
    starred: item.starred,
    pinned: item.pinned,
    version: item.version,
  }
}

function makeThumbnailData(image: UIImage): Data | null {
  const thumb = typeof image.preparingThumbnail === "function"
    ? image.preparingThumbnail({ width: 220, height: 220 })
    : typeof image.renderedIn === "function"
      ? image.renderedIn({ width: 220, height: 220 })
      : null
  if (!thumb) return null
  if (typeof thumb.toJPEGData === "function") return thumb.toJPEGData(0.68)
  const dataClass = (globalThis as any).Data
  return typeof dataClass?.fromJPEG === "function" ? dataClass.fromJPEG(thumb, 0.68) : null
}

function RemoteImageViewerView(props: {
  title: string
  imagePath?: string
}) {
  return <ZoomableImageViewerView title={props.title || "图片"} imagePath={props.imagePath} />
}

export function AppRoot() {
  const colorScheme = useColorScheme()
  const [initialSettings] = useState<CaisSettings>(() => loadSettings())
  const activeTab = useObservable(tabForStartPage(initialSettings.defaultStartPage))
  const pipPresented = useObservable(false)
  const toastPresented = useObservable(false)
  const [settings, setSettings] = useState<CaisSettings>(initialSettings)
  const [memoGroups, setMemoGroups] = useState<KeyboardMemoGroup[]>(() => readKeyboardMemos())
  const [memoListManagerToken, setMemoListManagerToken] = useState(0)
  const [memoGroupsLoading, setMemoGroupsLoading] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  
  // Load settings from DB on component mount (with delay + retry)
  useEffect(() => {
    let cancelled = false
    const loadSettingsData = async () => {
      setSettingsLoading(true)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const loadedSettings = await loadSettingsFromDB()
          if (!cancelled) {
            setSettings(loadedSettings)
            // Set the correct tab from DB before rendering TabView (avoids flash)
            activeTab.setValue(tabForStartPage(loadedSettings.defaultStartPage))
            setSettingsLoaded(true)
          }
          if (!cancelled) setSettingsLoading(false)
          return
        } catch (error) {
          console.error(`Failed to load settings (attempt ${attempt + 1}):`, error)
          if (attempt < 2 && !cancelled) await new Promise<void>(r => setTimeout(r, 500))
        }
      }
      if (!cancelled) {
        setSettingsLoading(false)
        setSettingsLoaded(true)
      }
    }
    const timer = setTimeout(loadSettingsData, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])
  
  // Load memo groups from DB on component mount (with delay + retry)
  useEffect(() => {
    let cancelled = false
    const loadMemos = async () => {
      setMemoGroupsLoading(true)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const groups = await loadMemoGroupsFromDB()
          if (!cancelled) setMemoGroups(groups)
          if (!cancelled) setMemoGroupsLoading(false)
          return
        } catch (error) {
          console.error(`Failed to load memo groups (attempt ${attempt + 1}):`, error)
          if (attempt < 2 && !cancelled) await new Promise<void>(r => setTimeout(r, 500))
        }
      }
      if (!cancelled) setMemoGroupsLoading(false)
    }
    const timer = setTimeout(loadMemos, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])
  const [aiSettings, setAISettings] = useState<AISettings>(settings.ai ?? { ...DEFAULT_AI_SETTINGS })
  
  // Sync aiSettings when settings loads from DB
  useEffect(() => {
    if (settings.ai) setAISettings(settings.ai)
  }, [settings])
  const [favoriteGroups, setFavoriteGroups] = useState<ClipGroup[]>([])
  const [clipboardGroups, setClipboardGroups] = useState<ClipGroup[]>([])
  const [clipPageLimit, setClipPageLimit] = useState(CLIP_PAGE_STEP)
  const [remoteItems, setRemoteItems] = useState<RemoteClipItem[]>([])
  const remoteItemsRef = useRef<RemoteClipItem[]>([])
  const [remoteImageCache, setRemoteImageCache] = useState<RemoteImageCache>({})
  const [remoteFileDownloadStatus, setRemoteFileDownloadStatus] = useState<Record<string, { loading?: boolean; error?: string; savedPath?: string }>>({})
  const [remotePage, setRemotePage] = useState(0)
  const [remotePageLimit, setRemotePageLimit] = useState(REMOTE_PAGE_STEP)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState("")
  const [remoteLastSyncAt, setRemoteLastSyncAt] = useState<number | undefined>(undefined)
  const [networkClipFilter, setNetworkClipFilter] = useState<NetworkClipFilter>("all")
  const [clipboardSourceFilter, setClipboardSourceFilter] = useState<ClipboardSourceFilter>("universal")
  const remoteLoadingRef = useRef(false)
  const remoteFavoritesLoadingRef = useRef(false)
  const remoteRefreshInteractionBlockedUntilRef = useRef(0)
  const clipPageLimitRef = useRef(clipPageLimit)
  const remotePageLimitRef = useRef(remotePageLimit)
  const [addCustomActionToken, setAddCustomActionToken] = useState(0)
  const [query, setQuery] = useState("")
  const settingsRef = useRef(settings)
  const memoGroupsRef = useRef(memoGroups)
  const queryRef = useRef(query)
  const lastObservedPasteboardChangeCount = useRef<number | null>(null)
  const toastHideTimer = useRef<any>(null)
  const [appFullscreen, setAppFullscreen] = useState(() => readAppFullscreen(false))
  const [loading, setLoading] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>({
    active: false,
    lastMessage: "未启动",
    capturedCount: 0,
  })
  const [bulkSelectionMode, setBulkSelectionMode] = useState<BulkSelectionMode | null>(null)
  const [bulkActionSelection, setBulkActionSelection] = useState("__none__")
  const [selectedClipKeys, setSelectedClipKeys] = useState<Set<string>>(() => new Set())
  const [selectedMemoKeys, setSelectedMemoKeys] = useState<Set<string>>(() => new Set())
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"

  async function saveMemoGroups(groups: KeyboardMemoGroup[]) {
    const normalized = normalizeMemoSortOrders(sortedMemoGroups(groups))
    setMemoGroups(normalized)
    setMemoListManagerToken((value) => value + 1)
    try {
      await writeKeyboardMemos(normalized)
    } catch (error) {
      console.error("Failed to save memo groups:", error)
      showToast("保存Memo失败")
    }
  }

  async function toggleGroupCollapse(group: KeyboardMemoGroup) {
    const now = Date.now()
    const next = memoGroupsRef.current.map((item) => item.id === group.id ? {
      ...item,
      collapsed: !item.collapsed,
      updatedAt: now,
    } : item)
    await saveMemoGroups(next)
  }

  function saveAISettings(next: AISettings) {
    setAISettings(next)
    const updated = { ...settings, ai: next }
    setSettings(updated)
    saveSettings(updated)
  }

  function refreshMemoGroupsFromStorage(): KeyboardMemoGroup[] {
    const groups = readKeyboardMemos()
    setMemoGroups(groups)
    setMemoListManagerToken((value) => value + 1)
    return groups
  }

  function inClipSelectionMode(): boolean {
    return bulkSelectionMode === "clips"
  }

  function inMemoSelectionMode(): boolean {
    return bulkSelectionMode === "memos"
  }

  function selectedClipCount(): number {
    return selectedClipKeys.size
  }

  function selectedMemoCount(): number {
    return selectedMemoKeys.size
  }

  function exitBulkSelection() {
    setBulkSelectionMode(null)
    setBulkActionSelection("__none__")
    setSelectedClipKeys(new Set())
    setSelectedMemoKeys(new Set())
  }

  function enterBulkSelection(mode: BulkSelectionMode) {
    setBulkSelectionMode(mode)
    setBulkActionSelection("__none__")
    setSelectedClipKeys(new Set())
    setSelectedMemoKeys(new Set())
  }

  function toggleClipSelectionKey(key: string) {
    setSelectedClipKeys((current) => toggledSelection(current, key))
  }

  function toggleMemoSelectionKey(key: string) {
    setSelectedMemoKeys((current) => toggledSelection(current, key))
  }

  function selectAllVisibleClips() {
    const keys = filteredUniversalItems().map((entry) => entry.origin === "remote" ? remoteSelectionKey(entry.item) : localSelectionKey(entry.item))
    setSelectedClipKeys(new Set(keys))
  }

  function selectAllVisibleMemos() {
    const keys = sortedMemoGroups(memoGroups).flatMap((group) => sortedMemos(group).map((memo) => memoSelectionKey(group, memo)))
    setSelectedMemoKeys(new Set(keys))
  }

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    memoGroupsRef.current = memoGroups
  }, [memoGroups])

  useEffect(() => {
    queryRef.current = query
  }, [query])

  useEffect(() => {
    remoteItemsRef.current = remoteItems
  }, [remoteItems])

  useEffect(() => {
    clipPageLimitRef.current = clipPageLimit
  }, [clipPageLimit])

  useEffect(() => {
    remotePageLimitRef.current = remotePageLimit
  }, [remotePageLimit])

  useEffect(() => {
    const previousResumeHandler = (globalThis as any)[CAIS_APP_RESUME_HANDLER]
      ; (globalThis as any)[CAIS_APP_RESUME_HANDLER] = handleScriptResume
    void boot()
    const removeMinimize = Script.onMinimize?.(() => {
      if (intentionalMinimize) {
        intentionalMinimize = false
        return
      }
      Script.exit()
    })
    return () => {
      if (previousResumeHandler) {
        ; (globalThis as any)[CAIS_APP_RESUME_HANDLER] = previousResumeHandler
      } else {
        delete (globalThis as any)[CAIS_APP_RESUME_HANDLER]
      }
      removeMinimize?.()
      clearToastHideTimer()
      stopPipMonitor()
    }
  }, [])

  useEffect(() => {
    let lastSeenCommandAt = 0
    const timer = (globalThis as any).setInterval?.(() => {
      const state = readPipControlState()
      if (!state.command || state.updatedAt <= lastSeenCommandAt) return
      lastSeenCommandAt = state.updatedAt
      if (state.command === "stop") {
        deactivatePipFromExternal()
      } else if (state.command === "start") {
        void activatePipFromApp()
      }
    }, 500)
    return () => {
      if (timer) (globalThis as any).clearInterval?.(timer)
    }
  }, [])

  useEffect(() => {
    let lastSeenClipDataVersion = readClipDataVersion()
    const timer = (globalThis as any).setInterval?.(() => {
      const version = readClipDataVersion()
      if (version <= lastSeenClipDataVersion) return
      lastSeenClipDataVersion = version
      void refresh(true, settingsRef.current)
    }, 700)
    return () => {
      if (timer) (globalThis as any).clearInterval?.(timer)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let checking = false
    let timer: any = null

    function schedule() {
      if (stopped) return
      const interval = Math.max(300, settingsRef.current.monitorIntervalMs || 500)
      timer = (globalThis as any).setTimeout?.(tick, interval)
    }

    function tick() {
      if (stopped) return
      if (checking) {
        schedule()
        return
      }
      checking = true
      void (async () => {
        try {
          await captureClipboardChangeAndRefresh()
        } finally {
          checking = false
          schedule()
        }
      })()
    }

    timer = (globalThis as any).setTimeout?.(tick, 500)
    return () => {
      stopped = true
      if (timer) (globalThis as any).clearTimeout?.(timer)
    }
  }, [])

  useEffect(() => {
    const timer = (globalThis as any).setTimeout?.(() => {
      void refresh(true)
    }, 180)
    return () => {
      if (timer) (globalThis as any).clearTimeout?.(timer)
    }
  }, [query])

  // 启动 / 配置变更时：先恢复本地缓存，随后后台刷新远端剪贴板历史
  useEffect(() => {
    if (!isRemoteSyncConfigured(settings.syncClipboard)) {
      setRemoteItems([])
      remoteItemsRef.current = []
      setRemotePage(0)
      setRemotePageLimit(REMOTE_PAGE_STEP)
      remotePageLimitRef.current = REMOTE_PAGE_STEP
      setRemoteError("")
      setRemoteLastSyncAt(undefined)
      return
    }
    const cached = loadRemoteClipCache(settings.syncClipboard)
    if (cached) {
      const items = mergeRemoteItems([], cached.items)
      remoteItemsRef.current = items
      setRemoteItems(items)
      setRemotePage(Math.max(1, Math.ceil(Math.min(REMOTE_PAGE_STEP, Math.max(items.length, 1)) / REMOTE_PAGE_STEP)))
      setRemotePageLimit(REMOTE_PAGE_STEP)
      remotePageLimitRef.current = REMOTE_PAGE_STEP
      setRemoteLastSyncAt(cached.lastSyncAt)
      setRemoteError("")
    }
    const timer = (globalThis as any).setTimeout?.(() => {
      void reloadRemote(settingsRef.current)
    }, cached?.items.length ? 100 : 600)
    return () => {
      if (timer) (globalThis as any).clearTimeout?.(timer)
    }
  }, [
    settings.syncClipboard.enabled,
    settings.syncClipboard.url,
    settings.syncClipboard.username,
    settings.syncClipboard.password,
    settings.syncClipboard.allowInsecure,
  ])

  // 收藏 tab 需要完整合并“远程收藏”：远程历史首页未必包含所有 starred 条目，
  // 因此单独使用 starred 查询把远程收藏补进 remoteItems 缓存。
  useEffect(() => {
    const sync = settings.syncClipboard
    if (!isRemoteSyncConfigured(sync)) return
    const timer = (globalThis as any).setTimeout?.(() => {
      void loadRemoteFavorites(settingsRef.current, queryRef.current.trim())
    }, 250)
    return () => {
      if (timer) (globalThis as any).clearTimeout?.(timer)
    }
  }, [
    settings.syncClipboard.enabled,
    settings.syncClipboard.url,
    settings.syncClipboard.username,
    settings.syncClipboard.password,
    settings.syncClipboard.allowInsecure,
    query,
  ])

  // 按 intervalSec 定时轮询远端：自动下载新条目到本地
  useEffect(() => {
    const sync = settings.syncClipboard
    if (!isRemoteSyncConfigured(sync)) return
    if (!sync.autoDownload) return
    const intervalMs = Math.max(2, Number(sync.intervalSec) || 5) * 1000
    let stopped = false
    let timer: any = null

    function schedule() {
      if (stopped) return
      timer = (globalThis as any).setTimeout?.(tick, intervalMs)
    }

    async function tick() {
      if (stopped) return
      try {
        const modifiedAfter = remoteModifiedAfterForIncrementalSync(remoteItemsRef.current)
        const result = await queryRemoteHistory(settingsRef.current.syncClipboard, {
          pageNumber: 1,
          modifiedAfter,
        })
        if (result.status === "ok") {
          const syncedAt = Date.now()
          setRemoteItems((prev) => {
            const merged = mergeRemoteItems(prev, result.items)
            remoteItemsRef.current = merged
            saveRemoteClipCache(settingsRef.current.syncClipboard, {
              items: merged,
              page: Math.max(1, Math.ceil(Math.min(remotePageLimitRef.current, Math.max(merged.length, 1)) / REMOTE_PAGE_STEP)),
              hasMore: false,
              lastSyncAt: syncedAt,
            })
            return merged
          })
              setRemoteLastSyncAt(syncedAt)
          if (settingsRef.current.syncClipboard.autoDownload) {
            await syncRemoteIntoLocal(result.items, settingsRef.current)
          }
          if (remoteError) setRemoteError("")
        } else if (result.status === "error") {
          setRemoteError(result.message)
        }
      } catch {
        // 静默失败：下一轮再试
      } finally {
        schedule()
      }
    }

    schedule()
    return () => {
      stopped = true
      if (timer) (globalThis as any).clearTimeout?.(timer)
    }
  }, [
    settings.syncClipboard.enabled,
    settings.syncClipboard.url,
    settings.syncClipboard.autoDownload,
    settings.syncClipboard.intervalSec,
  ])

  async function boot() {
    setLoading(true)
    try {
      await initializeDatabase()
      await captureClipboardAndRefresh(settingsRef.current, true)
      void rebuildSpotlightIndex(settingsRef.current.maxItems).catch(() => {})
      if (Script.queryParameters?.pip === "1") {
        await activatePipFromApp()
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

  async function captureClipboardAndRefresh(currentSettings = settingsRef.current, force = false) {
    await captureClipboardIfChanged(currentSettings, force)
    await refresh(true, currentSettings)
  }

  async function captureClipboardChangeAndRefresh() {
    if (pipPresented.value || appMonitorStopper) return
    const changed = await captureClipboardIfChanged(settingsRef.current)
    if (changed) {
      await refresh(true, settingsRef.current)
    }
  }

  async function captureClipboardIfChanged(currentSettings = settingsRef.current, force = false): Promise<boolean> {
    try {
      const changeCount = await currentChangeCount()
      if (!force && lastObservedPasteboardChangeCount.current === changeCount) return false
      lastObservedPasteboardChangeCount.current = changeCount
      const result = await captureCurrentClipboard(currentSettings, { shouldSkipPayload: combinedDuplicateSkipReason })
      return result.status === "created" || result.status === "updated"
    } catch {
      return false
    }
  }

  function handleScriptResume(details: any = {}) {
    if (details.resumeFromMinimized) {
      intentionalMinimize = false
    }
    const pipCommand = details.queryParameters?.pip
    if (pipCommand === "0") {
      deactivatePipFromExternal({ exitAfter: true })
      return
    }
    if (pipCommand === "1") {
      void activatePipFromApp()
      return
    }
    void captureClipboardChangeAndRefresh()
  }

  async function refresh(_force = false, currentSettings = settings) {
    const generation = ++appRefreshGeneration
    const baseLimit = Math.min(currentSettings.maxItems, APP_GROUP_PAGE_SIZE)
    const search = queryRef.current.trim()
    // 本地剩贴板使用滑动加载限额；收藏仍然一次出。
    const clipLimit = Math.min(baseLimit, Math.max(CLIP_PAGE_STEP, clipPageLimitRef.current))
    const [nextFavoriteGroups, nextClipboardGroups] = await Promise.all([
      getClipGroups("favorites", search, baseLimit),
      getClipGroups("clipboard", search, clipLimit),
    ])
    if (generation !== appRefreshGeneration) return
    setFavoriteGroups(nextFavoriteGroups)
    setClipboardGroups(nextClipboardGroups)
    // 自动上传本地未同步剪贴板：最新且比远端新的推送为当前剪切板，其余进入历史记录
    void tryAutoUploadPending(nextClipboardGroups, currentSettings)
  }

  async function tryAutoUploadPending(groups: ClipGroup[], currentSettings: CaisSettings, allowWhenAutoUploadOff = false): Promise<void> {
    if (!isRemoteSyncConfigured(currentSettings.syncClipboard)) return
    if (!currentSettings.syncClipboard.autoUpload && !allowWhenAutoUploadOff) return
    const localItems = groups
      .flatMap((g) => g.items)
      .filter((it) => !it.manualFavorite && it.source !== "remote")
      .sort((a, b) => Math.max(b.updatedAt || 0, b.createdAt || 0) - Math.max(a.updatedAt || 0, a.createdAt || 0))
    if (!localItems.length) return

    const remoteNewest = remoteItemsRef.current.reduce((max, item) => {
      return Math.max(max, item.lastModified || 0, item.createTime || 0, item.fetchedAt || 0)
    }, 0)
    const latestLocalTime = Math.max(localItems[0].updatedAt || 0, localItems[0].createdAt || 0)
    const latestShouldPushCurrent = latestLocalTime > remoteNewest

    for (let index = 0; index < localItems.length; index += 1) {
      const item = localItems[index]
      const target = index === 0 && latestShouldPushCurrent ? "current" : "history"
      const uploadResult = await tryAutoUpload(item, target)
      if (uploadResult.status === "error") {
        showToast(uploadResult.message || "上传失败")
        // 最新当前剪切板推送失败时不要把它降级写入历史，避免远端设备收不到当前复制动作。
        if (target === "current") break
      }
    }
  }

  // ---- 本地无限滚动 ----
  function ensureLocalLoadMore() {
    const current = clipPageLimitRef.current
    const totalLoaded = clipboardGroups.reduce((acc, g) => acc + g.items.length, 0)
    // 只有当前已经吃满了请求限额才加下一段
    if (totalLoaded < current) return
    const next = Math.min(current + CLIP_PAGE_STEP, APP_GROUP_PAGE_SIZE)
    if (next === current) return
    clipPageLimitRef.current = next
    setClipPageLimit(next)
    void refresh(true)
  }

  // ---- 远端加载 ----
  function rememberRemoteItem(item: RemoteClipItem) {
    const syncedAt = Date.now()
    setRemoteItems((prev) => {
      const merged = mergeRemoteItems(prev, [item])
      remoteItemsRef.current = merged
      saveRemoteClipCache(settingsRef.current.syncClipboard, {
        items: merged,
        page: Math.max(1, remotePage),
        hasMore: false,
        lastSyncAt: syncedAt,
      })
      return merged
    })
    setRemoteLastSyncAt(syncedAt)
  }

  function blockRemoteRowInteractions() {
    remoteRefreshInteractionBlockedUntilRef.current = Date.now() + REMOTE_REFRESH_INTERACTION_GRACE_MS
  }

  function isRemoteRowInteractionBlocked(): boolean {
    return remoteLoadingRef.current || Date.now() < remoteRefreshInteractionBlockedUntilRef.current
  }

  async function runRemoteRowAction(action: () => void | Promise<void>) {
    if (isRemoteRowInteractionBlocked()) return
    await action()
  }

  async function reloadRemote(currentSettings = settingsRef.current): Promise<void> {
    const startedAt = Date.now()
    const modifiedAfter = remoteModifiedAfterForIncrementalSync(remoteItemsRef.current)
    console.log("[CAIS][RemoteRefresh] start", {
      configured: isRemoteSyncConfigured(currentSettings.syncClipboard),
      url: currentSettings.syncClipboard.url,
      autoDownload: currentSettings.syncClipboard.autoDownload,
      filter: networkClipFilter,
      previousCount: remoteItemsRef.current.length,
      mode: modifiedAfter ? "incremental" : "initial",
      modifiedAfter: modifiedAfter ? new Date(modifiedAfter).toISOString() : undefined,
    })
    if (!isRemoteSyncConfigured(currentSettings.syncClipboard)) {
      console.log("[CAIS][RemoteRefresh] skipped: not configured", {
        enabled: currentSettings.syncClipboard.enabled,
        url: currentSettings.syncClipboard.url,
      })
      setRemoteItems([])
      remoteItemsRef.current = []
      setRemotePage(0)
      setRemotePageLimit(REMOTE_PAGE_STEP)
      remotePageLimitRef.current = REMOTE_PAGE_STEP
      setRemoteError(currentSettings.syncClipboard.enabled ? "未配置服务器地址" : "")
      return
    }
    if (remoteLoadingRef.current) {
      console.log("[CAIS][RemoteRefresh] skipped: already loading")
      return
    }
    remoteLoadingRef.current = true
    setRemoteLoading(true)
    setRemoteError("")
    try {
      const result = await queryRemoteHistory(currentSettings.syncClipboard, {
        pageNumber: 1,
        modifiedAfter,
      })
      console.log("[CAIS][RemoteRefresh] query result", {
        status: result.status,
        durationMs: Date.now() - startedAt,
        count: result.status === "ok" ? result.items.length : undefined,
        hasMore: result.status === "ok" ? result.hasMore : undefined,
        message: result.status === "error" ? result.message : undefined,
        reason: result.status === "skipped" ? result.reason : undefined,
        sample: result.status === "ok" ? result.items.slice(0, 5).map(debugRemoteItem) : undefined,
      })
      if (result.status === "ok") {
        const syncedAt = Date.now()
        const previous = remoteItemsRef.current
        const merged = mergeRemoteItems(previous, result.items)
        remoteItemsRef.current = merged
        setRemoteItems(merged)
        setRemotePage(Math.max(1, Math.ceil(Math.min(remotePageLimitRef.current, Math.max(merged.length, 1)) / REMOTE_PAGE_STEP)))
          setRemoteLastSyncAt(syncedAt)
        saveRemoteClipCache(currentSettings.syncClipboard, {
          items: merged,
          page: Math.max(1, Math.ceil(Math.min(remotePageLimitRef.current, Math.max(merged.length, 1)) / REMOTE_PAGE_STEP)),
          hasMore: false,
          lastSyncAt: syncedAt,
        })
        if (currentSettings.syncClipboard.autoDownload && result.items.length) {
          console.log("[CAIS][RemoteRefresh] autoDownload begin", { count: result.items.length })
          await syncRemoteIntoLocal(result.items, currentSettings)
          console.log("[CAIS][RemoteRefresh] autoDownload end")
        }
      } else if (result.status === "error") {
        setRemoteError(result.message)
      } else {
        setRemoteError(result.reason)
      }
    } catch (error: any) {
      console.error("[CAIS][RemoteRefresh] unexpected error", {
        message: String(error?.message ?? error ?? "reloadRemote failed"),
        error,
      })
      setRemoteError(String(error?.message ?? error ?? "刷新失败"))
    } finally {
      remoteLoadingRef.current = false
      setRemoteLoading(false)
      console.log("[CAIS][RemoteRefresh] finish", { durationMs: Date.now() - startedAt })
    }
  }

  async function loadMoreRemote(): Promise<void> {
    const next = remotePageLimitRef.current + REMOTE_PAGE_STEP
    remotePageLimitRef.current = next
    setRemotePageLimit(next)
    setRemotePage(Math.max(1, Math.ceil(next / REMOTE_PAGE_STEP)))
  }

  async function loadRemoteFavorites(currentSettings = settingsRef.current, search = queryRef.current.trim()): Promise<void> {
    if (!isRemoteSyncConfigured(currentSettings.syncClipboard)) return
    if (remoteFavoritesLoadingRef.current) return
    remoteFavoritesLoadingRef.current = true
    try {
      const result = await queryRemoteHistory(currentSettings.syncClipboard, {
        pageNumber: 1,
        starredOnly: true,
        search: search || undefined,
      })
      if (result.status === "ok") {
        const syncedAt = Date.now()
        setRemoteItems((prev) => {
          const merged = mergeRemoteItems(prev, result.items)
          saveRemoteClipCache(currentSettings.syncClipboard, {
            items: merged,
            page: remotePage,
            hasMore: false,
            lastSyncAt: syncedAt,
          })
          return merged
        })
        setRemoteLastSyncAt(syncedAt)
        if (remoteError) setRemoteError("")
      } else if (result.status === "error") {
        setRemoteError(result.message)
      }
    } finally {
      remoteFavoritesLoadingRef.current = false
    }
  }

  async function syncRemoteIntoLocal(items: RemoteClipItem[], currentSettings = settingsRef.current): Promise<void> {
    if (!items.length) return
    if (!currentSettings.syncClipboard.autoDownload) return
    // 远程优先：同步远程历史只更新远程缓存/已处理标记，不再把远程内容写入本地历史。
    // 否则远程首条会变成本地剪切板记录，和远程记录重复显示。
    const uploaded = loadUploadedKeys()
    const maxAutoDownloadBytes = (currentSettings.syncClipboard.maxAutoDownloadFileSizeMb || 10) * 1024 * 1024
    
    for (const remote of items) {
      if (remote.isDeleted) continue
      const key = remote.profileId || `${remote.type}-${remote.hash}`
      if (!key || uploaded.has(key)) continue
      
      // 对于 File 类型，根据大小决定是否自动下载
      if (remote.type === "File" && remote.hasData) {
        const size = remote.size || 0
        const filterMode = currentSettings.syncClipboard.fileAutoDownloadFilterMode || "disabled"
        const filterExtensions = currentSettings.syncClipboard.fileAutoDownloadExtensions || []
        
        // 检查文件扩展名过滤
        if (!passesFileAutoDownloadFilter(remote.dataName, filterMode, filterExtensions)) {
          console.log("[CAIS][AutoDownload] File skipped (filtered by extension)", {
            profileId: remote.profileId,
            dataName: remote.dataName,
            filterMode,
            filterExtensions,
          })
          markUploaded(key)
          uploaded.add(key)
          continue
        }
        
        if (size > 0 && size <= maxAutoDownloadBytes) {
          // 小于等于限制大小，自动下载
          console.log("[CAIS][AutoDownload] File auto-download", {
            profileId: remote.profileId,
            dataName: remote.dataName,
            size,
            sizeFormatted: formatBytes(size),
          })
          try {
            const dl = await downloadRemoteData(currentSettings.syncClipboard, remote, "binary")
            if (dl.status === "ok" && dl.data) {
              // 下载成功，保存到本地
              await saveRemoteFileToLocal(remote, dl.data, dl.contentDisposition, dl.mimeType)
              console.log("[CAIS][AutoDownload] File saved successfully", { profileId: remote.profileId })
            } else {
              console.warn("[CAIS][AutoDownload] File download failed", {
                profileId: remote.profileId,
                status: dl.status,
                message: dl.status === "error" ? dl.message : undefined,
              })
            }
          } catch (error: any) {
            console.error("[CAIS][AutoDownload] File download error", {
              profileId: remote.profileId,
              error: String(error?.message ?? error),
            })
          }
        } else if (size > maxAutoDownloadBytes) {
          // 大于 10MB，只标记为已知，不自动下载
          console.log("[CAIS][AutoDownload] File skipped (too large)", {
            profileId: remote.profileId,
            dataName: remote.dataName,
            size,
            sizeFormatted: formatBytes(size),
            maxAutoDownload: formatBytes(maxAutoDownloadBytes),
          })
        } else {
          // 未知大小，标记为已知
          console.log("[CAIS][AutoDownload] File skipped (unknown size)", {
            profileId: remote.profileId,
            dataName: remote.dataName,
          })
        }
      }
      
      markUploaded(key)
      uploaded.add(key)
    }
  }
  
  // 持久化下载记录
  const REMOTE_FILE_DOWNLOAD_CACHE_KEY = "cais_remote_file_download_cache_v1"
  
  function loadRemoteFileDownloadCache(): Record<string, { downloadedAt: number; path?: string }> {
    const st = (globalThis as any).Storage
    try {
      const raw = st?.get?.(REMOTE_FILE_DOWNLOAD_CACHE_KEY, { shared: true }) ?? st?.getString?.(REMOTE_FILE_DOWNLOAD_CACHE_KEY, { shared: true })
      if (!raw) return {}
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
      return parsed && typeof parsed === "object" ? parsed : {}
    } catch {
      return {}
    }
  }
  
  function saveRemoteFileDownloadCache(cache: Record<string, { downloadedAt: number; path?: string }>): void {
    const st = (globalThis as any).Storage
    try {
      const raw = JSON.stringify(cache)
      if (typeof st?.set === "function") {
        st.set(REMOTE_FILE_DOWNLOAD_CACHE_KEY, raw, { shared: true })
      } else if (typeof st?.setString === "function") {
        st.setString(REMOTE_FILE_DOWNLOAD_CACHE_KEY, raw, { shared: true })
      }
    } catch {}
  }
  
  function markRemoteFileDownloaded(remote: RemoteClipItem, path?: string): void {
    const key = remote.profileId || `${remote.type}-${remote.hash}`
    const cache = loadRemoteFileDownloadCache()
    cache[key] = { downloadedAt: Date.now(), path }
    saveRemoteFileDownloadCache(cache)
  }
  
  function isRemoteFileDownloaded(remote: RemoteClipItem): boolean {
    const key = remote.profileId || `${remote.type}-${remote.hash}`
    const cache = loadRemoteFileDownloadCache()
    const entry = cache[key]
    if (!entry) return false
    
    // 如果有路径，使用 existsSync 检查文件是否真的存在
    if (entry.path) {
      const fm = (globalThis as any).FileManager
      if (fm && typeof fm.existsSync === "function") {
        if (!fm.existsSync(entry.path)) {
          // 文件不存在，清除缓存记录
          delete cache[key]
          saveRemoteFileDownloadCache(cache)
          return false
        }
      }
    }
    return true
  }
  
  async function saveRemoteFileToLocal(
    remote: RemoteClipItem,
    data: any,
    contentDisposition?: string,
    mimeType?: string
  ): Promise<string | null> {
    try {
      const fm = (globalThis as any).FileManager
      if (!fm) return null
      
      // 创建下载根目录
      const downloadDir = filesDirectory()
      const ensureDir = typeof fm.createDirectory === "function"
        ? await fm.createDirectory(downloadDir, true).catch(() => false)
        : (typeof fm.createDirectorySync === "function" ? fm.createDirectorySync(downloadDir, true) : false)
      
      // 为每个文件创建独立的子文件夹，格式：类型-哈希（短哈希取前12位）
      const shortHash = (remote.hash || "unknown").slice(0, 12)
      const folderName = safeFileName(`${remote.type}-${shortHash}`)
      const fileDir = joinPath(downloadDir, folderName)
      const ensureFileDir = typeof fm.createDirectory === "function"
        ? await fm.createDirectory(fileDir, true).catch(() => false)
        : (typeof fm.createDirectorySync === "function" ? fm.createDirectorySync(fileDir, true) : false)
      
      // 确定文件名
      let fileName = remote.dataName || "remote-file"
      
      // 如果 dataName 没有扩展名，尝试从 Content-Disposition 或 MIME 类型补充
      if (!getFileExtension(fileName)) {
        // 尝试从 Content-Disposition 获取完整文件名
        const cdName = extractFileNameFromContentDisposition(contentDisposition)
        if (cdName && getFileExtension(cdName)) {
          fileName = cdName
        } else {
          // 根据 MIME 类型添加扩展名
          const ext = guessExtensionFromMimeType(mimeType)
          if (ext) {
            fileName = `${fileName}.${ext}`
          }
        }
      }
      
      const safeName = safeFileName(fileName)
      const filePath = joinPath(fileDir, safeName)
      
      // 写入文件
      await writeDataFile(filePath, data)
      
      // 记录下载状态
      markRemoteFileDownloaded(remote, filePath)
      
      console.log("[CAIS][SaveRemoteFile] File saved", {
        profileId: remote.profileId,
        folder: folderName,
        path: filePath,
        fileName: safeName,
        size: typeof data?.size === "function" ? data.size() : (data?.size ?? data?.length ?? "unknown"),
      })
      return filePath
    } catch (error: any) {
      console.error("[CAIS][SaveRemoteFile] Save error", {
        profileId: remote.profileId,
        error: String(error?.message ?? error),
      })
      return null
    }
  }

  function remoteTextDedupeKey(value: string): string {
    const text = String(value ?? "")
    return text.trim() ? makeRemoteTextProfileId(text) : ""
  }

  function remoteItemDedupeKey(item: RemoteClipItem): string {
    if (item.isDeleted || item.type !== "Text") return ""
    return remoteTextDedupeKey(remoteItemContent(item) || item.fullText || item.text || "")
  }

  function isRemoteTextKnown(text: string): boolean {
    const key = remoteTextDedupeKey(text)
    if (!key) return false
    const cached = loadRemoteClipCache(settingsRef.current.syncClipboard)?.items ?? []
    const candidates = [...remoteItemsRef.current, ...cached]
    return candidates.some((remote) => remoteItemDedupeKey(remote) === key)
  }

  function localClipDedupeKey(item: ClipItem): string {
    if (item.kind === "image") return ""
    return remoteTextDedupeKey(item.content)
  }

  function isLocalShadowedByRemote(item: ClipItem, remoteKeys: Set<string>): boolean {
    const key = localClipDedupeKey(item)
    return Boolean(key && remoteKeys.has(key))
  }

  async function isKnownClipboardText(text: string): Promise<boolean> {
    const content = normalizeClipContent(text)
    if (!remoteTextDedupeKey(content)) return false
    if (isRemoteTextKnown(content)) return true
    const localMatches = await findTextClipsByContent(content)
    return localMatches.length > 0
  }

  async function combinedDuplicateSkipReason(payload: ClipPayload): Promise<string | false> {
    if (payload.kind === "image") return false
    const text = payload.kind === "url" ? (payload.url ?? payload.text ?? "") : (payload.text ?? "")
    return await isKnownClipboardText(text) ? "本地或远程已有相同内容，已跳过采集" : false
  }

  async function readLocalImageUploadData(item: ClipItem): Promise<{ data: any; mimeType: string; name: string; key: string } | null> {
    if (!item.imagePath) return null
    const fm = (globalThis as any).FileManager
    if (!fm) return null
    const exists = typeof fm.exists === "function"
      ? await fm.exists(item.imagePath)
      : (typeof fm.existsSync === "function" ? fm.existsSync(item.imagePath) : true)
    if (!exists) return null
    const stat = typeof fm.stat === "function" ? await fm.stat(item.imagePath).catch(() => null) : null
    const size = Number(stat?.size ?? stat?.fileSize ?? 0) || 0
    const maxBytes = Math.max(1, settingsRef.current.syncClipboard.maxUploadFileSizeMb || 20) * 1024 * 1024
    if (size > maxBytes) {
      showToast(`图片超过 ${settingsRef.current.syncClipboard.maxUploadFileSizeMb}MB，已跳过上传`)
      return null
    }
    const data = typeof fm.readAsData === "function"
      ? await fm.readAsData(item.imagePath)
      : null
    if (!data) return null
    const mimeType = typeof fm.mimeType === "function" ? (fm.mimeType(item.imagePath) || "image/png") : "image/png"
    const name = item.imagePath.split("/").pop() || `${item.id}.png`
    let key = `Image-${item.contentHash}`
    try {
      key = makeRemoteFileProfileId("Image", name, data)
    } catch {
      // If Crypto is unavailable at this point, keep the old local key so upload
      // can fail with the clearer hash error inside uploadLocalToRemote.
    }
    return { data, mimeType, name, key }
  }

  async function tryAutoUpload(item: ClipItem | null | undefined, target: "history" | "current" = "history"): Promise<{ status: "ok" | "duplicate" | "skipped" | "error"; message?: string }> {
    if (!item) return { status: "skipped", message: "没有可上传的条目" }
    if (item.source === "remote") return { status: "skipped", message: "远程同步条目不再回传" }
    const cur = settingsRef.current
    if (!isRemoteSyncConfigured(cur.syncClipboard)) return { status: "skipped", message: "远程同步未启用" }
    if (!cur.syncClipboard.autoUpload) return { status: "skipped", message: "自动上传已关闭" }
    if (item.kind === "image") {
      if (!cur.syncClipboard.uploadSingleFile) return { status: "skipped", message: "图片上传已关闭" }
      const upload = await readLocalImageUploadData(item)
      if (!upload) {
        console.error("[CAIS][ImageUpload] 图片读取失败或超出大小限制", {
          itemId: item.id,
          kind: item.kind,
          imagePath: item.imagePath,
          title: item.title,
          contentHash: item.contentHash,
        })
        return { status: "error", message: "图片读取失败或超出大小限制" }
      }
      if (target !== "current" && isAlreadyUploaded(upload.key)) return { status: "skipped", message: "图片已上传过" }
      try {
        console.error("[CAIS][ImageUpload] 准备上传图片", {
          key: upload.key,
          name: upload.name,
          mimeType: upload.mimeType,
          size: typeof upload.data?.length === "number" ? upload.data.length : undefined,
          itemId: item.id,
          imagePath: item.imagePath,
        })
        const outcome = target === "current"
          ? await uploadCurrentClipboardToRemote(cur.syncClipboard, {
              type: "Image",
              text: upload.name || item.title || "图片",
              data: upload.data,
              dataName: upload.name,
              dataMimeType: upload.mimeType,
            })
          : await uploadLocalToRemote(cur.syncClipboard, {
              type: "Image",
              // 官方客户端图片历史记录的 text 通常是显示名/数据名；不要只传“图片”，
              // 否则服务端用 metadata 构造 ImageProfile 时可能缺少可用的数据名。
              text: upload.name || item.title || "图片",
              data: upload.data,
              dataName: upload.name,
              dataMimeType: upload.mimeType,
            })
        if (outcome.status === "ok") {
          markUploaded(upload.key)
          if (outcome.item.profileId) markUploaded(outcome.item.profileId)
          rememberRemoteItem(outcome.item)
          return { status: "ok" }
        }
        if (target !== "current" && outcome.status === "duplicate") {
          markUploaded(upload.key)
          return { status: "duplicate" }
        }
        console.error("[CAIS][ImageUpload] 图片上传失败", {
          key: upload.key,
          outcome,
          itemId: item.id,
          imagePath: item.imagePath,
          name: upload.name,
          mimeType: upload.mimeType,
        })
        return { status: "error", message: outcome.status === "skipped" ? outcome.reason : "图片上传失败" }
      } catch (error: any) {
        console.error("[CAIS][ImageUpload] 图片上传异常", {
          itemId: item.id,
          imagePath: item.imagePath,
          name: upload.name,
          mimeType: upload.mimeType,
          error,
          message: String(error?.message ?? error ?? "图片上传失败"),
        })
        return { status: "error", message: String(error?.message ?? error ?? "图片上传失败") }
      }
    }
    if (!cur.syncClipboard.uploadText) return { status: "skipped", message: "文字上传已关闭" }
    const text = await getFullClipContent(item.id).catch(() => item.content)
    const trimmed = (text || "").trim()
    if (!trimmed) return { status: "skipped", message: "没有可上传内容" }
    const key = makeRemoteTextProfileId(text)
    if (target !== "current" && (isAlreadyUploaded(key) || isRemoteTextKnown(text))) {
      markUploaded(key)
      return { status: "skipped", message: "远程已有相同内容" }
    }
    try {
      const outcome = target === "current"
        ? await uploadCurrentClipboardToRemote(cur.syncClipboard, { type: "Text", text })
        : await uploadLocalToRemote(cur.syncClipboard, { type: "Text", text })
      if (outcome.status === "ok") {
        markUploaded(key)
        if (outcome.item.profileId) markUploaded(outcome.item.profileId)
        rememberRemoteItem(outcome.item)
        return { status: "ok" }
      }
      if (target !== "current" && outcome.status === "duplicate") {
        markUploaded(key)
        return { status: "duplicate" }
      }
      return { status: "error", message: outcome.status === "skipped" ? outcome.reason : "文本上传失败" }
    } catch (error: any) {
      return { status: "error", message: String(error?.message ?? error ?? "文本上传失败") }
    }
  }

  async function addMemoGroup(): Promise<KeyboardMemoGroup | null> {
    const result = await Navigation.present<MemoGroupEditorResult | null>({
      element: <MemoGroupEditorView />,
      modalPresentationStyle: "pageSheet",
    })
    if (!result) return null
    const name = String(result.title ?? "").trim()
    if (!name) return null
    const now = Date.now()
    const latestGroups = memoGroupsRef.current
    const group = {
      id: createMemoId(),
      title: name,
      color: result.color || DEFAULT_MEMO_GROUP_COLOR,
      lineStyle: DEFAULT_MEMO_GROUP_LINE_STYLE,
      sortOrder: latestGroups.length,
      createdAt: now,
      updatedAt: now,
      memos: [],
    }
    const next = [...latestGroups, group]
    await saveMemoGroups(next)
    showToast("已新建列表")
    return group
  }

  async function editMemoGroup(group: KeyboardMemoGroup) {
    const result = await Navigation.present<MemoGroupEditorResult | null>({
      element: <MemoGroupEditorView group={group} />,
      modalPresentationStyle: "pageSheet",
    })
    if (!result) return
    const name = String(result.title ?? "").trim()
    if (!name) return
    const now = Date.now()
    const latestGroups = memoGroupsRef.current
    const next = latestGroups.map((item) => item.id === group.id ? {
      ...item,
      title: name,
      color: result.color || DEFAULT_MEMO_GROUP_COLOR,
      updatedAt: now,
    } : item)
    await saveMemoGroups(next)
    showToast("已保存列表")
  }

  async function renameMemoGroup(group: KeyboardMemoGroup) {
    await editMemoGroup(group)
  }

  async function deleteMemoGroup(group: KeyboardMemoGroup) {
    const latestGroups = memoGroupsRef.current
    const latestGroup = latestGroups.find((item) => item.id === group.id) ?? group
    const memoCount = latestGroup.memos.length
    
    let choice: MemoGroupDeleteChoice | null = null
    
    if (!memoCount) {
      // 没有 memo，直接确认删除
      const confirmed = await Dialog.confirm({
        title: "删除列表？",
        message: `确认删除「${latestGroup.title}」？`,
        cancelLabel: "取消",
        confirmLabel: "删除",
      })
      if (!confirmed) return
      choice = "withMemos"
    } else {
      // 有 memo，弹出选择弹窗
      const actions = [
        { label: "仅删除分组，保留 Memo" },
        { label: "删除分组和所有内容", destructive: true },
      ]
      const actionIndex = await Dialog.actionSheet({
        title: `删除「${latestGroup.title}」？`,
        message: `此列表中有 ${memoCount} 条 Memo，请选择删除方式。`,
        actions,
      })
      if (actionIndex == null) return
      choice = actionIndex === 0 ? "groupOnly" : "withMemos"
    }
    
    const now = Date.now()
    const remaining = latestGroups.filter((item) => item.id !== latestGroup.id)
    if (choice === "groupOnly" && memoCount) {
      let targetGroups = remaining
      if (!targetGroups.length) {
        targetGroups = [{
          id: createMemoId(),
          title: "其他",
          color: DEFAULT_MEMO_GROUP_COLOR,
          lineStyle: DEFAULT_MEMO_GROUP_LINE_STYLE,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
          memos: [],
        }]
      }
      const targetId = targetGroups[0].id
      const next = targetGroups.map((item) => item.id === targetId ? {
        ...item,
        updatedAt: now,
        memos: [...item.memos, ...latestGroup.memos].map((memo, index) => ({ ...memo, sortOrder: index })),
      } : item)
      await saveMemoGroups(next)
      showToast(`已删除列表，Memo 已移至「${targetGroups[0].title}」`)
      return
    }
    await saveMemoGroups(remaining)
    showToast(latestGroup.memos.length ? "已删除列表和所有内容" : "已删除列表")
  }

  async function presentMemoEditor(options: { group?: KeyboardMemoGroup; memo?: KeyboardMemoItem } = {}) {
    if (!memoGroupsRef.current.length) {
      const group = await addMemoGroup()
      if (group) await presentMemoEditor({ group })
      return
    }
    const result = await Navigation.present<(MemoEditorResult & { createGroup?: undefined }) | { createGroup: string; draft?: any; memo?: KeyboardMemoItem } | null>({
      element: <MemoEditorView memo={options.memo} groups={memoGroupsRef.current} defaultGroupId={options.group?.id ?? memoGroupsRef.current[0]?.id} />,
      modalPresentationStyle: "pageSheet",
    })
    if (!result) return
    const latestGroups = memoGroupsRef.current
    if ((result as any).createGroup) {
      const name = String((result as any).createGroup).trim()
      if (!name) return
      const now = Date.now()
      const newGroup = {
        id: createMemoId(),
        title: name,
        color: DEFAULT_MEMO_GROUP_COLOR,
        lineStyle: DEFAULT_MEMO_GROUP_LINE_STYLE,
        sortOrder: latestGroups.length,
        createdAt: now,
        updatedAt: now,
        memos: [],
      }
      const next = [...latestGroups, newGroup]
      await saveMemoGroups(next)
      showToast("已新建列表，请再次点 + 添加 Memo")
      return
    }
    const payload = result as MemoEditorResult
    const now = Date.now()
    const targetGroupId = payload.groupId || options.group?.id || latestGroups[0]?.id
    const memoPayload: KeyboardMemoItem = {
      id: options.memo?.id ?? createMemoId(),
      kind: payload.kind,
      title: payload.title || undefined,
      text: payload.text.trim(),
      insertPosition: payload.insertPosition,
      enableSubfields: payload.enableSubfields,
      sortOrder: options.memo?.sortOrder ?? (payload.insertPosition === "start" ? 0 : Number.MAX_SAFE_INTEGER),
      createdAt: options.memo?.createdAt ?? now,
      updatedAt: now,
    }
    const next = latestGroups.map((group) => {
      const originalIndex = group.memos.findIndex((m) => m.id === options.memo?.id)
      const withoutEditing = options.memo ? group.memos.filter((m) => m.id !== options.memo!.id) : group.memos
      if (group.id !== targetGroupId) return { ...group, memos: withoutEditing }
      let memos: KeyboardMemoItem[]
      if (options.memo && group.id === options.group?.id && originalIndex >= 0) {
        memos = withoutEditing.slice()
        memos.splice(Math.min(originalIndex, memos.length), 0, memoPayload)
      } else {
        memos = payload.insertPosition === "start" ? [memoPayload, ...withoutEditing] : [...withoutEditing, memoPayload]
      }
      memos = memos.map((memo, index) => ({ ...memo, sortOrder: index }))
      return { ...group, updatedAt: now, memos }
    })
    await saveMemoGroups(next)
    showToast(options.memo ? "已保存" : "已添加 Memo")
  }

  async function addMemoToGroup(group: KeyboardMemoGroup) {
    await presentMemoEditor({ group })
  }

  async function editMemo(group: KeyboardMemoGroup, memo: KeyboardMemoItem) {
    await presentMemoEditor({ group, memo })
  }

  async function deleteMemo(group: KeyboardMemoGroup, memo: KeyboardMemoItem) {
    const ok = await Dialog.confirm({ title: "删除 Memo？", message: memoTitle(memo), cancelLabel: "取消", confirmLabel: "删除" })
    if (!ok) return
    const now = Date.now()
    const next = memoGroupsRef.current.map((item) => item.id === group.id ? {
      ...item,
      updatedAt: now,
      memos: item.memos.filter((m) => m.id !== memo.id),
    } : item)
    await saveMemoGroups(next)
    showToast("已删除 Memo")
  }

  async function reorderMemoGroup(group: KeyboardMemoGroup, indices: number[], newOffset: number) {
    const reordered = reorderedItems(sortedMemos(group), indices, newOffset)
    const now = Date.now()
    const next = memoGroups.map((item) => item.id === group.id ? {
      ...item,
      updatedAt: now,
      memos: reordered.map((memo, index) => ({ ...memo, sortOrder: index })),
    } : item)
    await saveMemoGroups(next)
    showToast("已调整顺序")
  }

  async function reorderMemoGroups(indices: number[], newOffset: number) {
    const reordered = reorderedItems(sortedMemoGroups(memoGroups), indices, newOffset)
    const now = Date.now()
    await saveMemoGroups(reordered.map((group, index) => ({ ...group, sortOrder: index, updatedAt: now })))
    showToast("已调整列表顺序")
  }

  function reorderAIAssistants(indices: number[], newOffset: number) {
    const reordered = reorderAssistants(aiSettings.assistants, indices, newOffset)
    saveAISettings({ ...aiSettings, assistants: reordered })
    showToast("已调整顺序")
  }

  async function copyMemo(memo: KeyboardMemoItem) {
    await writeTextToPasteboard(renderMemoOutput(memo))
    showToast("已复制")
  }

  async function copySelectedMemos() {
    const selected = sortedMemoGroups(memoGroups)
      .flatMap((group) => sortedMemos(group).map((memo) => ({ group, memo })))
      .filter(({ group, memo }) => selectedMemoKeys.has(memoSelectionKey(group, memo)))
      .map(({ memo }) => renderMemoOutput(memo))
      .filter((text) => text.trim())
    if (!selected.length) { showToast("请先选择 Memo"); return }
    await writeTextToPasteboard(selected.join("\n"))
    showToast(`已复制 ${selected.length} 条 Memo`)
  }

  async function deleteSelectedMemos() {
    const count = selectedMemoKeys.size
    if (!count) { showToast("请先选择 Memo"); return }
    const ok = await Dialog.confirm({ title: `删除 ${count} 条 Memo？`, message: "此操作无法撤销。", cancelLabel: "取消", confirmLabel: "删除" })
    if (!ok) return
    const now = Date.now()
    const next = memoGroups.map((group) => ({ ...group, updatedAt: now, memos: group.memos.filter((memo) => !selectedMemoKeys.has(memoSelectionKey(group, memo))) }))
    await saveMemoGroups(next)
    exitBulkSelection()
    showToast(`已删除 ${count} 条 Memo`)
  }

  function selectedClipEntries(): UniversalClipItem[] {
    return filteredUniversalItems().filter((entry) => selectedClipKeys.has(entry.origin === "remote" ? remoteSelectionKey(entry.item) : localSelectionKey(entry.item)))
  }

  async function copySelectedClips() {
    const entries = selectedClipEntries()
    if (!entries.length) { showToast("请先选择剪切板"); return }
    const textParts: string[] = []
    let imageCopied = false
    for (const entry of entries) {
      if (entry.origin === "local") {
        if (entry.item.kind === "image") {
          if (!imageCopied) { await copyItem(entry.item); imageCopied = true }
        } else {
          textParts.push(renderClipOutput(entry.item, await getFullClipContent(entry.item.id)))
        }
      } else if (entry.item.type === "Text") {
        const text = await remoteTextSource(entry.item)
        if (text.trim()) textParts.push(text)
      } else if (entry.item.type === "Image" && !imageCopied) {
        await copyRemoteItem(entry.item)
        imageCopied = true
      }
    }
    if (textParts.length) {
      await writeTextToPasteboard(textParts.join("\n"))
      showToast(`已复制 ${textParts.length} 条文本`)
    } else if (imageCopied) showToast("已复制图片")
    else showToast("选中内容暂不支持复制")
  }

  async function selectedClipTextSource(): Promise<string> {
    const parts: string[] = []
    for (const entry of selectedClipEntries()) {
      if (entry.origin === "local" && entry.item.kind !== "image") {
        parts.push(renderClipOutput(entry.item, await getFullClipContent(entry.item.id)))
      } else if (entry.origin === "remote" && entry.item.type === "Text") {
        const text = await remoteTextSource(entry.item)
        if (text.trim()) parts.push(text)
      }
    }
    return parts.join("\n")
  }

  function selectedMemoTextSource(): string {
    return sortedMemoGroups(memoGroups)
      .flatMap((group) => sortedMemos(group).map((memo) => ({ group, memo })))
      .filter(({ group, memo }) => selectedMemoKeys.has(memoSelectionKey(group, memo)))
      .map(({ memo }) => renderMemoOutput(memo))
      .filter((text) => text.trim())
      .join("\n")
  }

  async function runBulkBuiltinAction(action: KeyboardMenuBuiltinAction) {
    try {
      if (action === "tokenize") {
        await openBulkTokenResult()
        return
      }
      const source = bulkSelectionMode === "memos" ? selectedMemoTextSource() : await selectedClipTextSource()
      if (!source.trim()) { showToast("选中内容没有可处理的文本"); return }
      const result = applyBuiltinMenuAction({ action, source, isImage: false })
      if (!result) { showToast("当前选择不支持该功能"); return }
      await copyMenuResult(result, source)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? `${menuBuiltinTitle(action)}失败`) })
    }
  }

  async function runBulkCustomAction(action: KeyboardCustomAction) {
    try {
      const source = bulkSelectionMode === "memos" ? selectedMemoTextSource() : await selectedClipTextSource()
      if (!source.trim()) { showToast("选中内容没有可处理的文本"); return }
      const result = applyCustomMenuAction(action, source)
      if (!result) { showToast("当前选择不支持该自定义功能"); return }
      await copyMenuResult(result, source)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "自定义功能执行失败") })
    }
  }

  async function openBulkTokenResult() {
    try {
      const source = bulkSelectionMode === "memos" ? selectedMemoTextSource() : await selectedClipTextSource()
      if (!source.trim()) { showToast("选中内容没有可处理的文本"); return }
      const tokens = tokenizeWords(source)
      if (!tokens.length) { showToast("没有可用的分词结果"); return }
      const result = await Navigation.present<string | null>({
        element: <AppTokenResultView tokens={tokens} />,
        modalPresentationStyle: "pageSheet",
      })
      if (!result) return
      await writeTextToPasteboard(result)
      await addClipFromPayload({ kind: "text", text: result }, { ...settingsRef.current, captureText: true })
      showToast("已复制")
      await refresh()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "分词失败") })
    }
  }

  async function handleBulkActionSelection(value: string, mode: BulkSelectionMode) {
    setBulkActionSelection("__none__")
    const count = mode === "clips" ? selectedClipCount() : selectedMemoCount()
    if (!count) {
      showToast(mode === "clips" ? "请先选择剪切板" : "请先选择 Memo")
      return
    }
    if (value === "copy") {
      if (mode === "clips") await copySelectedClips()
      else await copySelectedMemos()
      return
    }
    if (value === "delete") {
      if (mode === "clips") await deleteSelectedClips()
      else await deleteSelectedMemos()
      return
    }
    if (value.startsWith("builtin:")) {
      await runBulkBuiltinAction(value.slice("builtin:".length) as KeyboardMenuBuiltinAction)
      return
    }
    if (value.startsWith("custom:")) {
      const custom = settings.keyboardMenu.customActions.find((action) => action.id === value.slice("custom:".length))
      if (custom) await runBulkCustomAction(custom)
    }
  }

  function bulkBuiltinSupported(action: KeyboardMenuBuiltinAction, mode: BulkSelectionMode): boolean {
    if (!settings.keyboardMenu.builtins[action]) return false
    if (action === "tokenize") return true
    if (action === "base64Encode") return true
    if (action === "openUrl") return mode === "clips" ? selectedClipEntries().length === 1 : selectedMemoCount() === 1
    return true
  }

  async function deleteSelectedClips() {
    const entries = selectedClipEntries()
    if (!entries.length) { showToast("请先选择剪切板"); return }
    const ok = await Dialog.confirm({ title: `删除 ${entries.length} 条剪切板？`, message: "会删除选中的本地/远程记录。此操作无法撤销。", cancelLabel: "取消", confirmLabel: "删除" })
    if (!ok) return
    showToast("正在删除...")

    const localEntries = entries.filter((e): e is Extract<UniversalClipItem, { origin: "local" }> => e.origin === "local")
    const remoteEntries = entries.filter((e): e is Extract<UniversalClipItem, { origin: "remote" }> => e.origin === "remote")

    // 本地逐条删除（SQLite 操作，快速）
    for (const entry of localEntries) {
      await softDeleteClip(entry.item)
    }

    // 远程并发删除：所有 PATCH 请求同时发出
    if (remoteEntries.length > 0) {
      const sync = settingsRef.current.syncClipboard
      const results = await Promise.allSettled(
        remoteEntries.map(async (entry) => {
          const result = await deleteRemoteRecord(sync, entry.item.type, entry.item.hash, entry.item.version)
          return { entry, result }
        })
      )

      // 收集成功删除的 key 和需要清理本地的文本
      const deletedRemoteKeys = new Set<string>()
      const textsToLocalDelete: string[] = []
      for (const settled of results) {
        if (settled.status === "fulfilled" && settled.value.result.status === "ok") {
          const { entry } = settled.value
          deletedRemoteKeys.add(remoteSelectionKey(entry.item))
          if (entry.item.type === "Text") {
            const text = remoteItemContent(entry.item)
            if (text.trim()) textsToLocalDelete.push(text)
          }
        }
      }

      // 批量从远程列表中移除已删除项
      if (deletedRemoteKeys.size > 0) {
        setRemoteItems((prev) => prev.filter((item) => !deletedRemoteKeys.has(remoteSelectionKey(item))))
      }

      // 批量清理本地相同文本的记录
      for (const text of textsToLocalDelete) {
        await deleteClipboardTextClipsByContent(text)
      }
    }

    exitBulkSelection()
    await refresh(true)
    showToast(`已删除 ${entries.length} 条`)
  }

  async function syncNowFromSettings(): Promise<void> {
    const cur = settingsRef.current
    if (!isRemoteSyncConfigured(cur.syncClipboard)) {
      await Dialog.alert({ title: "同步未启用", message: "请先填写服务器地址并启用同步。" })
      return
    }
    showToast("正在同步...")
    // 拉一次远端
    await reloadRemote(cur)
    // 主动上传本地未同步项：最新且比远端新的推送为当前剪切板，其余进入历史记录
    await tryAutoUploadPending(clipboardGroups, cur, true)
    showToast("同步完成")
  }

  async function clearRemoteFromSettings(): Promise<void> {
    const cur = settingsRef.current
    if (!isRemoteSyncConfigured(cur.syncClipboard)) {
      await Dialog.alert({ title: "同步未启用", message: "请先填写服务器地址并启用同步。" })
      return
    }
    const ok = await Dialog.confirm({
      title: "清空远程历史？",
      message: "只会调用服务端 DELETE /api/history/clear，不会清理本地剪贴板历史。此操作无法撤销。",
      cancelLabel: "取消",
      confirmLabel: "清空",
    })
    if (!ok) return
    showToast("正在清空远程...")
    const result = await clearRemoteHistory(cur.syncClipboard)
    if (result.status === "ok") {
      setRemoteItems([])
      setRemotePage(0)
      setRemoteLastSyncAt(Date.now())
      showToast("远程剪贴板历史已清空")
    } else {
      await Dialog.alert({ title: "清空失败", message: result.message })
    }
  }

  async function showRemoteStatsFromSettings(): Promise<void> {
    const cur = settingsRef.current
    if (!isRemoteSyncConfigured(cur.syncClipboard)) {
      await Dialog.alert({ title: "同步未启用", message: "请先填写服务器地址并启用同步。" })
      return
    }
    showToast("正在加载...")
    const result = await getRemoteStatistics(cur.syncClipboard)
    if (result.status === "ok") {
      const s = result.stats
      const lines = [
        `总数：${s.totalCount}`,
        s.textCount ? `文本：${s.textCount}` : null,
        s.imageCount ? `图片：${s.imageCount}` : null,
        s.fileCount ? `文件：${s.fileCount}` : null,
        s.groupCount ? `分组：${s.groupCount}` : null,
        s.totalSize ? `总大小：${formatBytes(s.totalSize)}` : null,
      ].filter(Boolean).join("\n")
      await Dialog.alert({ title: "远程统计", message: lines || "服务端未返回统计信息" })
    } else {
      await Dialog.alert({ title: "获取统计失败", message: result.message })
    }
  }

  async function ensureRemoteImageCached(remote: RemoteClipItem): Promise<string | undefined> {
    if (remote.type !== "Image") return undefined
    const key = remoteImageCacheKey(remote)
    const cached = remoteImageCache[key]
    if (cached?.path) return cached.path
    if (cached?.loading) return undefined
    setRemoteImageCache((prev) => ({ ...prev, [key]: { ...prev[key], loading: true, error: undefined } }))
    try {
      await ensureAppDirectories()
      const path = joinPath(imageDirectory(), `remote-${safeFileName(remote.hash || key)}-${remoteImageFileName(remote)}`)
      const fm = (globalThis as any).FileManager
      let exists = false
      try {
        exists = typeof fm?.exists === "function"
          ? await fm.exists(path)
          : Boolean(typeof fm?.existsSync === "function" && fm.existsSync(path))
      } catch {
        exists = false
      }
      let imagePath = exists ? path : undefined
      if (!imagePath) {
        const dl = await downloadRemoteData(settingsRef.current.syncClipboard, remote, "binary")
        if (dl.status !== "ok" || !dl.data) {
          const message = dl.status === "error" ? dl.message : "图片数据为空"
          setRemoteImageCache((prev) => ({ ...prev, [key]: { loading: false, error: message } }))
          return undefined
        }
        const dataClass = (globalThis as any).Data
        const data = dataClass && dl.data instanceof dataClass
          ? dl.data
          : typeof dataClass?.fromArrayBuffer === "function" && dl.data instanceof ArrayBuffer
            ? dataClass.fromArrayBuffer(dl.data)
            : typeof dataClass?.fromUint8Array === "function" && dl.data instanceof Uint8Array
              ? dataClass.fromUint8Array(dl.data)
              : null
        if (!data) {
          setRemoteImageCache((prev) => ({ ...prev, [key]: { loading: false, error: "图片数据无法读取" } }))
          return undefined
        }
        await writeDataFile(path, data)
        imagePath = path
        const imageClass = (globalThis as any).UIImage
        const image = typeof imageClass?.fromData === "function" ? imageClass.fromData(data) : null
        const thumbData = image ? makeThumbnailData(image) : null
        const thumbPath = thumbnailPathForImagePath(path)
        if (thumbData && thumbPath) {
          try { await writeDataFile(thumbPath, thumbData) } catch { }
        }
      }
      const previewPath = thumbnailPathForImagePath(imagePath) || imagePath
      let finalPreviewPath = imagePath
      try {
        finalPreviewPath = previewPath && (typeof fm?.exists === "function" ? await fm.exists(previewPath) : (typeof fm?.existsSync === "function" && fm.existsSync(previewPath)))
          ? previewPath
          : imagePath
      } catch {
        finalPreviewPath = imagePath
      }
      setRemoteImageCache((prev) => ({ ...prev, [key]: { path: imagePath, previewPath: finalPreviewPath, loading: false } }))
      return imagePath
    } catch (error: any) {
      setRemoteImageCache((prev) => ({ ...prev, [key]: { loading: false, error: String(error?.message ?? error ?? "图片加载失败") } }))
      return undefined
    }
  }

  async function viewRemoteImage(remote: RemoteClipItem): Promise<void> {
    const path = await ensureRemoteImageCached(remote)
    if (!path) {
      showToast("图片加载失败")
      return
    }
    await Navigation.present({
      element: <RemoteImageViewerView title={remoteImageTitle(remote)} imagePath={path} />,
      modalPresentationStyle: "pageSheet",
    })
  }

  async function copyRemoteItem(remote: RemoteClipItem): Promise<void> {
    try {
      if (remote.type === "Image") {
        const path = await ensureRemoteImageCached(remote)
        if (!path) {
          showToast("图片加载失败")
          return
        }
        const uiImage = (globalThis as any).UIImage
        const image = typeof uiImage?.fromFile === "function" ? uiImage.fromFile(path) : null
        if (!image) {
          showToast("图片文件不可读取")
          return
        }
        await writeImageToPasteboard(image)
        const key = remote.profileId || `${remote.type}-${remote.hash}`
        markUploaded(key)
        showToast("已复制")
        await refresh(true)
        return
      }
      if (remote.type !== "Text") {
        showToast("这条远端记录暂不支持复制")
        return
      }
      let text = remoteItemContent(remote)
      if ((!text || (remote.hasData && remote.size && remote.size > 0 && text.length < remote.size / 4)) && remote.hasData) {
        const dl = await downloadRemoteData(settingsRef.current.syncClipboard, remote, "text")
        if (dl.status === "ok" && typeof dl.text === "string") text = dl.text
      }
      if (!text) {
        showToast("这条远端记录不是纯文本，暂不支持复制")
        return
      }
      await writeTextToPasteboard(text)
      showToast("已复制")
      // 远程优先：复制远程文本只写系统剪贴板，不再落入本地历史。
      // writeTextToPasteboard 会记录自写入，后续剪贴板监听也会忽略这次变更。
      const key = remote.profileId || `${remote.type}-${remote.hash}`
      markUploaded(key)
      await refresh(true)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "复制失败") })
    }
  }

  async function remoteTextSource(remote: RemoteClipItem): Promise<string> {
    console.log("[CAIS][RemoteTextSource] start", debugRemoteItem(remote))
    if (remote.type !== "Text") {
      console.log("[CAIS][RemoteTextSource] skipped: non-text", debugRemoteItem(remote))
      return ""
    }
    let text = remoteItemContent(remote)
    console.log("[CAIS][RemoteTextSource] initial", {
      profileId: remote.profileId,
      textLength: text?.length ?? 0,
      textHead: text ? text.slice(0, 80) : "",
      hasData: remote.hasData,
      size: remote.size,
      shouldDownload: Boolean((!text || (remote.hasData && remote.size && remote.size > 0 && text.length < remote.size / 4)) && remote.hasData),
    })
    if ((!text || (remote.hasData && remote.size && remote.size > 0 && text.length < remote.size / 4)) && remote.hasData) {
      const dl = await downloadRemoteData(settingsRef.current.syncClipboard, remote, "text")
      console.log("[CAIS][RemoteTextSource] download result", {
        profileId: remote.profileId,
        status: dl.status,
        mimeType: dl.status === "ok" ? dl.mimeType : undefined,
        textLength: dl.status === "ok" && typeof dl.text === "string" ? dl.text.length : undefined,
        textHead: dl.status === "ok" && typeof dl.text === "string" ? dl.text.slice(0, 80) : undefined,
        hasData: dl.status === "ok" ? Boolean(dl.data) : undefined,
        message: dl.status === "error" ? dl.message : undefined,
      })
      if (dl.status === "ok" && typeof dl.text === "string") text = dl.text
    }
    console.log("[CAIS][RemoteTextSource] finish", {
      profileId: remote.profileId,
      finalLength: text?.length ?? 0,
      finalHead: text ? text.slice(0, 80) : "",
    })
    return text || ""
  }

  async function editRemoteItem(remote: RemoteClipItem) {
    if (remote.type === "Image") {
      await viewRemoteImage(remote)
      return
    }
    if (remote.type !== "Text") {
      showToast("当前远程条目不支持编辑")
      return
    }
    try {
      const fullContent = await remoteTextSource(remote)
      const nextContent = await Navigation.present<string | null>({
        element: <ClipContentEditorView content={fullContent} />,
        modalPresentationStyle: "pageSheet",
      })
      if (nextContent == null || nextContent === fullContent) return
      const result = await patchRemoteRecord(settingsRef.current.syncClipboard, remote.type, remote.hash, {
        text: nextContent,
        version: remote.version,
      })
      if (result.status === "ok") {
        setRemoteItems((prev) => prev.map((item) => (item.profileId || `${item.type}-${item.hash}`) === (remote.profileId || `${remote.type}-${remote.hash}`) ? result.item : item))
        await addClipFromPayload({ kind: "text", text: nextContent, source: "remote" }, settingsRef.current)
        await refresh(true)
        showToast("已保存")
      } else if (result.status === "conflict") {
        if (result.serverItem) {
          setRemoteItems((prev) => prev.map((item) => (item.profileId || `${item.type}-${item.hash}`) === (remote.profileId || `${remote.type}-${remote.hash}`) ? result.serverItem! : item))
        }
        showToast("远程记录已变化，请重试")
      } else {
        await Dialog.alert({ title: "保存失败", message: result.message })
      }
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "编辑失败") })
    }
  }

  function mergeRemoteFlagResult(current: RemoteClipItem, incoming: RemoteClipItem, patch: { starred?: boolean; pinned?: boolean }): RemoteClipItem {
    const isFlagOnlyPatch = patch.starred != null || patch.pinned != null
    return {
      ...current,
      ...incoming,
      text: incoming.text || current.text,
      fullText: incoming.fullText != null && incoming.fullText !== "" ? incoming.fullText : current.fullText,
      dataName: incoming.dataName ?? current.dataName,
      hasData: incoming.hasData || current.hasData,
      size: incoming.size ?? current.size,
      createTime: incoming.createTime || current.createTime,
      lastModified: isFlagOnlyPatch ? current.lastModified : (incoming.lastModified || current.lastModified),
      lastAccessed: isFlagOnlyPatch ? current.lastAccessed : (incoming.lastAccessed ?? current.lastAccessed),
      starred: incoming.starred ?? patch.starred ?? current.starred,
      pinned: incoming.pinned ?? patch.pinned ?? current.pinned,
      version: incoming.version ?? current.version,
      fetchedAt: incoming.fetchedAt || Date.now(),
    }
  }

  async function toggleRemoteFlag(remote: RemoteClipItem, flag: "starred" | "pinned") {
    const patch = flag === "starred" ? { starred: !remote.starred, version: remote.version } : { pinned: !remote.pinned, version: remote.version }
    const key = remote.profileId || `${remote.type}-${remote.hash}`
    const previous = remoteItems
    setRemoteItems((prev) => prev.map((item) => (item.profileId || `${item.type}-${item.hash}`) === key
      ? { ...item, ...patch }
      : item))
    const result = await patchRemoteRecord(settingsRef.current.syncClipboard, remote.type, remote.hash, patch)
    if (result.status === "ok") {
      const nextFlagValue = flag === "starred" ? result.item.starred ?? patch.starred : result.item.pinned ?? patch.pinned
      setRemoteItems((prev) => prev.map((item) => (item.profileId || `${item.type}-${item.hash}`) === key ? mergeRemoteFlagResult(item, result.item, patch) : item))
      showToast(flag === "starred" ? (nextFlagValue ? "已收藏" : "已取消收藏") : (nextFlagValue ? "已置顶" : "已取消置顶"))
    } else {
      setRemoteItems(previous)
      if (result.status === "conflict") {
        if (result.serverItem) {
          setRemoteItems((prev) => prev.map((item) => (item.profileId || `${item.type}-${item.hash}`) === key ? mergeRemoteFlagResult(item, result.serverItem!, {}) : item))
        }
        showToast("远程记录已变化，请重试")
      } else {
        await Dialog.alert({ title: "更新失败", message: result.message })
      }
    }
  }

  async function openTokenResultForRemoteItem(remote: RemoteClipItem) {
    if (remote.type !== "Text") {
      showToast("当前条目不支持分词")
      return
    }
    try {
      const source = await remoteTextSource(remote)
      const tokens = tokenizeWords(source)
      if (!tokens.length) {
        showToast("没有可用的分词结果")
        return
      }
      const result = await Navigation.present<string | null>({
        element: <AppTokenResultView tokens={tokens} />,
        modalPresentationStyle: "pageSheet",
      })
      if (!result) return
      await writeTextToPasteboard(result)
      await addClipFromPayload({ kind: "text", text: result }, { ...settingsRef.current, captureText: true })
      showToast("已复制")
      await refresh()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "分词失败") })
    }
  }

  async function runBuiltinActionForRemoteItem(remote: RemoteClipItem, action: KeyboardMenuBuiltinAction) {
    try {
      console.log("[CAIS][RemoteBuiltinAction] start", {
        action,
        item: debugRemoteItem(remote),
      })
      const isImage = remote.type === "Image"
      const imagePath = isImage ? await ensureRemoteImageCached(remote) : undefined
      const source = isImage ? "" : await remoteTextSource(remote)
      console.log("[CAIS][RemoteBuiltinAction] source ready", {
        action,
        profileId: remote.profileId,
        isImage,
        imagePath,
        sourceLength: source.length,
        sourceHead: source.slice(0, 100),
      })
      const result = applyBuiltinMenuAction({ action, source, imagePath, isImage })
      console.log("[CAIS][RemoteBuiltinAction] result", {
        action,
        profileId: remote.profileId,
        resultKind: result?.kind,
        resultTextLength: result?.kind === "text" ? result.text.length : undefined,
        resultTextsCount: result?.kind === "texts" ? result.texts.length : undefined,
      })
      if (!result) {
        showToast("当前条目不支持该功能")
        return
      }
      await copyMenuResult(result, source)
    } catch (error: any) {
      console.error("[CAIS][RemoteBuiltinAction] error", {
        action,
        item: debugRemoteItem(remote),
        message: String(error?.message ?? error ?? `${menuBuiltinTitle(action)}失败`),
        error,
      })
      await Dialog.alert({ message: String(error?.message ?? error ?? `${menuBuiltinTitle(action)}失败`) })
    }
  }

  async function runCustomActionForRemoteItem(remote: RemoteClipItem, action: KeyboardCustomAction) {
    if (remote.type !== "Text") {
      showToast("当前条目不支持该自定义功能")
      return
    }
    try {
      const source = await remoteTextSource(remote)
      const result = applyCustomMenuAction(action, source)
      if (!result) {
        showToast("当前条目不支持该自定义功能")
        return
      }
      await copyMenuResult(result, source)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "自定义功能执行失败") })
    }
  }

  async function remoteTextForLocalDelete(remote: RemoteClipItem): Promise<string> {
    let text = remoteItemContent(remote)
    if ((!text || (remote.hasData && remote.size && remote.size > 0 && text.length < remote.size / 4)) && remote.hasData) {
      const dl = await downloadRemoteData(settingsRef.current.syncClipboard, remote, "text")
      if (dl.status === "ok" && typeof dl.text === "string") text = dl.text
    }
    return text || ""
  }

  async function downloadRemoteFile(remote: RemoteClipItem): Promise<void> {
    if (remote.type !== "File" || !remote.hasData) {
      showToast("该记录不是文件类型或没有数据")
      return
    }
    
    const key = remote.profileId || `${remote.type}-${remote.hash}`
    setRemoteFileDownloadStatus((prev) => ({
      ...prev,
      [key]: { loading: true, error: undefined, savedPath: undefined },
    }))
    
    try {
      const dl = await downloadRemoteData(settingsRef.current.syncClipboard, remote, "binary")
      if (dl.status === "ok" && dl.data) {
        const saved = await saveRemoteFileToLocal(remote, dl.data, dl.contentDisposition, dl.mimeType)
        if (saved) {
          setRemoteFileDownloadStatus((prev) => ({
            ...prev,
            [key]: { loading: false, error: undefined, savedPath: "saved" },
          }))
          showToast(`文件已下载：${remote.dataName || "文件"}`)
        } else {
          setRemoteFileDownloadStatus((prev) => ({
            ...prev,
            [key]: { loading: false, error: "文件保存失败", savedPath: undefined },
          }))
          showToast("文件保存失败")
        }
      } else {
        const message = dl.status === "error" ? dl.message : "下载失败"
        setRemoteFileDownloadStatus((prev) => ({
          ...prev,
          [key]: { loading: false, error: message, savedPath: undefined },
        }))
        showToast(message)
      }
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "下载失败")
      setRemoteFileDownloadStatus((prev) => ({
        ...prev,
        [key]: { loading: false, error: message, savedPath: undefined },
      }))
      showToast(message)
    }
  }

  async function saveRemoteFileAs(remote: RemoteClipItem): Promise<void> {
    if (remote.type !== "File" || !remote.hasData) {
      showToast("该记录不是文件类型或没有数据")
      return
    }

    // 让用户选择保存目录
    const selectedDir = await DocumentPicker.pickDirectory()
    if (!selectedDir) return // 用户取消

    const key = remote.profileId || `${remote.type}-${remote.hash}`
    setRemoteFileDownloadStatus((prev) => ({
      ...prev,
      [key]: { loading: true, error: undefined, savedPath: undefined },
    }))

    try {
      const dl = await downloadRemoteData(settingsRef.current.syncClipboard, remote, "binary")
      if (dl.status === "ok" && dl.data) {
        // 在用户选择的目录下创建子文件夹，格式：类型-哈希（短哈希取前12位）
        const shortHash = (remote.hash || "unknown").slice(0, 12)
        const folderName = safeFileName(`${remote.type}-${shortHash}`)
        const fileDir = joinPath(selectedDir, folderName)
        const fm = (globalThis as any).FileManager
        if (fm) {
          if (typeof fm.createDirectory === "function") {
            await fm.createDirectory(fileDir, true).catch(() => false)
          } else if (typeof fm.createDirectorySync === "function") {
            fm.createDirectorySync(fileDir, true)
          }
        }
        
        // 确定文件名
        let fileName = remote.dataName || "remote-file"
        
        // 如果 dataName 没有扩展名，尝试从 Content-Disposition 或 MIME 类型补充
        if (!getFileExtension(fileName)) {
          const cdName = extractFileNameFromContentDisposition(dl.contentDisposition)
          if (cdName && getFileExtension(cdName)) {
            fileName = cdName
          } else {
            const ext = guessExtensionFromMimeType(dl.mimeType)
            if (ext) {
              fileName = `${fileName}.${ext}`
            }
          }
        }
        
        const safeName = safeFileName(fileName)
        const filePath = joinPath(fileDir, safeName)

        // 写入文件
        await writeDataFile(filePath, dl.data)

        setRemoteFileDownloadStatus((prev) => ({
          ...prev,
          [key]: { loading: false, error: undefined, savedPath: "saved" },
        }))
        showToast(`文件已保存到：${fileDir}`)
      } else {
        const message = dl.status === "error" ? dl.message : "下载失败"
        setRemoteFileDownloadStatus((prev) => ({
          ...prev,
          [key]: { loading: false, error: message, savedPath: undefined },
        }))
        showToast(message)
      }
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "保存失败")
      setRemoteFileDownloadStatus((prev) => ({
        ...prev,
        [key]: { loading: false, error: message, savedPath: undefined },
      }))
      showToast(message)
    }
  }

  async function deleteRemoteItem(remote: RemoteClipItem): Promise<void> {
    const ok = await Dialog.confirm({
      title: "删除远程记录？",
      message: remote.type === "Text"
        ? "会同时删除远端记录和本地相同文本的剪贴板历史。"
        : "会删除远端记录。本地仅同步清理文本记录。",
      cancelLabel: "取消",
      confirmLabel: "删除",
    })
    if (!ok) return
    showToast("正在删除...")
    const result = await deleteRemoteRecord(settingsRef.current.syncClipboard, remote.type, remote.hash, remote.version)
    if (result.status !== "ok") {
      await Dialog.alert({ title: "删除失败", message: result.message })
      return
    }
    setRemoteItems((prev) => prev.filter((item) => (item.profileId || `${item.type}-${item.hash}`) !== (remote.profileId || `${remote.type}-${remote.hash}`)))
    if (remote.type === "Text") {
      const text = remoteItemContent(remote)
      if (text.trim()) await deleteClipboardTextClipsByContent(text)
    }
    await refresh(true)
    showToast("已删除并同步本地")
  }

  function updateSettings(nextSettings: CaisSettings) {
    const next = saveSettings(nextSettings)
    settingsRef.current = next
    setSettings(next)
    void refresh(true, next)
  }

  function clearToastHideTimer() {
    if (toastHideTimer.current) {
      ; (globalThis as any).clearTimeout?.(toastHideTimer.current)
      toastHideTimer.current = null
    }
  }

  function showToast(message: string) {
    clearToastHideTimer()
    setToastMessage(message)
    toastPresented.setValue(false)
      ; (globalThis as any).setTimeout?.(() => {
        toastPresented.setValue(true)
      }, 0)
    toastHideTimer.current = (globalThis as any).setTimeout?.(() => {
      toastPresented.setValue(false)
      toastHideTimer.current = null
    }, TOAST_DURATION_MS)
  }

  function toastOptions() {
    return {
      isPresented: toastPresented,
      message: toastMessage,
      duration: TOAST_DURATION_MS / 1000,
      position: "bottom" as any,
    }
  }

  async function rebuildSpotlightFromApp(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoading(true)
    if (!options.silent) showToast("正在更新 Spotlight 索引...")
    try {
      const count = await rebuildSpotlightIndex(settingsRef.current.maxItems)
      if (!options.silent) showToast(`已索引 ${count} 条剪切板内容`)
    } catch (error: any) {
      if (!options.silent) showToast(`Spotlight 索引失败：${String(error?.message ?? error)}`)
    } finally {
      if (!options.silent) setLoading(false)
    }
  }

  async function captureNow() {
    setLoading(true)
    try {
      const result = await captureCurrentClipboard(settings, { shouldSkipPayload: combinedDuplicateSkipReason })
      const message =
        result.status === "created" ? `已采集：${result.item.title}` :
          result.status === "updated" ? `已更新：${result.item.title}` :
            result.reason
      showToast(message)
      await refresh()
    } catch {
    } finally {
      setLoading(false)
    }
  }

  async function copyItem(item: ClipItem) {
    try {
      const fullContent = renderClipOutput(item, await getFullClipContent(item.id))
      await writeClipToPasteboard(item, fullContent)
      await markCopied(item)
      showToast("已复制")
      await refresh()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "复制失败") })
    }
  }

  async function requestDeleteItem(item: ClipItem) {
    const ok = await Dialog.confirm({
      title: "是否删除？",
      message: item.title,
      cancelLabel: "取消",
      confirmLabel: "删除",
    })
    if (!ok) return
    await softDeleteClip(item)
    await refresh()
  }

  async function requestClear(scope: ClearScope) {
    const ok = await Dialog.confirm({
      title: `清空${clearScopeLabel(scope)}？`,
      message: "此操作无法撤销。",
      cancelLabel: "取消",
      confirmLabel: "清空",
    })
    if (!ok) return
    await clearData(scope)
  }

  function clearScopeLabel(scope: ClearScope): string {
    switch (scope) {
      case "favorites": return "收藏数据"
      case "recent": return "最近内容"
      case "threeDays": return "近三天剪贴板数据"
      case "sevenDays": return "近七天剪贴板数据"
      case "older": return "更早剪贴板数据"
    }
  }

  async function clearData(scope: ClearScope) {
    showToast("正在删除...")
    // Yield to let toast render before blocking on async work
    await new Promise((r) => (globalThis as any).setTimeout?.(r, 50))
    if (scope === "favorites") {
      await clearFavoriteClips()
      showToast("已清空收藏数据")
    } else {
      await clearClipboardClipsByRange(scope)
      showToast("已清空剪贴板数据")
    }
    await refresh()
  }

  async function editItemTitle(item: ClipItem) {
    const title = await Dialog.prompt({
      title: "增加标题",
      message: "留空时继续使用正文内容作为标题。",
      defaultValue: item.title,
      placeholder: "输入标题",
      cancelLabel: "取消",
      confirmLabel: "保存",
      selectAll: true,
    })
    if (title == null) return
    await updateClipTitle(item, title)
    await refresh()
  }

  async function editItem(item: ClipItem) {
    if (item.kind === "image") {
      await Dialog.alert({ message: "图片条目暂不支持编辑文本内容" })
      return
    }
    const fullContent = await getFullClipContent(item.id)
    const initialChangeCount = await currentChangeCount()
    try {
      const nextContent = await Navigation.present<string | null>({
        element: <ClipContentEditorView content={fullContent} />,
        modalPresentationStyle: "pageSheet",
      })
      let needsRefresh = false
      if (await currentChangeCount() !== initialChangeCount) {
        await captureCurrentClipboard(settings, { shouldSkipPayload: combinedDuplicateSkipReason })
        needsRefresh = true
      }
      if (nextContent != null && nextContent !== fullContent) {
        await editClipContent(item, nextContent)
        needsRefresh = true
      }
      if (needsRefresh) await refresh()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "编辑失败") })
    }
  }

  async function viewImageItem(item: ClipItem) {
    await Navigation.present({
      element: <ImageViewerView item={item} />,
      modalPresentationStyle: "pageSheet",
    })
  }

  async function itemSource(item: ClipItem): Promise<string> {
    if (item.kind === "image") return ""
    return renderClipOutput(item, await getFullClipContent(item.id))
  }

  async function openTokenResultForItem(item: ClipItem) {
    if (item.kind === "image") {
      showToast("图片条目不支持分词")
      return
    }
    try {
      const source = await itemSource(item)
      const tokens = tokenizeWords(source)
      if (!tokens.length) {
        showToast("没有可用的分词结果")
        return
      }
      const result = await Navigation.present<string | null>({
        element: <AppTokenResultView tokens={tokens} />,
        modalPresentationStyle: "pageSheet",
      })
      if (!result) return
      await writeTextToPasteboard(result)
      await addClipFromPayload(
        { kind: "text", text: result },
        { ...settingsRef.current, captureText: true },
      )
      showToast("已复制")
      await refresh()
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "分词失败") })
    }
  }

  async function saveTransformedResult(result: MenuActionResult, source: string): Promise<number> {
    const saveSettings = { ...settingsRef.current, captureText: true, captureImages: true }
    if (result.kind === "text") {
      if (!result.text.trim() || result.text === source) return 0
      const saved = await addClipFromPayload({ kind: "text", text: result.text }, saveSettings)
      return saved.status !== "skipped" ? 1 : 0
    }
    if (result.kind === "texts") {
      let savedCount = 0
      for (const text of result.texts) {
        if (!text.trim() || text === source) continue
        const saved = await addClipFromPayload({ kind: "text", text }, saveSettings)
        if (saved.status !== "skipped") savedCount += 1
      }
      return savedCount
    }
    if (result.kind === "image") {
      const saved = await addClipFromPayload({ kind: "image", image: result.image }, saveSettings)
      return saved.status !== "skipped" ? 1 : 0
    }
    return 0
  }

  async function copyMenuResult(result: MenuActionResult, source: string) {
    if (result.kind === "openUrl") {
      await Safari.openURL(result.url)
      return
    }
    if (result.kind === "texts") {
      const saved = await saveTransformedResult(result, source)
      showToast(saved ? `已拆分保存 ${saved} 条` : "没有新的拆分结果")
      await refresh()
      return
    }
    if (result.kind === "text") {
      await writeTextToPasteboard(result.text)
    } else {
      await writeImageToPasteboard(result.image)
    }
    const saved = await saveTransformedResult(result, source)
    showToast(saved ? "已复制并保存" : "已复制")
    await refresh()
  }

  async function runBuiltinActionForItem(item: ClipItem, action: KeyboardMenuBuiltinAction) {
    try {
      const source = await itemSource(item)
      const result = applyBuiltinMenuAction({
        action,
        source,
        imagePath: item.imagePath,
        isImage: item.kind === "image",
      })
      if (!result) {
        showToast("当前条目不支持该功能")
        return
      }
      await copyMenuResult(result, source)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? `${menuBuiltinTitle(action)}失败`) })
    }
  }

  async function runCustomActionForItem(item: ClipItem, action: KeyboardCustomAction) {
    if (item.kind === "image") {
      showToast("当前条目不支持该自定义功能")
      return
    }
    try {
      const source = await itemSource(item)
      const result = applyCustomMenuAction(action, source)
      if (!result) {
        showToast("当前条目不支持该自定义功能")
        return
      }
      await copyMenuResult(result, source)
    } catch (error: any) {
      await Dialog.alert({ message: String(error?.message ?? error ?? "自定义功能执行失败") })
    }
  }

  function startPipMonitor() {
    const status = { active: true, lastMessage: "监听启动中", lastCheckedAt: Date.now(), capturedCount: 0 }
    setMonitorStatus(status)
    writePipControlState({ active: true, command: undefined })
    if (appMonitorStopper) return
    appMonitorStopper = startClipboardMonitor(settings, (next) => {
      setMonitorStatus(next)
      if (next.lastCapturedAt) {
        showToast(next.lastMessage)
        void refresh()
      }
    }, { shouldSkipPayload: combinedDuplicateSkipReason })
  }

  function stopPipMonitor() {
    if (appMonitorStopper) {
      appMonitorStopper()
      appMonitorStopper = null
    } else {
      stopClipboardMonitor()
    }
    setMonitorStatus({ active: false, lastMessage: "监听已停止", lastCheckedAt: Date.now(), capturedCount: 0 })
    writePipControlState({ active: false, command: undefined })
  }

  function togglePip() {
    const next = !pipPresented.value
    pipPresented.setValue(next)
    if (next) {
      startPipMonitor()
    } else {
      stopPipMonitor()
    }
  }

  function deactivatePipFromExternal(options: { exitAfter?: boolean } = {}) {
    pipPresented.setValue(false)
    stopPipMonitor()
    if (options.exitAfter) {
      ; (globalThis as any).setTimeout?.(() => {
        Script.exit()
      }, 250)
    }
  }

  async function minimizeScript() {
    if (!Script.supportsMinimization?.()) {
      return
    }
    try {
      intentionalMinimize = true
      const ok = await Script.minimize()
      if (!ok) intentionalMinimize = false
    } catch (error: any) {
      intentionalMinimize = false
      await Dialog.alert({ message: String(error?.message ?? error ?? "最小化失败") })
    }
  }

  function toggleFullscreenMode() {
    const next = !appFullscreen
    setAppFullscreen(next)
    writeAppFullscreen(next)
    void restartScript()
  }

  async function restartScript() {
    try {
      const url = Script.createRunURLScheme("CAIS", { restart: String(Date.now()) })
      const ok = await Safari.openURL(url)
      if (ok === false) {
        showToast("已保存显示模式，下次运行生效")
        return
      }
      Script.exit()
    } catch {
      showToast("已保存显示模式，下次运行生效")
    }
  }

  async function activatePipFromApp() {
    pipPresented.setValue(true)
    startPipMonitor()
    if (Script.supportsMinimization?.()) {
      ; (globalThis as any).setTimeout?.(() => {
        void (async () => {
          intentionalMinimize = true
          try {
            const ok = await Script.minimize()
            if (!ok) intentionalMinimize = false
          } catch {
            intentionalMinimize = false
          }
        })()
      }, 900)
    }
  }

  function renderClipRow(item: ClipItem, options: { allowDelete: boolean; onAppear?: () => void } = { allowDelete: true }) {
    const selectionKey = localSelectionKey(item)
    const selecting = inClipSelectionMode()
    const selected = selectedSetHas(selectedClipKeys, selectionKey)
    return (
      <HStack
        key={item.id}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        background="rgba(0,0,0,0.001)"
        contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
        listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
        listRowSeparator={{ visibility: "hidden", edges: "all" }}
        listRowBackground={<EmptyView />}
        onAppear={options.onAppear}
        onTapGesture={withHaptic(() => selecting ? toggleClipSelectionKey(selectionKey) : copyItem(item))}
        contextMenu={{
          menuItems: (
            <Group>
              <Button title="增加标题" systemImage="textformat" action={() => void editItemTitle(item)} />
              {item.kind === "image" ? (
                <Button title="查看" systemImage="photo" action={() => void viewImageItem(item)} />
              ) : (
                <Button title="编辑" systemImage="square.and.pencil" action={() => void editItem(item)} />
              )}
              {item.kind !== "image" && settings.keyboardMenu.builtins.tokenize ? (
                <Button title="分词" systemImage="text.magnifyingglass" action={() => void openTokenResultForItem(item)} />
              ) : null}
              {getOrderedMenuBuiltins(settings).map((action) => {
                const enabled = settings.keyboardMenu.builtins[action]
                const supported = action !== "tokenize" && (
                  action === "base64Encode" ||
                  (action === "openUrl" ? item.kind === "url" : item.kind !== "image")
                )
                return enabled && supported ? (
                  <Button
                    key={action}
                    title={menuBuiltinTitle(action)}
                    systemImage={menuBuiltinSystemImage(action)}
                    action={() => void runBuiltinActionForItem(item, action)}
                  />
                ) : null
              })}
              {item.kind !== "image" ? (
                settings.keyboardMenu.customActions
                  .filter((action) => action.enabled)
                  .map((action) => (
                    <Button
                      key={action.id}
                      title={action.title}
                      systemImage={customActionSystemImage(action)}
                      action={() => void runCustomActionForItem(item, action)}
                    />
                  ))
              ) : null}
            </Group>
          ),
        }}
        leadingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            ...(item.manualFavorite ? [] : [
              <Button
                title=""
                systemImage={item.favorite ? "star.slash" : "star"}
                tint="systemYellow"
                action={() => void toggleFavorite(item).then(() => refresh())}
              />,
            ]),
            <Button
              title=""
              systemImage={item.pinned ? "pin.slash" : "pin"}
              tint="systemOrange"
              action={() => void togglePinned(item).then(() => refresh())}
            />,
          ],
        }}
        trailingSwipeActions={options.allowDelete ? {
          allowsFullSwipe: false,
          actions: [
            <Button
              title=""
              systemImage="trash"
              tint="systemRed"
              action={() => void requestDeleteItem(item)}
            />,
          ],
        } : undefined}
      >
        {selecting ? <Image systemName={selected ? "checkmark.circle.fill" : "circle"} font="title3" foregroundStyle={selected ? "systemBlue" : "secondaryLabel"} frame={{ width: 28 }} /> : null}
        <ClipRow item={item} contentLineLimit={settings.appContentLineLimit} />
      </HStack>
    )
  }

  function renderGroupedClipList(groups: ClipGroup[], emptyMessage: string, options: { allowDelete?: (item: ClipItem) => boolean; loadMore?: boolean } = {}) {
    if (!groups.some((group) => group.items.length)) {
      return <EmptyState title="暂无内容" message={emptyMessage} systemImage="doc.on.clipboard" />
    }
    const totalLoaded = groups.reduce((acc, g) => acc + g.items.length, 0)
    const canLoadMore = options.loadMore && totalLoaded >= clipPageLimitRef.current && clipPageLimitRef.current < APP_GROUP_PAGE_SIZE
    return (
      <Group>
        {groups.filter((group) => group.items.length)
          .map((group) => (
            <Section
              key={group.title}
              header={<Text>{group.title}</Text>}
              listSectionSeparator="hidden"
            >
              {group.items.map((item) => renderClipRow(item, { allowDelete: options.allowDelete?.(item) ?? true }))}
            </Section>
          ))}
        {canLoadMore ? (
          <Section listSectionSeparator="hidden">
            <HStack
              frame={{ maxWidth: "infinity", alignment: "center" as any }}
              padding={{ top: 12, bottom: 24 }}
              listRowInsets={{ top: 0, bottom: 0, leading: 12, trailing: 12 }}
              listRowSeparator="hidden"
              listRowBackground={<EmptyView />}
              onAppear={ensureLocalLoadMore}
            >
              <Text font="footnote" foregroundStyle="secondaryLabel">上拉加载更多…</Text>
            </HStack>
          </Section>
        ) : null}
      </Group>
    )
  }

  function renderRemoteRow(item: RemoteClipItem, options: { onAppear?: () => void } = {}) {
    const selectionKey = remoteSelectionKey(item)
    const selecting = inClipSelectionMode()
    const selected = selectedSetHas(selectedClipKeys, selectionKey)
    const isText = item.type === "Text"
    const isImage = item.type === "Image"
    const cacheKey = remoteImageCacheKey(item)
    const imageCache = remoteImageCache[cacheKey]
    const iconName =
      item.type === "Image" ? "photo" :
        item.type === "File" ? "doc" :
          item.type === "Group" ? "square.stack.3d.up" : "doc.text"
    const ts = settings.remoteTimeDisplay === "createTime"
      ? (item.createTime || item.lastModified || item.fetchedAt)
      : (item.lastModified || item.createTime || item.fetchedAt)
    const fileDownloadKey = item.profileId || `${item.type}-${item.hash}`
    const fileDownloadStatus = remoteFileDownloadStatus[fileDownloadKey]
    const content = isImage
      ? (imageCache?.loading ? "图片加载中…" : (imageCache?.error || "点击查看图片"))
      : (remoteItemContent(item) || item.dataName || "(无预览)")
    const title = isImage ? remoteImageTitle(item) : content
    const fileDownloaded = item.type === "File" && isRemoteFileDownloaded(item)
    const footer = `远程${formatDateTime(ts) ? " · " + formatDateTime(ts) : ""} · ${isText ? "文本" : isImage ? "图片" : item.type}${item.size ? " · " + formatBytes(item.size) : ""}${item.type === "File" ? (fileDownloaded ? " · ✅" : " · ☁️") : ""}`
    return (
      <HStack
        key={item.profileId || `${item.type}-${item.hash}`}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        background="rgba(0,0,0,0.001)"
        contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
        listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
        listRowSeparator={{ visibility: "hidden", edges: "all" }}
        listRowBackground={<EmptyView />}
        onAppear={() => {
          options.onAppear?.()
          if (isImage) void ensureRemoteImageCached(item)
        }}
        onTapGesture={selecting
          ? withHaptic(() => toggleClipSelectionKey(selectionKey))
          : (isText || isImage
            ? withHaptic(() => void runRemoteRowAction(() => copyRemoteItem(item)))
            : undefined)}
        contextMenu={{
          menuItems: (
            <Group>
              {isText ? (
                <Button title="编辑" systemImage="square.and.pencil" action={() => void runRemoteRowAction(() => editRemoteItem(item))} />
              ) : isImage ? (
                <Button title="查看" systemImage="photo" action={() => void runRemoteRowAction(() => viewRemoteImage(item))} />
              ) : null}
              {item.type === "File" && item.hasData ? (
                <Group>
                  {!isRemoteFileDownloaded(item) ? (
                    <Button title="下载" systemImage="arrow.down.circle" action={() => void runRemoteRowAction(() => downloadRemoteFile(item))} />
                  ) : null}
                  <Button title="另存为" systemImage="folder.badge.plus" action={() => void runRemoteRowAction(() => saveRemoteFileAs(item))} />
                </Group>
              ) : null}
              {isText && settings.keyboardMenu.builtins.tokenize ? (
                <Button title="分词" systemImage="text.magnifyingglass" action={() => void runRemoteRowAction(() => openTokenResultForRemoteItem(item))} />
              ) : null}
              {getOrderedMenuBuiltins(settings).map((action) => {
                const enabled = settings.keyboardMenu.builtins[action]
                const supported = action !== "tokenize" && (
                  action === "base64Encode" ||
                  (action === "openUrl" ? isText : isText)
                )
                return enabled && supported ? (
                  <Button
                    key={action}
                    title={menuBuiltinTitle(action)}
                    systemImage={menuBuiltinSystemImage(action)}
                    action={() => void runRemoteRowAction(() => runBuiltinActionForRemoteItem(item, action))}
                  />
                ) : null
              })}
              {isText ? (
                settings.keyboardMenu.customActions
                  .filter((action) => action.enabled)
                  .map((action) => (
                    <Button
                      key={action.id}
                      title={action.title}
                      systemImage={customActionSystemImage(action)}
                      action={() => void runRemoteRowAction(() => runCustomActionForRemoteItem(item, action))}
                    />
                  ))
              ) : null}
            </Group>
          ),
        }}
        leadingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            <Button
              title=""
              systemImage={item.starred ? "star.slash" : "star"}
              tint="systemYellow"
              action={() => void runRemoteRowAction(() => toggleRemoteFlag(item, "starred"))}
            />,
            <Button
              title=""
              systemImage={item.pinned ? "pin.slash" : "pin"}
              tint="systemOrange"
              action={() => void runRemoteRowAction(() => toggleRemoteFlag(item, "pinned"))}
            />,
          ],
        }}
        trailingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            <Button
              title=""
              systemImage="trash"
              tint="systemRed"
              action={() => void runRemoteRowAction(() => deleteRemoteItem(item))}
            />,
          ],
        }}
      >
        {selecting ? <Image systemName={selected ? "checkmark.circle.fill" : "circle"} font="title3" foregroundStyle={selected ? "systemBlue" : "secondaryLabel"} frame={{ width: 28 }} /> : null}
        <ClipboardCard
          title={title}
          content={content}
          footer={footer}
          iconSystemName={iconName}
          iconForegroundStyle={item.starred ? "systemYellow" : (item.pinned ? "systemOrange" : "systemBlue")}
          showFavorite={item.starred}
          showPinned={item.pinned}
          previewPath={isImage ? imageCache?.previewPath : undefined}
          contentLineLimit={Math.max(1, settings.appContentLineLimit)}
        />
      </HStack>
    )
  }

  function networkFilterLabel(filter: NetworkClipFilter): string {
    switch (filter) {
      case "all": return "全部"
      case "text": return "文本"
      case "image": return "图片"
      case "file": return "文件"
      case "verificationCode": return "验证码"
      case "link": return "链接"
    }
  }

  function clipboardSourceLabel(source: ClipboardSourceFilter): string {
    switch (source) {
      case "universal": return "全部来源"
      case "local": return "本地"
      case "remote": return "远程"
    }
  }

  useEffect(() => {
    if (!settings.showRemoteFiles && networkClipFilter === "file") {
      setNetworkClipFilter("all")
    }
  }, [settings.showRemoteFiles, networkClipFilter])

  function filteredRemoteItems(): RemoteClipItem[] {
    const filesVisible = settings.showRemoteFiles
    const search = query.trim().toLowerCase()
    const typeAllowed = (item: RemoteClipItem) => filesVisible || item.type !== "File"
    const queryAllowed = (item: RemoteClipItem) => {
      if (!search) return true
      return [
        remoteItemContent(item),
        item.fullText,
        item.text,
        item.dataName,
        item.type,
        item.hash,
        item.profileId,
      ].some((value) => String(value ?? "").toLowerCase().includes(search))
    }
    const base = remoteItems.filter((item) => typeAllowed(item) && queryAllowed(item))
    switch (networkClipFilter) {
      case "text":
        return base.filter((item) => item.type === "Text")
      case "image":
        return base.filter((item) => item.type === "Image")
      case "file":
        return filesVisible ? base.filter((item) => item.type === "File") : []
      case "verificationCode":
        return base.filter((item) => {
          if (item.type !== "Text") return false
          const text = (remoteItemContent(item) || item.text || "").trim()
          return /^\d{4,6}$/.test(text)
        })
      case "link":
        return base.filter((item) => {
          if (item.type !== "Text") return false
          const text = (remoteItemContent(item) || item.text || "").trim()
          return isLikelyURL(text)
        })
      case "all":
      default:
        return base
    }
  }

  function localClipMatchesNetworkFilter(item: ClipItem): boolean {
    if (item.manualFavorite) return false
    if (networkClipFilter === "file") return false
    if (networkClipFilter === "text") return item.kind !== "image"
    if (networkClipFilter === "image") return item.kind === "image"
    if (networkClipFilter === "verificationCode") {
      if (item.kind === "image") return false
      return /^\d{4,6}$/.test(item.content.trim())
    }
    if (networkClipFilter === "link") {
      if (item.kind === "image") return false
      return item.kind === "url" || isLikelyURL(item.content.trim())
    }
    return true
  }

  function filteredUniversalItems(): UniversalClipItem[] {
    const includeRemote = clipboardSourceFilter !== "local"
    const includeLocal = clipboardSourceFilter !== "remote"
    const visibleRemoteItems = includeRemote ? filteredRemoteItems().slice(0, remotePageLimit) : []
    const remoteList = visibleRemoteItems.map((item) => ({
      origin: "remote" as const,
      key: `remote-${item.profileId || `${item.type}-${item.hash}`}`,
      timestamp: remoteItemTimestamp(item),
      item,
    }))
    const remoteDedupeKeys = clipboardSourceFilter === "universal"
      ? new Set(remoteList.map((entry) => remoteItemDedupeKey(entry.item)).filter(Boolean))
      : new Set<string>()
    const localItems = includeLocal
      ? clipboardGroups
        .flatMap((group) => group.items)
        .filter((item) => {
          if (!localClipMatchesNetworkFilter(item)) return false
          // 通用剪切板里远程记录优先展示：本地复制后会先被采集为“本地”，
          // 自动上传成功/远程刷新后又出现一条“远程”。二者内容相同时只保留远程，
          // 避免用户看到两条完全相同的剪切板。本地模式不做这层去重。
          if (clipboardSourceFilter === "universal" && isLocalShadowedByRemote(item, remoteDedupeKeys)) return false
          return true
        })
        .map((item) => ({
          origin: "local" as const,
          key: `local-${item.id}`,
          timestamp: item.updatedAt || item.createdAt || 0,
          item,
        }))
      : []
    return [...remoteList, ...localItems]
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  function renderUniversalClipRow(entry: UniversalClipItem) {
    if (entry.origin === "remote") return renderRemoteRow(entry.item)
    return renderClipRow(entry.item, { allowDelete: !entry.item.manualFavorite })
  }

  function filteredRemoteFavoriteItems(): RemoteClipItem[] {
    const filesVisible = settings.showRemoteFiles
    const search = query.trim().toLowerCase()
    return remoteItems
      .filter((item) => {
        if (!item.starred) return false
        if (!filesVisible && item.type === "File") return false
        if (!search) return true
        return [
          remoteItemContent(item),
          item.fullText,
          item.text,
          item.dataName,
          item.type,
          item.hash,
          item.profileId,
        ].some((value) => String(value ?? "").toLowerCase().includes(search))
      })
      .sort((a, b) => (b.lastModified || b.createTime || b.fetchedAt || 0) - (a.lastModified || a.createTime || a.fetchedAt || 0))
  }

  function renderFavoriteTabContent() {
    const remoteFavorites = filteredRemoteFavoriteItems()
    const hasLocalFavorites = favoriteGroups.some((group) => group.items.length)
    if (!hasLocalFavorites && !remoteFavorites.length) {
      return (
        <EmptyState
          title="暂无收藏"
          message={query.trim() ? "没有匹配的收藏内容。" : "点击右上角添加常用语，或右滑本地/远程剪切板条目点星标。"}
          systemImage="star"
        />
      )
    }
    return (
      <Group>
        {favoriteGroups.filter((group) => group.items.length).map((group) => (
          <Section
            key={`local-${group.title}`}
            header={<Text>{group.title}</Text>}
            listSectionSeparator="hidden"
          >
            {group.items.map((item) => renderClipRow(item, { allowDelete: true }))}
          </Section>
        ))}
        {remoteFavorites.length ? (
          <Section
            key="remote-favorites"
            header={<Text>远程收藏</Text>}
            listSectionSeparator="hidden"
          >
            {remoteFavorites.map((item) => renderRemoteRow(item))}
          </Section>
        ) : null}
      </Group>
    )
  }

  function renderNetworkFilterPicker() {
    const pickerPadding = { leading: 16, trailing: 16 }
    return (
      <VStack
        spacing={8}
        frame={{ maxWidth: "infinity", alignment: "center" as any }}
        padding={{ top: 10, bottom: 2, leading: 0, trailing: 0 }}
        listRowInsets={{ top: 0, bottom: 0, leading: 0, trailing: 0 }}
        listRowSeparator="hidden"
        listRowBackground={<EmptyView />}
      >
        <ZStack
          frame={{ maxWidth: "infinity", height: 36 }}
          padding={pickerPadding}
          clipShape="capsule"
        >
          <Picker
            title=""
            pickerStyle="segmented"
            value={clipboardSourceFilter}
            onChanged={(value: any) => setClipboardSourceFilter(value as ClipboardSourceFilter)}
            frame={{ maxWidth: "infinity", height: 36 }}
          >
            <Text tag="universal">全部来源</Text>
            <Text tag="local">本地</Text>
            <Text tag="remote">远程</Text>
          </Picker>
        </ZStack>
        <ZStack
          frame={{ maxWidth: "infinity", height: 32 }}
          padding={pickerPadding}
          clipShape="capsule"
        >
          <Picker
            title=""
            pickerStyle="segmented"
            value={networkClipFilter}
            onChanged={(value: any) => setNetworkClipFilter(value as NetworkClipFilter)}
            frame={{ maxWidth: "infinity", height: 32 }}
          >
            <Text tag="all">全部</Text>
            <Text tag="text">文本</Text>
            <Text tag="image">图片</Text>
            <Text tag="verificationCode">验证码</Text>
            <Text tag="link">链接</Text>
            {settings.showRemoteFiles ? <Text tag="file">文件</Text> : null}
          </Picker>
        </ZStack>
      </VStack>
    )
  }

  function renderRemoteSection() {
    const sync = settings.syncClipboard
    const configured = isRemoteSyncConfigured(sync)
    const allRemoteMatches = filteredRemoteItems()
    const visibleItems = filteredUniversalItems()
    const includesRemote = clipboardSourceFilter !== "local"
    const visibleRemoteCount = visibleItems.reduce((count, entry) => count + (entry.origin === "remote" ? 1 : 0), 0)
    const visibleLocalCount = visibleItems.reduce((count, entry) => count + (entry.origin === "local" ? 1 : 0), 0)
    const visibleTotalCount = visibleItems.length
    const hasMoreRemoteCached = includesRemote && visibleRemoteCount < allRemoteMatches.length
    const emptySource = clipboardSourceLabel(clipboardSourceFilter)
    const emptyType = networkFilterLabel(networkClipFilter)
    const emptyTitle = `暂无${emptySource}${emptyType === "全部" ? "" : emptyType}记录`
    const emptyMessage = clipboardSourceFilter === "local"
      ? (networkClipFilter === "file" ? "本地剪贴板暂不支持文件记录。" : (query.trim() ? "没有匹配的本地剪贴板内容。" : "点击右上角采集按钮，或开启 PiP 监听。"))
      : clipboardSourceFilter === "remote"
        ? (remoteError || (configured ? "等待第一次同步或下拉刷新远程记录。" : "请先在设置中启用并配置 SyncClipboard。"))
        : (remoteError || "等待第一次同步或本地采集…")
    const countText = `总计 ${visibleTotalCount} 条 · 远程 ${visibleRemoteCount}/${allRemoteMatches.length} 条 · 本地 ${visibleLocalCount} 条`
    const syncText = !includesRemote
      ? "仅显示本地剪贴板记录"
      : configured
        ? (remoteError
          ? "错误：" + remoteError
          : remoteLastSyncAt
            ? "最近同步：" + formatDateTime(remoteLastSyncAt)
            : "准备同步…")
        : "未启用同步或未配置服务器"
    const footerText = `${countText} · ${syncText}`
    return (
      <Group>
        {!configured && includesRemote && visibleItems.length === 0 ? (
          <EmptyState title="远程同步未启用" message={clipboardSourceFilter === "remote" ? "配置 SyncClipboard 后可查看远程剪切板。" : "本地剪贴板暂无内容；配置 SyncClipboard 后这里会成为本地 + 远程的通用剪切板。"} systemImage="cloud.slash" />
        ) : visibleItems.length === 0 && !remoteLoading ? (
          <EmptyState title={emptyTitle} message={emptyMessage} systemImage={clipboardSourceFilter === "local" ? "iphone" : "icloud"} />
        ) : null}
        {visibleItems.map((entry) => renderUniversalClipRow(entry))}
        {includesRemote && configured && (hasMoreRemoteCached || remoteLoading) ? (
          <HStack
            frame={{ maxWidth: "infinity", alignment: "center" as any }}
            padding={{ top: 12, bottom: 18 }}
            listRowInsets={{ top: 0, bottom: 0, leading: 12, trailing: 12 }}
            listRowSeparator="hidden"
            listRowBackground={<EmptyView />}
            onAppear={() => { if (hasMoreRemoteCached) void loadMoreRemote() }}
          >
            <Text font="footnote" foregroundStyle="secondaryLabel">
              {remoteLoading ? "同步中…" : "加载更多本地缓存…"}
            </Text>
          </HStack>
        ) : null}
        <HStack
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          padding={{ top: 4, bottom: 10, leading: 0, trailing: 0 }}
          listRowInsets={{ top: 0, bottom: 0, leading: 16, trailing: 16 }}
          listRowSeparator="hidden"
          listRowBackground={<EmptyView />}
        >
          <Text font="footnote" foregroundStyle="secondaryLabel">{footerText}</Text>
        </HStack>
      </Group>
    )
  }

  function renderMemoRow(group: KeyboardMemoGroup, memo: KeyboardMemoItem) {
    const selectionKey = memoSelectionKey(group, memo)
    const selecting = inMemoSelectionMode()
    const selected = selectedSetHas(selectedMemoKeys, selectionKey)
    const fields = memo.enableSubfields ? memoSubfields(memo.text, settings.memoSubfieldSeparators) : []
    const hasFields = fields.length > 0
    return (
      <HStack
        key={memo.id}
        frame={{ maxWidth: "infinity", alignment: "leading" as any }}
        background="rgba(0,0,0,0.001)"
        contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
        listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
        listRowSeparator="hidden"
        listRowBackground={<EmptyView />}
        onTapGesture={withHaptic(() => selecting ? toggleMemoSelectionKey(selectionKey) : void editMemo(group, memo))}
        contextMenu={{
          menuItems: (
            <Group>
              <Button title="复制" systemImage="doc.on.doc" action={() => void copyMemo(memo)} />
              <Button title="编辑" systemImage="square.and.pencil" action={() => void editMemo(group, memo)} />
              {hasFields ? fields.map((field, index) => (
                <Button key={`${field.key}-${index}`} title={field.key} systemImage="arrow.turn.down.right" action={() => void writeTextToPasteboard(renderRuntimeTemplate(field.value)).then(() => showToast("已复制字段"))} />
              )) : null}
              <Button title="删除" systemImage="trash" role="destructive" action={() => void deleteMemo(group, memo)} />
            </Group>
          ),
        }}
        trailingSwipeActions={{
          allowsFullSwipe: false,
          actions: [
            <Button title="" systemImage="doc.on.doc" tint="systemBlue" action={() => void copyMemo(memo)} />,
            <Button title="" systemImage="trash" tint="systemRed" action={() => void deleteMemo(group, memo)} />,
          ],
        }}
      >
        {selecting ? <Image systemName={selected ? "checkmark.circle.fill" : "circle"} font="title3" foregroundStyle={selected ? "systemBlue" : "secondaryLabel"} frame={{ width: 28 }} /> : null}
        <HStack spacing={12} frame={{ maxWidth: "infinity", alignment: "leading" as any }} padding={{ top: 10, bottom: 10, leading: 12, trailing: 8 }} background={{ style: cardFill, shape: { type: "rect", cornerRadius: 16 } }}>
          <MemoStatusLine dashed={Boolean(memo.enableSubfields)} color={group.color ?? DEFAULT_MEMO_GROUP_COLOR} />
          <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text font="body" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">{memoTitle(memo)}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">{memoUpdatedFooter(memo)}</Text>
          </VStack>
          <Button title="" systemImage="doc.on.doc" action={() => void copyMemo(memo)} />
        </HStack>
      </HStack>
    )
  }

  function renderMemoGroupLink(group: KeyboardMemoGroup) {
    // 从 memoGroups 状态中实时获取最新的 group 数据，避免闭包捕获旧引用
    const freshGroup = memoGroups.find((g) => g.id === group.id) ?? group
    return (
      <NavigationLink
        key={freshGroup.id}
        destination={(
          <Form
            navigationTitle={freshGroup.title}
            navigationBarTitleDisplayMode="inline"
            formStyle="grouped"
            listRowSpacing={10}
            contentMargins={APP_SCROLL_CONTENT_MARGINS}
            toolbar={{
              topBarTrailing: (
                <HStack spacing={10}>
                  <Button title="编辑" systemImage="paintpalette" action={() => void editMemoGroup(freshGroup)} />
                  <Button title="" systemImage="plus" action={() => void addMemoToGroup(freshGroup)} />
                </HStack>
              ),
            }}
          >
            {freshGroup.memos.length ? (
              <Section listSectionSeparator="hidden">
                <ForEach
                  count={sortedMemos(freshGroup).length}
                  itemBuilder={(index) => renderMemoRow(freshGroup, sortedMemos(freshGroup)[index])}
                  onMove={(indices, newOffset) => reorderMemoGroup(freshGroup, indices, newOffset)}
                />
              </Section>
            ) : (
              <EmptyState title="暂无 Memo" message="点击右上角 + 在此列表中新增 Memo。" systemImage="text.badge.plus" />
            )}
          </Form>
        )}
      >
        <HStack spacing={12} padding={{ top: 10, bottom: 10, leading: 4, trailing: 4 }} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <MemoGroupDot color={freshGroup.color ?? DEFAULT_MEMO_GROUP_COLOR} />
          <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text font="body" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">{freshGroup.title}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">{freshGroup.memos.length} 条 Memo</Text>
          </VStack>
          <Button title="" systemImage="plus.circle" tint="systemBlue" action={() => void addMemoToGroup(freshGroup)} />
          <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" />
        </HStack>
      </NavigationLink>
    )
  }

  function renderMemoListManager() {
    const groups = sortedMemoGroups(memoGroups)
    if (!groups.length) {
      return <EmptyState title="暂无列表" message="点击右上角 + 新增 Memo 列表。" systemImage="list.bullet.rectangle" />
    }
    return (
      <Section key={`memo-list-manager-${memoListManagerToken}`} footer={<Text>长按列表可拖动排序；左滑可删除列表。</Text>} listSectionSeparator="hidden">
        <ForEach
          count={groups.length}
          itemBuilder={(index) => {
            const group = groups[index]
            return (
              <HStack
                key={group.id}
                listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
                listRowSeparator="hidden"
                trailingSwipeActions={{
                  allowsFullSwipe: false,
                  actions: [<Button title="" systemImage="trash" tint="systemRed" action={() => void deleteMemoGroup(group)} />],
                }}
                contextMenu={{
                  menuItems: (
                    <Group>
                      <Button title="编辑列表" systemImage="paintpalette" action={() => void editMemoGroup(group)} />
                      <Button title="添加 Memo" systemImage="plus" action={() => void addMemoToGroup(group)} />
                      <Button title="删除列表" systemImage="trash" role="destructive" action={() => void deleteMemoGroup(group)} />
                    </Group>
                  ),
                }}
              >
                {renderMemoGroupLink(group)}
              </HStack>
            )
          }}
          onMove={(indices, newOffset) => {
            refreshMemoGroupsFromStorage()
            reorderMemoGroups(indices, newOffset)
          }}
        />
      </Section>
    )
  }

  function renderMemosTabContent() {
    if (!memoGroups.length) {
      return <EmptyState title="暂无 Memos" message="点击右上角 + 新增 Memo；点击列表图标管理列表。" systemImage="text.book.closed" />
    }
    return (
      <Group>
        {sortedMemoGroups(memoGroups).map((group) => (
          <Section
            key={group.id}
            header={
              <HStack frame={{ maxWidth: "infinity" }}>
                <Text frame={{ maxWidth: "infinity", alignment: "leading" as any }}>{group.title}</Text>
                <Text font="caption" foregroundStyle="secondaryLabel">有{group.memos.length}条memo</Text>
                <Button title="" systemImage="plus.circle.fill" tint="systemBlue" action={() => void addMemoToGroup(group)} />
                <Button title="" systemImage={group.collapsed ? "chevron.down.circle" : "chevron.up.circle"} tint="systemGray" action={() => void toggleGroupCollapse(group)} />
              </HStack>
            }
            listSectionSeparator="hidden"
            contextMenu={{
              menuItems: (
                <Group>
                  <Button title="添加 Memo" systemImage="plus" action={() => void addMemoToGroup(group)} />
                  <Button title="编辑列表" systemImage="paintpalette" action={() => void editMemoGroup(group)} />
                </Group>
              ),
            }}
          >
            {!group.collapsed && group.memos.length ? (
              <ForEach
                count={sortedMemos(group).length}
                itemBuilder={(index) => renderMemoRow(group, sortedMemos(group)[index])}
                onMove={(indices, newOffset) => reorderMemoGroup(group, indices, newOffset)}
              />
            ) : !group.collapsed ? (
              <HStack
                frame={{ maxWidth: "infinity", alignment: "center" as any }}
                listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
                listRowSeparator="hidden"
                listRowBackground={<EmptyView />}
              >
                <Button title="添加 Memo" systemImage="plus" action={() => void addMemoToGroup(group)} />
              </HStack>
            ) : null}
          </Section>
        ))}
      </Group>
    )
  }

  function toolbarLeading() {
    return (
      <HStack spacing={10}>
        <Button
          title=""
          systemImage="xmark.circle.fill"
          foregroundStyle="systemRed"
          action={withHaptic(() => Script.exit())}
        />
        {Script.supportsMinimization?.() ? (
          <Button
            title=""
            systemImage="minus.circle.fill"
            foregroundStyle="systemYellow"
            action={withHaptic(minimizeScript)}
          />
        ) : null}
        <Button
          title=""
          systemImage={appFullscreen ? "arrow.down.right.and.arrow.up.left.circle.fill" : "arrow.up.left.and.arrow.down.right.circle.fill"}
          foregroundStyle="systemBlue"
          action={withHaptic(toggleFullscreenMode)}
        />
      </HStack>
    )
  }

  function clipToolbarButtons() {
    return (
      <HStack spacing={10}>
        {bulkSelectionMode === "clips" ? bulkSelectionToolbarButtons("clips") : (
          <>
            <Button title="选择" systemImage="checkmark.circle" action={withHaptic(() => enterBulkSelection("clips"))} />
            {pipToolbarButton()}
            <Button
              title=""
              systemImage="magnifyingglass.circle"
              disabled={loading}
              action={withHaptic(rebuildSpotlightFromApp)}
            />
            <Button
              title=""
              systemImage="doc.badge.plus"
              disabled={loading}
              action={withHaptic(captureNow)}
            />
          </>
        )}
      </HStack>
    )
  }

  function favoriteToolbarButtons() {
    return (
      <HStack spacing={10}>
        {pipToolbarButton()}
        <Button
          title=""
          systemImage="plus"
          action={withHaptic(async () => {
            const result = await Navigation.present<{ title: string, content: string } | null>({
              element: <AddFavoriteView />,
              modalPresentationStyle: "pageSheet"
            })
            if (result) {
              await addFavoriteFromInput(result.title, result.content)
              showToast("已添加到收藏")
              await refresh()
            }
          })}
        />
      </HStack>
    )
  }

  function pipToolbarButton() {
    return (
      <Button
        title=""
        systemImage={pipPresented.value ? "pip.exit" : "pip.enter"}
        foregroundStyle={pipPresented.value ? "systemBlue" : undefined}
        action={withHaptic(togglePip)}
      />
    )
  }

  function memosToolbarButtons() {
    return (
      <HStack spacing={10}>
        {bulkSelectionMode === "memos" ? bulkSelectionToolbarButtons("memos") : (
          <>
            <Button title="选择" systemImage="checkmark.circle" action={withHaptic(() => enterBulkSelection("memos"))} />
            <Button
              title=""
              systemImage="list.bullet.rectangle"
              action={withHaptic(() => void Navigation.present({
                element: <MemoListManagerPanel onChanged={(groups) => { setMemoGroups(groups); memoGroupsRef.current = groups }} />,
                modalPresentationStyle: "pageSheet",
              }))}
            />
            <Button title="" systemImage="plus" action={withHaptic(() => presentMemoEditor())} />
          </>
        )}
      </HStack>
    )
  }

  function aiToolbarButtons() {
    return (
      <HStack spacing={10}>
        <Button
          title=""
          systemImage="gearshape"
          action={withHaptic(() => presentAISettings())}
        />
        <Button
          title=""
          systemImage="plus"
          action={withHaptic(() => presentAIEditor())}
        />
      </HStack>
    )
  }

  async function presentAISettings() {
    const result = await Navigation.present<AISettingsResult | null>({
      element: <AISettingsView defaultProvider={aiSettings.defaultProvider} defaultModelId={aiSettings.defaultModelId} columnsPerRow={aiSettings.columnsPerRow} />,
      modalPresentationStyle: "pageSheet",
    })
    if (!result) return
    saveAISettings({ ...aiSettings, defaultProvider: result.defaultProvider, defaultModelId: result.defaultModelId, columnsPerRow: result.columnsPerRow })
    showToast("AI 设置已更新")
  }

  async function presentAIEditor(assistant?: AIAssistant) {
    const result = await Navigation.present<AIAssistantEditorResult | null>({
      element: <AIAssistantEditorView assistant={assistant} />,
      modalPresentationStyle: "pageSheet",
    })
    if (!result) return
    if (result.deleteId) {
      const next = removeAssistant(aiSettings.assistants, result.deleteId)
      saveAISettings({ ...aiSettings, assistants: normalizeAssistantOrders(next) })
      showToast("助手已删除")
      return
    }
    if (result.assistant) {
      const next = updateAssistant(aiSettings.assistants, result.assistant.id, {
        name: result.name,
        systemPrompt: result.systemPrompt,
        provider: result.provider,
        modelId: result.modelId,
      })
      saveAISettings({ ...aiSettings, assistants: next })
      showToast("助手已更新")
    } else {
      const now = Date.now()
      const newAssistant: AIAssistant = {
        id: createAIAssistantId(),
        name: result.name,
        systemPrompt: result.systemPrompt,
        provider: result.provider,
        modelId: result.modelId,
        sortOrder: aiSettings.assistants.length,
        createdAt: now,
        updatedAt: now,
      }
      saveAISettings({ ...aiSettings, assistants: normalizeAssistantOrders([...aiSettings.assistants, newAssistant]) })
      showToast("助手已创建")
    }
  }

  function renderAITabContent() {
    const assistants = sortedAssistants(aiSettings.assistants)
    if (!assistants.length) {
      return <EmptyState title="暂无 AI 助手" message="点击右上角 + 新建 AI 助手，用于对文字进行 AI 处理。" systemImage="brain" />
    }
    return (
      <Group>
        <Section
          header={<Text>{assistants.length} 个助手</Text>}
          footer={<Text>长按助手可拖动排序；左滑可删除助手。</Text>}
          listSectionSeparator="hidden"
        >
          <ForEach
            count={assistants.length}
            itemBuilder={(index) => {
              const assistant = assistants[index]
              const providerLabel = AI_PROVIDER_OPTIONS.find((opt) => opt.value === assistant.provider)?.label ?? assistant.provider
              return (
                <HStack
                  key={assistant.id}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  background="rgba(0,0,0,0.001)"
                  contentShape={{ kind: "interaction", shape: { type: "rect" } } as any}
                  listRowInsets={{ top: 5, bottom: 5, leading: 12, trailing: 12 }}
                  listRowSeparator="hidden"
                  listRowBackground={<EmptyView />}
                  onTapGesture={withHaptic(() => presentAIEditor(assistant))}
                  contextMenu={{
                    menuItems: (
                      <Group>
                        <Button title="编辑" systemImage="pencil" action={() => void presentAIEditor(assistant)} />
                        <Button
                          title="删除"
                          systemImage="trash"
                          role="destructive"
                          action={async () => {
                            const confirmed = await Dialog.confirm({
                              title: `删除「${assistant.name}」？`,
                              message: "删除后无法撤销。",
                              confirmLabel: "删除",
                              cancelLabel: "取消",
                            })
                            if (confirmed) {
                              const next = removeAssistant(aiSettings.assistants, assistant.id)
                              saveAISettings({ ...aiSettings, assistants: normalizeAssistantOrders(next) })
                              showToast("助手已删除")
                            }
                          }}
                        />
                      </Group>
                    ),
                  }}
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button
                        title=""
                        systemImage="trash"
                        tint="systemRed"
                        action={async () => {
                          const confirmed = await Dialog.confirm({
                            title: `删除「${assistant.name}」？`,
                            message: "删除后无法撤销。",
                            confirmLabel: "删除",
                            cancelLabel: "取消",
                          })
                          if (confirmed) {
                            const next = removeAssistant(aiSettings.assistants, assistant.id)
                            saveAISettings({ ...aiSettings, assistants: normalizeAssistantOrders(next) })
                            showToast("助手已删除")
                          }
                        }}
                      />,
                    ],
                  }}
                >
                  <HStack
                    spacing={12}
                    frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                    padding={{ top: 10, bottom: 10, leading: 16, trailing: 12 }}
                    background={{ style: cardFill, shape: { type: "rect", cornerRadius: 16 } }}
                  >
                    <VStack spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                      <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                        <Text font="body" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">{assistant.name}</Text>
                        <Text font="caption" foregroundStyle="secondaryLabel">{providerLabel}</Text>
                      </HStack>
                      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" as any }} multilineTextAlignment="leading">
                        {assistant.systemPrompt || "暂无提示词"}
                      </Text>
                    </VStack>
                  </HStack>
                </HStack>
              )
            }}
            onMove={(indices, newOffset) => reorderAIAssistants(indices, newOffset)}
          />
        </Section>
      </Group>
    )
  }

  function bulkSelectionToolbarButtons(mode: BulkSelectionMode) {
    const count = mode === "clips" ? selectedClipCount() : selectedMemoCount()
    return (
      <>
        <Button title="取消" systemImage="xmark.circle" action={withHaptic(exitBulkSelection)} />
        <Button title={count ? `已选 ${count}` : "选择"} systemImage="checkmark.circle.fill" action={withHaptic(() => mode === "clips" ? selectAllVisibleClips() : selectAllVisibleMemos())} />
        {bulkActionMenu(mode)}
      </>
    )
  }

  function bulkActionMenu(mode: BulkSelectionMode) {
    const builtins = getOrderedMenuBuiltins(settings).filter((action) => bulkBuiltinSupported(action, mode))
    const customs = settings.keyboardMenu.customActions.filter((action) => action.enabled)
    const runAction = (value: string) => {
      setBulkActionSelection(value)
      void handleBulkActionSelection(value, mode)
    }
    return (
      <Menu label={<Image systemName="ellipsis.circle" />}>
        <Button title="复制" systemImage="doc.on.doc" action={() => runAction("copy")} />
        {builtins.map((action) => (
          <Button
            key={`builtin-${action}`}
            title={menuBuiltinTitle(action)}
            systemImage={menuBuiltinSystemImage(action)}
            action={() => runAction(`builtin:${action}`)}
          />
        ))}
        {customs.map((action) => (
          <Button
            key={`custom-${action.id}`}
            title={action.title}
            systemImage={customActionSystemImage(action)}
            action={() => runAction(`custom:${action.id}`)}
          />
        ))}
        <Button title="删除" systemImage="trash" role="destructive" action={() => runAction("delete")} />
      </Menu>
    )
  }

  function settingsTrailingToolbar() {
    return (
      <Button
        title=""
        systemImage="plus"
        action={withHaptic(() => setAddCustomActionToken((v) => v + 1))}
      />
    )
  }

  function searchPanel() {
    return (
      <VStack
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        padding={{ top: 10, bottom: 6, leading: 16, trailing: 16 }}
        listRowInsets={{ top: 0, bottom: 0, leading: 0, trailing: 0 }}
        listRowSeparator="hidden"
        listRowBackground={<EmptyView />}
      >
        <VStack
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          padding={{ top: 10, bottom: 10, leading: 14, trailing: 14 }}
          background={{ style: cardFill, shape: { type: "rect", cornerRadius: 18 } }}
        >
          <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "center" as any }}>
            <Image systemName="magnifyingglass" foregroundStyle="secondaryLabel" frame={{ width: 18 }} />
            <TextField title="" value={query} prompt="输入关键词" onChanged={setQuery} />
          </HStack>
        </VStack>
      </VStack>
    )
  }

  function pipControlPanel() {
    if (!pipPresented.value) return null
    return (
      <VStack
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        padding={{ top: 10, bottom: 6, leading: 16, trailing: 16 }}
        listRowInsets={{ top: 0, bottom: 0, leading: 0, trailing: 0 }}
        listRowSeparator="hidden"
        listRowBackground={<EmptyView />}
      >
        <VStack
          spacing={8}
          frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          padding={{ top: 10, bottom: 10, leading: 14, trailing: 14 }}
          background={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 18 } }}
        >
          <Text
            font="headline"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
          >
            PiP 监听状态
          </Text>
          <Text
            font="caption"
            foregroundStyle="secondaryLabel"
            multilineTextAlignment="leading"
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            [{formatDateTime(monitorStatus.lastCheckedAt)}] {monitorStatus.lastMessage} · 已复制 {monitorStatus.capturedCount ?? 0} 条
          </Text>
        </VStack>
      </VStack>
    )
  }

  if (!settingsLoaded) {
    return (
      <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}>
        <Text foregroundStyle="secondaryLabel">加载中…</Text>
      </VStack>
    )
  }

  return (
    <TabView
      selection={activeTab as any}
      tint="systemIndigo"
      tabViewStyle="sidebarAdaptable"
      pip={{
        isPresented: pipPresented,
        maximumUpdatesPerSecond: 2,
        content: (
          <PipStatusView
            status={monitorStatus}
            onStart={startPipMonitor}
            onStop={stopPipMonitor}
          />
        ),
      }}
    >
      <Tab title={tabTitle(TAB_FAVORITES)} systemImage={tabIcon(TAB_FAVORITES)} value={TAB_FAVORITES}>
        <FavoritePage
          leadingToolbar={toolbarLeading()}
          trailingToolbar={favoriteToolbarButtons()}
          toast={toastOptions()}
          searchPanel={searchPanel()}
          content={renderFavoriteTabContent()}
        />
      </Tab>

      {/* 本地 tab 暂时注释：剪切板 tab 已作为本地 + 远程的通用剪切板。
      <Tab title="本地" systemImage="doc.on.clipboard" value={TAB_CLIPS}>
        <NavigationStack>
          <Form
            formStyle="grouped"
            listRowSpacing={10}
            contentMargins={APP_SCROLL_CONTENT_MARGINS}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            toolbar={{ topBarLeading: toolbarLeading(), topBarTrailing: clipToolbarButtons() }}
            toast={toastOptions()}
            refreshable={async () => {
              clipPageLimitRef.current = CLIP_PAGE_STEP
              setClipPageLimit(CLIP_PAGE_STEP)
              await refresh(true)
            }}
          >
            {pipControlPanel()}
            {searchPanel()}
            {renderGroupedClipList(
              clipboardGroups,
              query.trim() ? "没有匹配的剪贴板内容。" : "点击右上角采集按钮，或开启 PiP 监听。",
              { allowDelete: (item) => !item.manualFavorite, loadMore: true }
            )}
          </Form>
        </NavigationStack>
      </Tab>
      */}

      <Tab title={tabTitle(TAB_NETWORK)} systemImage={tabIcon(TAB_NETWORK)} value={TAB_NETWORK}>
        <NetworkPage
          leadingToolbar={toolbarLeading()}
          trailingToolbar={clipToolbarButtons()}
          toast={toastOptions()}
          pipControlPanel={pipControlPanel()}
          searchPanel={searchPanel()}
          filterPanel={renderNetworkFilterPicker()}
          content={renderRemoteSection()}
          onRefresh={async () => {
            blockRemoteRowInteractions()
            clipPageLimitRef.current = CLIP_PAGE_STEP
            setClipPageLimit(CLIP_PAGE_STEP)
            remotePageLimitRef.current = REMOTE_PAGE_STEP
            setRemotePageLimit(REMOTE_PAGE_STEP)
            setRemotePage(1)
            await Promise.all([
              refresh(true),
              reloadRemote(),
            ])
            blockRemoteRowInteractions()
          }}
        />
      </Tab>

      <Tab title={tabTitle(TAB_MEMOS)} systemImage={tabIcon(TAB_MEMOS)} value={TAB_MEMOS}>
        <MemosPage
          leadingToolbar={toolbarLeading()}
          trailingToolbar={memosToolbarButtons()}
          toast={toastOptions()}
          content={renderMemosTabContent()}
        />
      </Tab>

      <Tab title={tabTitle(TAB_AI)} systemImage={tabIcon(TAB_AI)} value={TAB_AI}>
        <AIPage
          leadingToolbar={toolbarLeading()}
          trailingToolbar={aiToolbarButtons()}
          toast={toastOptions()}
          content={renderAITabContent()}
        />
      </Tab>

      <Tab title={tabTitle(TAB_SETTINGS)} systemImage={tabIcon(TAB_SETTINGS)} value={TAB_SETTINGS}>
        <SettingsPage
          value={settings}
          onChanged={updateSettings}
          onClearFavorites={() => void requestClear("favorites")}
          onClearClipboard={(range) => void requestClear(range)}
          onSyncNow={() => void syncNowFromSettings()}
          onClearRemote={() => void clearRemoteFromSettings()}
          onRemoteStats={() => void showRemoteStatsFromSettings()}
          addActionToken={addCustomActionToken}
          leadingToolbar={toolbarLeading()}
          trailingToolbar={settingsTrailingToolbar()}
          toast={toastOptions()}
        />
      </Tab>
    </TabView>
  )
}
