import {
  Button,
  Capsule,
  Device,
  DragGesture,
  ForEach,
  GeometryReader,
  Group,
  HStack,
  Image,
  Label,
  LazyHStack,
  LazyVGrid,
  Picker,
  ProgressView,
  Script,
  ScrollView,
  ScrollViewReader,
  Text,
  TextField,
  VStack,
  type Font,
  useEffect,
  useMemo,
  useObservable,
  useRef,
  useState,
  ZStack,
} from "scripting"

import type {
  AppStartPage,
  CaisSettings,
  ClipItem,
  ClipListScope,
  KeyboardCustomAction,
  KeyboardMenuBuiltinAction,
  MonitorStatus,
  RemoteClipItem,
  SyncClipboardKind,
} from "../types"
import { captureCurrentClipboard, startClipboardMonitor, stopClipboardMonitor } from "../services/clipboard_capture"
import { writeClipToPasteboard, writeTextToPasteboard, readPasteboardPayload } from "../services/pasteboard_adapter"
import {
  addClipFromPayload,
  deleteClipboardTextClipsByContent,
  getClips,
  getFullClipContent,
  softDeleteClip,
  toggleFavorite,
  togglePinned,
} from "../storage/clip_repository"
import { readClipDataVersion } from "../storage/change_signal"
import { loadSettings, loadSettingsFromDB, saveSettings } from "../storage/settings_store"
import { imagePreviewPath } from "../storage/image_store"
import { formatDateTime, summarizeContent, clipTitle, isLikelyURL } from "../utils/common"
import { loadRemoteClipCache, saveRemoteClipCache, updateRemoteClipCacheItems } from "../storage/remote_clip_cache"
import { deleteRemoteRecord, isRemoteSyncConfigured, makeRemoteTextHash, makeRemoteTextProfileId, queryRemoteHistory, remoteItemContent, uploadCurrentClipboardToRemote } from "../services/sync_clipboard"
import { disposeCaisFeedback, playCaisFeedback, prepareCaisFeedback } from "../utils/feedback"
import { renderRuntimeTemplate } from "../utils/template"
import { PipStatusView } from "./PipStatusView"
import { TokenSelectionPanel } from "./TokenSelectionPanel"
import { PasswordVaultPanel } from "./PasswordVaultPanel"
import { readPipControlState, requestPipStart, requestPipStop } from "../services/pip_control"
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
  mergeRemoteItems,
  remoteItemKey,
  remoteModifiedAfterForIncrementalSync,
} from "../utils/remote_clip_items"
import {
  TAB_FAVORITES,
  TAB_AI,
  TAB_MEMOS,
  TAB_NETWORK,
  KEYBOARD_TAB_ORDER,
  tabIcon,
  tabTitle,
  tabForStartPage,
} from "../utils/tab_config"
import { loadMemoGroupsFromDB, readKeyboardMemos as readMemosFromCache } from "../utils/memos"

const TAB_FAVORITE = TAB_FAVORITES // legacy alias
const TAB_CLIPS = 1
const KEYBOARD_ROOT_SIDE_PADDING = 6
const CLIP_SCROLL_SIDE_PADDING = 8
const CLIP_GRID_SPACING = 10
const KEYBOARD_TILE_PREVIEW_LIMIT = 1200
const KEYBOARD_LAYOUT_KEY = "cais_keyboard_row_count_v1"
const RIME_KEYBOARD_SCRIPT_NAME = "Scripting Rime Keyboard"
const KEYBOARD_EXIT_FEEDBACK_DELAY_MS = 90
const SPACE_CURSOR_DRAG_STEP = 18
const EMOJI_COLUMN_MIN_WIDTH = 38
const EMOJI_CATEGORY_BAR_HEIGHT = 38
const AI_INPUT_BAR_HEIGHT = 36
const AI_INPUT_BUTTON_WIDTH = 30
const AI_INPUT_BUTTON_HEIGHT = 29
const AI_INPUT_BUTTON_SPACING = 4
const AI_INPUT_ACTIONS_WIDTH = AI_INPUT_BUTTON_WIDTH * 2 + AI_INPUT_BUTTON_SPACING
const AI_INPUT_ROW_SPACING = 6
const AI_INPUT_SIDE_PADDING = KEYBOARD_ROOT_SIDE_PADDING + CLIP_SCROLL_SIDE_PADDING
const KEYBOARD_CLIP_PAGE_STEP = 60
const KEYBOARD_LOAD_MORE_THRESHOLD = 12
const SHARED_STORAGE_OPTIONS = { shared: true }
let deleteRepeatTimer: any = null
let lastPastedText = ""
let keyboardRefreshGeneration = 0
let keyboardLifecycleGeneration = 0
let activeKeyboardScope: ClipListScope = "clipboard"
let lastKeyboardItemsByScope: Record<ClipListScope, ClipItem[]> = { favorites: [], clipboard: [], all: [] }
let lastKeyboardItemsKeyByScope: Record<ClipListScope, string> = { favorites: "", clipboard: "", all: "" }
let lastKeyboardItemsVersionByScope: Record<ClipListScope, number> = { favorites: 0, clipboard: 0, all: 0 }
let keyboardMonitorStopper: (() => void) | null = null
let keyboardMonitorStartTimer: any = null
let keyboardRemoteRefreshing = false
let currentFeedbackSettings: CaisSettings | null = null

function scopeTabForKeyboardRefresh(scope: ClipListScope): number {
  if (scope === "favorites") return TAB_FAVORITES
  if (scope === "all") return TAB_NETWORK
  return TAB_CLIPS
}

export type KeyboardInitialState = {
  items: ClipItem[]
  settings: CaisSettings
  version: number
  loaded: boolean
  scope: ClipListScope
  activeTab: number
}

type KeyboardLayoutMode = "twoByTwo" | "oneByTwo" | "twoByThree"
type KeyboardTokenPage = {
  title: string
  tokens: CaisToken[]
  selectedIds: string[]
}

type EmojiCategory = {
  id: string
  icon: string
  title: string
  items: string[]
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "recent",
    icon: "😀",
    title: "表情",
    items: "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 😵‍💫 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🫠 🫢 🫣 🫡 🫥 🫤 🥹 🫧".split(" "),
  },
  {
    id: "people",
    icon: "👋",
    title: "人物与手势",
    items: "👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👱 👨 🧔‍♂️ 🧔‍♀️ 👨‍🦰 👨‍🦱 👨‍🦳 👨‍🦲 👩 👩‍🦰 👩‍🦱 👩‍🦳 👩‍🦲 🧓 👴 👵 🙍‍♂️ 🙍‍♀️ 🙎‍♂️ 🙎‍♀️ 🙅‍♂️ 🙅‍♀️ 🙆‍♂️ 🙆‍♀️ 💁‍♂️ 💁‍♀️ 🙋‍♂️ 🙋‍♀️ 🧏‍♂️ 🧏‍♀️ 🙇‍♂️ 🙇‍♀️ 🤦‍♂️ 🤦‍♀️ 🤷‍♂️ 🤷‍♀️ 👮‍♂️ 👮‍♀️ 🕵️‍♂️ 🕵️‍♀️ 💂‍♂️ 💂‍♀️ 🥷 👷‍♂️ 👷‍♀️ 🫅 🤴 👸 👳‍♂️ 👳‍♀️ 👲 🧕 🤵‍♂️ 🤵‍♀️ 👰‍♂️ 👰‍♀️ 🤰 🫃 🫄 🤱 👼 🎅 🤶 🧑‍🎄 🦸‍♂️ 🦸‍♀️ 🦹‍♂️ 🦹‍♀️ 🧙‍♂️ 🧙‍♀️ 🧚‍♂️ 🧚‍♀️ 🧛‍♂️ 🧛‍♀️ 🧜‍♂️ 🧜‍♀️ 🧝‍♂️ 🧝‍♀️ 🧞‍♂️ 🧞‍♀️ 🧟‍♂️ 🧟‍♀️ 🧌 💆‍♂️ 💆‍♀️ 💇‍♂️ 💇‍♀️ 🚶‍♂️ 🚶‍♀️ 🧍‍♂️ 🧍‍♀️ 🧎‍♂️ 🧎‍♀️ 🏃‍♂️ 🏃‍♀️ 💃 🕺 👯‍♂️ 👯‍♀️ 🧖‍♂️ 🧖‍♀️ 🧗‍♂️ 🧗‍♀️ 🧘‍♂️ 🧘‍♀️ 🛀 🛌 👨‍👩‍👦 👨‍👩‍👧 👨‍👩‍👧‍👦 👨‍👩‍👦‍👦 👨‍👩‍👧‍👧 👩‍👩‍👦 👩‍👩‍👧 👩‍👩‍👧‍👦 👩‍👩‍👦‍👦 👩‍👩‍👧‍👧 👨‍👨‍👦 👨‍👨‍👧 👨‍👨‍👧‍👦 👨‍👨‍👦‍👦 👨‍👨‍👧‍👧 👩‍👦 👩‍👧 👩‍👧‍👦 👩‍👦‍👦 👩‍👧‍👧 👨‍👦 👨‍👧 👨‍👧‍👦 👨‍👦‍👦 👨‍👧‍👧 👤 👥 🫂 👣 🫆".split(" "),
  },
  {
    id: "animals",
    icon: "🐶",
    title: "动物与自然",
    items: "🐶 🐕 🦮 🐕‍🦺 🐩 🐺 🦊 🦝 🐱 🐈 🐈‍⬛ 🦁 🐯 🐅 🐆 🐴 🫎 🫏 🐎 🦄 🦓 🦌 🦬 🐮 🐂 🐃 🐄 🐷 🐖 🐗 🐽 🐏 🐑 🐐 🐪 🐫 🦙 🦒 🐘 🦣 🦏 🦛 🐭 🐁 🐀 🐹 🐰 🐇 🐿️ 🦫 🦔 🦇 🐻 🐻‍❄️ 🐨 🐼 🦥 🦦 🦨 🦘 🦡 🐾 🦃 🐔 🐓 🐣 🐤 🐥 🐦 🐧 🕊️ 🦅 🦆 🦢 🦉 🦤 🪶 🦩 🦚 🦜 🪽 🪿 🐦‍⬛ 🦋 🐛 🐌 🐞 🐜 🪰 🪲 🪳 🦟 🦗 🕷️ 🕸️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🪼 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🪸 🐊 🐸 🦭 🌵 🎄 🌲 🌳 🌴 🪵 🌱 🪴 🌿 ☘️ 🍀 🎍 🎋 🍃 🍂 🍁 🪺 🍄 🐚 🪨 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌖 🌗 🌘 🌑 🌒 🌓 🌔 🌙 🌎 🌍 🌏 🪐 💫 ⭐️ 🌟 ✨ ⚡️ ☄️ 💥 🔥 🌪 🌈 ☀️ 🌤 ⛅️ 🌥 ☁️ 🌦 🌧 ⛈ 🌩 🌨 ❄️ ☃️ ⛄️ 🌬 💨 💧 💦 🫧 ☔️ ☂️ 🌊 🌫".split(" "),
  },
  {
    id: "food",
    icon: "🍎",
    title: "食物与饮料",
    items: "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🫒 🥑 🍆 🥔 🥕 🌽 🌶️ 🫑 🥒 🥬 🥦 🧄 🧅 🥜 🫘 🌰 🫚 🫛 🍄 🫒 🧈 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🥞 🧇 🥓 🥩 🍗 🍖 🦴 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 🫖 ☕️ 🍵 🍶 🍾 🍷 🍸 🍹 🍺 🍻 🥂 🥃 🫗 🧃 🧉 🧊 🥤 🧋".split(" "),
  },
  {
    id: "activity",
    icon: "⚽️",
    title: "活动",
    items: "⚽️ 🏀 🏈 ⚾️ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳️ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏋️‍♂️ 🏋️‍♀️ 🤼‍♂️ 🤼‍♀️ 🤸‍♂️ 🤸‍♀️ ⛹️‍♂️ ⛹️‍♀️ 🤺 🤾‍♂️ 🤾‍♀️ 🏌️‍♂️ 🏌️‍♀️ 🏇 🧘‍♂️ 🧘‍♀️ 🏄‍♂️ 🏄‍♀️ 🏊‍♂️ 🏊‍♀️ 🤽‍♂️ 🤽‍♀️ 🚣‍♂️ 🚣‍♀️ 🧗‍♂️ 🧗‍♀️ 🚵‍♂️ 🚵‍♀️ 🚴‍♂️ 🚴‍♀️ 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹‍♂️ 🤹‍♀️ 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🪈 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩 🃏 🀄 🎴 🎯 🪩 🪢".split(" "),
  },
  {
    id: "travel",
    icon: "🚗",
    title: "旅行与地点",
    items: "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🦯 🦽 🦼 🛴 🚲 🛵 🏍️ 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵️ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓️ 🛟 🪝 ⛽️ 🚧 🚦 🚥 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲️ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺️ 🛖 🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪️ 🕌 🕍 🛕 🕋 ⛩️ 🗾 🎑 🏞️ 🏙️ 🌃 🌄 🌅 🌆 🌇 🌉 ♨️ 🗼 🎪 🛝 🛤️ 🛣️ 🚏 🚥 🗿".split(" "),
  },
  {
    id: "objects",
    icon: "💡",
    title: "物品",
    items: "⌚️ 📱 📲 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 🕹️ 🗜️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛️ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 💰 💴 💵 💶 💷 💸 💳 🪪 🪙 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🪦 ⚱️ 🏺 🔮 📿 🧿 🪬 💈 ⚗️ 🔭 🔬 🕳️ 🩹 🩺 🩻 🩼 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🪠 🧺 🧻 🚽 🚰 🚿 🛁 🛀 🧼 🪥 🪒 🧽 🪣 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🛌 🧸 🪆 🖼️ 🪞 🪟 🛍️ 🛒 🎁 🎈 🎏 🎀 🪄 🪅 🎊 🎉 🎎 🏮 🎐 🧧 📦 📪 📫 📬 📭 📮 ✉️ 📧 📩 📨 💌 📤 📥 🏷️ 📑 📄 📃 📋 📊 📈 📉 📇 📆 📅 🗑️ 📁 📂 🗂️ 🗓️ 📰 🗞️ 📒 📓 📔 📕 📗 📘 📙 📚 📖 🔖 🏷️ 🧷 🔗 📎 🖇️ 📐 📏 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎".split(" "),
  },
  {
    id: "symbols",
    icon: "❤️",
    title: "符号",
    items: "❤️ 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💌 🫶 💢 💥 💫 💦 💨 💧 🕳️ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ ⛎ ☮️ ✝️ ☪️ 🪯 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 🔱 📿 ♻️ ⚜️ 🔰 💹 ✅ ❎ ❇️ ✳️ ❌ ❓ ❔ ❗️ ❕ ‼️ ⁉️ ⭕️ 🛑 ⛔️ 📛 🚫 🚭 🚷 🚯 🚳 🚱 🔞 📵 💯 🔅 🔆 〽️ ⚠️ 🚸 🔱 🔰 ♻️ ☢️ ☣️ ⚛️ 🉑 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🈶 🈚️ 🈸 🈺 🈷️ 🆚 🉐 ✴️ 🈯️ 💮 🆔 🈳 🈂️ 🈁 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟 #️⃣ *️⃣ ℹ️ 🔤 🔡 🔠 🔣 🎦 📶 ™️ ©️ ®️ 🅰️ 🅱️ 🆎 🅾️ 🆑 🆘 🆖 🆗 🆙 🆒 🆕 🆓 🚼 🚻 🚹 🚺 ⚧️ ♿️ 🅿️ 🚾 🏧 🛗 🛂 🛃 🛄 🛅 💠 🌀 🌐 Ⓜ️ 💤 🚮 🎵 🎶 ➕ ➖ ➗ ✖️ ♾️ 💲 💱 ➰ ➿ 〰️ ▪️ ▫️ ◾️ ◽️ ◼️ ◻️ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛️ ⬜️ 🟫 🔶 🔷 🔸 🔹 🔺 🔻 🔘 🔳 🔲 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟤".split(" "),
  },
  {
    id: "flags",
    icon: "🏳️",
    title: "旗帜",
    items: "🏁 🚩 🎌 🏴 🏳️ 🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️ 🇨🇳 🇭🇰 🇲🇴 🇹🇼 🇯🇵 🇰🇷 🇰🇵 🇲🇳 🇸🇬 🇲🇾 🇮🇩 🇹🇭 🇻🇳 🇵🇭 🇱🇦 🇰🇭 🇲🇲 🇧🇳 🇹🇱 🇮🇳 🇵🇰 🇧🇩 🇱🇰 🇳🇵 🇧🇹 🇦🇫 🇮🇷 🇮🇶 🇸🇦 🇦🇪 🇶🇦 🇰🇼 🇧🇭 🇴🇲 🇾🇪 🇯🇴 🇱🇧 🇸🇾 🇮🇱 🇵🇸 🇹🇷 🇬🇪 🇦🇲 🇦🇿 🇷🇺 🇺🇦 🇧🇾 🇰🇿 🇺🇿 🇹🇲 🇰🇬 🇹🇯 🇺🇸 🇨🇦 🇲🇽 🇧🇷 🇦🇷 🇨🇱 🇨🇴 🇵🇪 🇻🇪 🇪🇨 🇧🇴 🇺🇾 🇵🇾 🇬🇾 🇸🇷 🇵🇦 🇨🇷 🇳🇮 🇭🇳 🇸🇻 🇬🇹 🇧🇿 🇯🇲 🇨🇺 🇧🇸 🇭🇹 🇩🇴 🇵🇷 🇹🇹 🇧🇧 🇬🇧 🏴󠁧󠁢󠁥󠁮󠁧󠁿 🏴󠁧󠁢󠁳󠁣󠁴󠁿 🏴󠁧󠁢󠁷󠁬󠁳󠁿 🇮🇪 🇫🇷 🇩🇪 🇮🇹 🇪🇸 🇵🇹 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇮🇸 🇵🇱 🇨🇿 🇸🇰 🇭🇺 🇷🇴 🇧🇬 🇷🇸 🇭🇷 🇸🇮 🇬🇷 🇦🇱 🇲🇰 🇽🇰 🇲🇹 🇨🇾 🇪🇪 🇱🇻 🇱🇹 🇺🇦 🇲🇩 🇱🇺 🇲🇨 🇦🇩 🇱🇮 🇸🇲 🇻🇦 🇦🇺 🇳🇿 🇫🇯 🇵🇬 🇸🇧 🇼🇸 🇹🇴 🇫🇲 🇵🇼 🇳🇷 🇰🇮 🇲🇭 🇹🇻 🇻🇺 🇪🇬 🇿🇦 🇳🇬 🇰🇪 🇪🇹 🇹🇿 🇬🇭 🇨🇲 🇸🇳 🇲🇱 🇨🇮 🇲🇦 🇩🇿 🇹🇳 🇱🇾 🇸🇩 🇦🇴 🇨🇩 🇿🇲 🇿🇼 🇲🇿 🇲🇬 🇲🇺 🇳🇦 🇧🇼 🇺🇬 🇷🇼 🇸🇴 🇪🇺 🇺🇳".split(" "),
  },
]


function keyboard(): any {
  return (globalThis as any).CustomKeyboard
}

function rimeKeyboardScript(): any {
  const scripts = keyboard()?.allScripts
  if (!Array.isArray(scripts)) return null
  return scripts.find((script: any) =>
    script?.name === RIME_KEYBOARD_SCRIPT_NAME ||
    script?.localizedName === RIME_KEYBOARD_SCRIPT_NAME
  ) ?? null
}

function storage(): any {
  return (globalThis as any).Storage
}

function readKeyboardLayout(): KeyboardLayoutMode {
  const st = storage()
  try {
    const raw = st?.get?.(KEYBOARD_LAYOUT_KEY, SHARED_STORAGE_OPTIONS) ?? st?.getString?.(KEYBOARD_LAYOUT_KEY, SHARED_STORAGE_OPTIONS)
    return normalizeKeyboardLayout(raw)
  } catch {
  }
  try {
    const raw = st?.get?.(KEYBOARD_LAYOUT_KEY) ?? st?.getString?.(KEYBOARD_LAYOUT_KEY)
    return normalizeKeyboardLayout(raw)
  } catch {
    return "twoByTwo"
  }
}

function normalizeKeyboardLayout(value: any): KeyboardLayoutMode {
  if (value === "oneByTwo" || value === "1x2" || Number(value) === 1) return "oneByTwo"
  if (value === "twoByThree" || value === "2x3") return "twoByThree"
  return "twoByTwo"
}

function writeKeyboardLayout(value: KeyboardLayoutMode) {
  const st = storage()
  try {
    if (typeof st?.set === "function") {
      st.set(KEYBOARD_LAYOUT_KEY, value)
      st.set(KEYBOARD_LAYOUT_KEY, value, SHARED_STORAGE_OPTIONS)
    } else if (typeof st?.setString === "function") {
      st.setString(KEYBOARD_LAYOUT_KEY, value)
      st.setString(KEYBOARD_LAYOUT_KEY, value, SHARED_STORAGE_OPTIONS)
    }
  } catch {
  }
}

function playClick() {
  playCaisFeedback(currentFeedbackSettings ?? undefined)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const setTimeoutFn = (globalThis as any).setTimeout
    if (typeof setTimeoutFn === "function") setTimeoutFn(resolve, ms)
    else resolve()
  })
}

let insertHistoryStack: string[] = []
let redoHistoryStack: string[] = []

function insertKeyboardText(text: string) {
  if (!text) return
  keyboard()?.insertText?.(text)
  lastPastedText = text
  insertHistoryStack.push(text)
  redoHistoryStack = []
  if (insertHistoryStack.length > 100) {
    insertHistoryStack = insertHistoryStack.slice(-50)
  }
}

function returnKeySymbol(type?: string): string {
  switch (type) {
    case "search": return "magnifyingglass"
    case "send": return "paperplane.fill"
    case "go": return "arrow.right.circle.fill"
    case "done": return "checkmark"
    case "next": return "arrow.right"
    case "continue": return "arrow.right"
    default: return "return.left"
  }
}

function IconButton(props: {
  systemImage: string
  disabled?: boolean
  tint?: string
  frame?: any
  onPress: () => void | Promise<void>
  onLongPress?: () => void | Promise<void>
}) {
  const tint: any = props.disabled ? "secondaryLabel" : props.tint ?? "label"
  const touchFrame = props.frame ?? { width: 34, height: 36 }
  const width = Number(touchFrame.width ?? 34)
  const height = Number(touchFrame.height ?? 36)
  const visualFrame = { width, height }
  return (
    <ZStack
      alignment="center"
      frame={touchFrame}
      background={"rgba(0,0,0,0.001)" as any}
      contentShape="rect"
      onLongPressGesture={props.onLongPress && !props.disabled ? {
        minDuration: 450,
        perform: () => {
          playClick()
          void props.onLongPress?.()
        },
      } : undefined}
    >
      <ZStack
        alignment="center"
        disabled={props.disabled}
        frame={visualFrame}
        background="clear"
        clipShape={{ type: "rect", cornerRadius: 8 }}
      >
        <Button
          action={() => {
            if (props.disabled) return
            playClick()
            void props.onPress()
          }}
          buttonStyle="glass"
          buttonBorderShape={{ roundedRectangleRadius: 8 }}
          controlSize="mini"
          disabled={props.disabled}
          frame={visualFrame}
        >
          <VStack frame={visualFrame} />
        </Button>
        <Image
          systemName={props.systemImage}
          font="title3"
          foregroundStyle={tint}
          allowsHitTesting={false}
        />
      </ZStack>
    </ZStack>
  )
}

function BottomKey(props: {
  title?: string
  systemImage?: string
  tint?: string
  width?: number
  onPress: () => void | Promise<void>
  onLongPress?: () => void
  onLongPressEnd?: () => void
  highPriorityGesture?: any
  simultaneousGesture?: any
}) {
  const touchFrame = props.width
    ? { width: props.width, height: 42 }
    : { maxWidth: "infinity" as any, height: 42 }
  function keyContent(width: number) {
    const visualFrame = { width, height: 42 }
    return (
      <ZStack
        alignment="center"
        frame={visualFrame}
        background="clear"
        clipShape={{ type: "rect", cornerRadius: 8 }}
      >
        <Button
          action={() => {
            playClick()
            void props.onPress()
          }}
          buttonStyle="glass"
          buttonBorderShape={{ roundedRectangleRadius: 8 }}
          controlSize="mini"
          frame={visualFrame}
        >
          <VStack frame={visualFrame} />
        </Button>
        <HStack
          frame={visualFrame}
          allowsHitTesting={false}
        >
          {props.systemImage ? (
            <Image systemName={props.systemImage} font="title3" foregroundStyle={props.tint as any} />
          ) : (
            <Text font="title3" lineLimit={1} foregroundStyle={props.tint as any}>{props.title ?? ""}</Text>
          )}
        </HStack>
      </ZStack>
    )
  }
  return (
    <ZStack
      alignment="center"
      frame={touchFrame}
      background={"rgba(0,0,0,0.001)" as any}
      contentShape="rect"
      onLongPressGesture={props.onLongPress ? {
        minDuration: 350,
        perform: props.onLongPress,
        onPressingChanged: (pressing: boolean) => {
          if (!pressing) props.onLongPressEnd?.()
        },
      } : undefined}
      highPriorityGesture={props.highPriorityGesture}
      simultaneousGesture={props.simultaneousGesture}
    >
      {props.width ? keyContent(props.width) : (
        <GeometryReader>
          {(proxy) => keyContent(Math.max(1, proxy.size.width))}
        </GeometryReader>
      )}
    </ZStack>
  )
}

function characterCount(value: string | null | undefined): number {
  return Array.from(String(value ?? "")).length
}

function selectedKeyboardText(): string {
  return String(keyboard()?.selectedText ?? "")
}

function renderClipOutput(item: ClipItem, content: string): string {
  return item.manualFavorite ? renderRuntimeTemplate(content, selectedKeyboardText()) : content
}

function clipListKey(items: ClipItem[]): string {
  return items.map((item) => [
    item.id,
    item.updatedAt,
    item.favorite ? "f" : "",
    item.pinned ? "p" : "",
    item.manualFavorite ? "m" : "",
    item.contentHash,
    item.imagePath ?? "",
  ].join(":")).join("|")
}

function clipTileWidthForColumns(availableWidth: number, columns: number): number {
  const minWidth = columns >= 3 ? 80 : 132
  return Math.max(minWidth, Math.floor((Math.max(1, availableWidth) - CLIP_SCROLL_SIDE_PADDING * 2 - CLIP_GRID_SPACING * (columns - 1)) / columns))
}

function clipTileHeightForRows(availableHeight: number, rows: number): number {
  return Math.max(1, Math.floor((Math.max(1, availableHeight) - CLIP_GRID_SPACING * (rows - 1)) / rows))
}

function keyboardLayoutRows(layout: KeyboardLayoutMode): 1 | 2 {
  return layout === "oneByTwo" ? 1 : 2
}

function keyboardLayoutColumns(layout: KeyboardLayoutMode): 2 | 3 {
  return layout === "twoByThree" ? 3 : 2
}

function keyboardLayoutTileCount(layout: KeyboardLayoutMode): number {
  return keyboardLayoutRows(layout) * keyboardLayoutColumns(layout)
}

function nextKeyboardLayout(layout: KeyboardLayoutMode): KeyboardLayoutMode {
  if (layout === "twoByTwo") return "oneByTwo"
  if (layout === "oneByTwo") return "twoByThree"
  return "twoByTwo"
}

function keyboardLayoutIcon(layout: KeyboardLayoutMode): string {
  if (layout === "oneByTwo") return "square.split.2x1"
  if (layout === "twoByThree") return "square.grid.3x2"
  return "square.grid.2x2"
}

type KeyboardMemoItem = {
  id: string
  kind?: "text" | "image"
  title?: string
  text: string
  imagePath?: string
  insertPosition?: "end" | "start"
  enableSubfields?: boolean
  createdAt: number
  updatedAt: number
}

type KeyboardMemoGroup = {
  id: string
  title: string
  collapsed?: boolean
  createdAt: number
  updatedAt: number
  memos: KeyboardMemoItem[]
}

const KEYBOARD_MEMOS_STORAGE_KEY = "cais_keyboard_memos_v1"
const KEYBOARD_MEMO_COLUMNS_KEY = "cais_keyboard_memo_columns_v1"

function createKeyboardMemoId(): string {
  return `memo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeKeyboardMemoGroups(value: any): KeyboardMemoGroup[] {
  const rawGroups = Array.isArray(value?.groups) ? value.groups : Array.isArray(value) ? value : []
  return rawGroups
    .map((group: any) => {
      const title = String(group?.title ?? "").trim()
      if (!title) return null
      const now = Date.now()
      const memos = Array.isArray(group?.memos) ? group.memos : []
      return {
        id: String(group?.id || createKeyboardMemoId()),
        title,
        collapsed: Boolean(group?.collapsed),
        createdAt: Number(group?.createdAt) || now,
        updatedAt: Number(group?.updatedAt) || now,
        memos: memos
          .map((memo: any) => {
            const text = String(memo?.text ?? memo?.content ?? "").trim()
            if (!text) return null
            return {
              id: String(memo?.id || createKeyboardMemoId()),
              title: String(memo?.title ?? "").trim() || undefined,
              kind: memo?.kind === "image" ? "image" : "text",
              text,
              imagePath: String(memo?.imagePath ?? "").trim() || undefined,
              insertPosition: memo?.insertPosition === "start" ? "start" : "end",
              enableSubfields: Boolean(memo?.enableSubfields ?? false),
              createdAt: Number(memo?.createdAt) || now,
              updatedAt: Number(memo?.updatedAt) || now,
            }
          })
          .filter(Boolean) as KeyboardMemoItem[],
      }
    })
    .filter(Boolean) as KeyboardMemoGroup[]
}

function normalizeKeyboardActionColumns(value: any): 2 | 3 | 4 {
  const columns = Math.round(Number(value))
  if (columns === 3 || columns === 4) return columns
  return 2
}

function nextKeyboardActionColumns(columns: number): 2 | 3 | 4 {
  if (columns === 2) return 3
  if (columns === 3) return 4
  return 2
}

function keyboardActionColumnsIcon(columns: number): string {
  if (columns === 4) return "square.grid.3x3"
  if (columns === 3) return "square.grid.3x2"
  return "square.grid.2x2"
}

function readKeyboardMemoColumns(): 2 | 3 | 4 {
  const st = storage()
  try {
    const raw = st?.get?.(KEYBOARD_MEMO_COLUMNS_KEY, SHARED_STORAGE_OPTIONS) ?? st?.getString?.(KEYBOARD_MEMO_COLUMNS_KEY, SHARED_STORAGE_OPTIONS)
    return normalizeKeyboardActionColumns(raw)
  } catch {
  }
  try {
    const raw = st?.get?.(KEYBOARD_MEMO_COLUMNS_KEY) ?? st?.getString?.(KEYBOARD_MEMO_COLUMNS_KEY)
    return normalizeKeyboardActionColumns(raw)
  } catch {
    return 3
  }
}

function writeKeyboardMemoColumns(columns: number) {
  const value = normalizeKeyboardActionColumns(columns)
  const st = storage()
  try {
    if (typeof st?.set === "function") {
      st.set(KEYBOARD_MEMO_COLUMNS_KEY, value)
      st.set(KEYBOARD_MEMO_COLUMNS_KEY, value, SHARED_STORAGE_OPTIONS)
    } else if (typeof st?.setString === "function") {
      st.setString(KEYBOARD_MEMO_COLUMNS_KEY, String(value))
      st.setString(KEYBOARD_MEMO_COLUMNS_KEY, String(value), SHARED_STORAGE_OPTIONS)
    }
  } catch {
  }
}

function readKeyboardMemos(): KeyboardMemoGroup[] {
  const st = storage()
  let raw: any = null
  try {
    raw = st?.get?.(KEYBOARD_MEMOS_STORAGE_KEY, SHARED_STORAGE_OPTIONS) ?? st?.getString?.(KEYBOARD_MEMOS_STORAGE_KEY, SHARED_STORAGE_OPTIONS)
  } catch {
  }
  if (raw == null) {
    try {
      raw = st?.get?.(KEYBOARD_MEMOS_STORAGE_KEY) ?? st?.getString?.(KEYBOARD_MEMOS_STORAGE_KEY)
    } catch {
    }
  }
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = null
    }
  }
  return normalizeKeyboardMemoGroups(raw)
}

function memoListKey(groups: KeyboardMemoGroup[]): string {
  return groups.map((group) => `${group.id}:${group.updatedAt}:${group.collapsed ? "c" : ""}:${group.memos.map((memo) => `${memo.id}:${memo.updatedAt}`).join(",")}`).join("|")
}

type ClipTileMetrics = {
  padding: number
  spacing: number
  showTitle: boolean
  contentLineLimit: number
  iconFont: Font
}

function clipTileMetrics(height: number, rows: number): ClipTileMetrics {
  const compact = height > 0 && height < 96
  const tiny = height > 0 && height < 76
  const minimal = height > 0 && height < 58
  const padding = minimal ? 6 : compact ? 8 : 10
  const spacing = minimal ? 2 : compact ? 4 : 6
  const showTitle = false
  const availableTextHeight = Math.max(18, height - padding * 2)
  const lineHeight = rows <= 1 ? 18 : 17
  const dynamicLineLimit = Math.max(1, Math.floor(availableTextHeight / lineHeight))
  const contentLineLimit = rows <= 1 ? Math.max(1, dynamicLineLimit - 1) : 2
  return {
    padding,
    spacing,
    showTitle,
    contentLineLimit,
    iconFont: tiny ? "caption2" : "caption",
  }
}

function keyboardListCap(settings: CaisSettings): number {
  const configured = settings.keyboardMaxItems > 0 ? settings.keyboardMaxItems : settings.maxItems
  return Math.max(1, Math.min(configured, settings.maxItems))
}

function keyboardPageLimit(settings: CaisSettings, requestedLimit: number): number {
  return Math.max(1, Math.min(Math.max(KEYBOARD_CLIP_PAGE_STEP, requestedLimit), keyboardListCap(settings)))
}

function keyboardTabForStartPage(page: AppStartPage): number {
  return tabForStartPage(page)
}

function keyboardScopeForTab(tab: number): ClipListScope {
  if (tab === TAB_FAVORITES) return "favorites"
  if (tab === TAB_NETWORK) return "all"
  if (tab === TAB_AI) return "clipboard"
  return "clipboard"
}

function keyboardTabShowsClipboardItems(tab: number): boolean {
  return tab === TAB_FAVORITES || tab === TAB_NETWORK || tab === TAB_CLIPS
}

function cachedKeyboardItems(scope: ClipListScope): ClipItem[] {
  return lastKeyboardItemsVersionByScope[scope] === readClipDataVersion() ? lastKeyboardItemsByScope[scope] : []
}

function rememberKeyboardItems(scope: ClipListScope, items: ClipItem[], version = readClipDataVersion()) {
  lastKeyboardItemsByScope[scope] = items
  lastKeyboardItemsKeyByScope[scope] = clipListKey(items)
  lastKeyboardItemsVersionByScope[scope] = version
}

function keyboardRemoteClipItems(settings: CaisSettings, scope: ClipListScope): ClipItem[] {
  const cache = loadRemoteClipCache(settings.syncClipboard)
  if (!cache?.items?.length) return []
  const timeField = settings.remoteTimeDisplay ?? "lastModified"
  return cache.items
    .filter((remote: RemoteClipItem) => {
      if (remote.isDeleted) return false
      if (remote.type === "File" || remote.type === "Group" || remote.type === "Image") return false
      if (scope === "favorites" && !remote.starred) return false
      return scope === "all" || scope === "favorites"
    })
    .map((remote: RemoteClipItem) => {
      const content = remoteItemContent(remote)
      const kind = remote.type === "Image" ? "image" : isLikelyURL(content) ? "url" : "text"
      const displayTime = timeField === "createTime"
        ? Number(remote.createTime || remote.lastModified || remote.fetchedAt || Date.now())
        : Number(remote.lastModified || remote.lastAccessed || remote.createTime || remote.fetchedAt || Date.now())
      const updatedAt = displayTime
      return {
        id: `remote:${remote.profileId || remote.id || `${remote.type}-${remote.hash}`}`,
        kind,
        title: clipTitle(kind, content || remote.dataName || ""),
        content: content || remote.dataName || "",
        contentHash: `remote:${remote.hash || remote.profileId || remote.id}`,
        source: "remote",
        createdAt: Number(remote.createTime || updatedAt),
        updatedAt,
        pinned: Boolean(remote.pinned),
        favorite: Boolean(remote.starred),
        manualFavorite: false,
        deletedAt: null,
      } as ClipItem
    })
}

function mergeKeyboardItems(localItems: ClipItem[], remoteItems: ClipItem[], limit: number): ClipItem[] {
  const seen = new Set<string>()
  const merged = [...localItems, ...remoteItems]
    .filter((item) => {
      const key = item.kind === "image"
        ? `${item.source ?? "local"}:${item.contentHash}`
        : makeRemoteTextProfileId(item.content ?? "")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  return limit > 0 ? merged.slice(0, Math.max(1, limit)) : merged
}

function isTextOrUrlClip(item: ClipItem): boolean {
  return item.kind !== "image"
}

async function getKeyboardClips(settings: CaisSettings, scope: ClipListScope, requestedLimit = KEYBOARD_CLIP_PAGE_STEP): Promise<ClipItem[]> {
  const limit = keyboardPageLimit(settings, requestedLimit)
  const localItems = (await getClips("", limit, scope)).filter(isTextOrUrlClip)
  const remoteItems = keyboardRemoteClipItems(settings, scope)
  return mergeKeyboardItems(localItems, remoteItems, limit)
}

async function refreshKeyboardRemoteClipCache(settings: CaisSettings): Promise<boolean> {
  const sync = settings.syncClipboard
  if (!isRemoteSyncConfigured(sync)) return false
  if (keyboardRemoteRefreshing) return false
  keyboardRemoteRefreshing = true
  try {
    const existing = loadRemoteClipCache(sync)
    const existingItems = mergeRemoteItems([], existing?.items ?? [])
    const modifiedAfter = remoteModifiedAfterForIncrementalSync(existingItems)
    const result = await queryRemoteHistory(sync, { pageNumber: 1, modifiedAfter })
    if (result.status !== "ok") return false
    const merged = mergeRemoteItems(existingItems, result.items)
    saveRemoteClipCache(sync, {
      items: merged,
      page: Math.max(1, existing?.page ?? 1),
      hasMore: false,
      lastSyncAt: Date.now(),
    })
    return result.items.length > 0
  } finally {
    keyboardRemoteRefreshing = false
  }
}

async function keyboardClipContent(item: ClipItem): Promise<string> {
  if (item.source === "remote" || item.id.startsWith("remote:")) return item.content
  return await getFullClipContent(item.id)
}

function remoteClipProfileIdFromKeyboardItem(item: ClipItem): string {
  if (item.id.startsWith("remote:")) return item.id.slice("remote:".length)
  if (item.contentHash.startsWith("remote:")) {
    const hash = item.contentHash.slice("remote:".length)
    const type: SyncClipboardKind = item.kind === "image" ? "Image" : "Text"
    return `${type}-${hash}`
  }
  return ""
}

function splitRemoteProfileId(profileId: string): { type: SyncClipboardKind; hash: string } | null {
  const idx = profileId.indexOf("-")
  if (idx <= 0) return null
  const rawType = profileId.slice(0, idx)
  const hash = profileId.slice(idx + 1)
  if (!hash) return null
  const type = rawType === "Image" ? "Image" : rawType === "File" ? "File" : rawType === "Group" ? "Group" : "Text"
  return { type, hash }
}

function remoteClipKey(item: RemoteClipItem): string {
  return remoteItemKey(item)
}

function findCachedRemoteForKeyboardItem(settings: CaisSettings, item: ClipItem): RemoteClipItem | null {
  const cache = loadRemoteClipCache(settings.syncClipboard)
  if (!cache?.items?.length) return null
  const profileId = remoteClipProfileIdFromKeyboardItem(item)
  const hash = item.contentHash.startsWith("remote:") ? item.contentHash.slice("remote:".length) : ""
  return cache.items.find((remote) => {
    const key = remoteClipKey(remote)
    return Boolean(
      (profileId && key === profileId) ||
      (profileId && remote.profileId === profileId) ||
      (hash && remote.hash === hash)
    )
  }) ?? null
}

async function deleteRemoteForKeyboardItem(settings: CaisSettings, item: ClipItem): Promise<{ ok: boolean; message?: string; remote?: RemoteClipItem | null }> {
  const sync = settings.syncClipboard
  if (!isRemoteSyncConfigured(sync)) return { ok: true, remote: null }
  const cachedRemote = findCachedRemoteForKeyboardItem(settings, item)
  let type: SyncClipboardKind = cachedRemote?.type ?? (item.kind === "image" ? "Image" : "Text")
  let hash = cachedRemote?.hash ?? ""
  let version = cachedRemote?.version
  let profileId = cachedRemote ? remoteClipKey(cachedRemote) : remoteClipProfileIdFromKeyboardItem(item)
  if ((!hash || !profileId) && (item.source === "remote" || item.id.startsWith("remote:"))) {
    const parsed = splitRemoteProfileId(profileId)
    if (parsed) {
      type = parsed.type
      hash = parsed.hash
    }
  }
  if (!hash && item.kind !== "image") {
    const content = await keyboardClipContent(item)
    if (content) {
      type = "Text"
      hash = makeRemoteTextHash(content)
      profileId = `Text-${hash}`
    }
  }
  if (!hash) return { ok: false, message: "无法定位远程记录", remote: cachedRemote }
  const result = await deleteRemoteRecord(sync, type, hash, version)
  if (result.status !== "ok") {
    // Deleting a local item should still succeed if the corresponding remote
    // record has already disappeared.
    if (/404|未找到/.test(result.message)) return { ok: true, remote: cachedRemote }
    return { ok: false, message: result.message, remote: cachedRemote }
  }
  const deletedKey = profileId || `${type}-${hash}`
  updateRemoteClipCacheItems(sync, (items) => items.filter((remote) => remoteClipKey(remote) !== deletedKey && !(remote.type === type && remote.hash === hash)))
  return { ok: true, remote: cachedRemote }
}

export async function preloadKeyboardInitialState(): Promise<KeyboardInitialState> {
  const settings = loadSettings()
  const version = readClipDataVersion()
  const activeTab = keyboardTabForStartPage(settings.defaultStartPage)
  const scope = keyboardScopeForTab(activeTab)
  // 先拿 DB 真实设置（快速 SQLite 读取），远程缓存用它来定位正确的缓存 key
  const dbSettings = await loadSettingsFromDB().catch(() => null)
  const finalSettings = dbSettings ?? settings
  // 预加载 Memo 数据到缓存
  try { await loadMemoGroupsFromDB() } catch {}
  // getKeyboardClips 会同时读本地 SQLite + 远程本地缓存（App Group Storage）
  // 不发网络请求，直接用缓存数据；后台定时器会负责刷新远程
  const items = await getKeyboardClips(finalSettings, scope, KEYBOARD_CLIP_PAGE_STEP)
  rememberKeyboardItems(scope, items, version)
  return { items, settings: finalSettings, version, loaded: true, scope, activeTab }
}

function clipTileBackground(item: ClipItem): any {
  if (item.kind === "image") return "rgba(88,86,214,0.18)"
  if (item.kind === "url") return "rgba(0,122,255,0.16)"
  if (item.manualFavorite) return "rgba(255,149,0,0.16)"
  if (item.favorite) return "rgba(255,204,0,0.16)"
  if (item.pinned) return "rgba(255,59,48,0.14)"
  return "rgba(118,118,128,0.16)"
}

function ClipTile(props: {
  item: ClipItem
  settings: CaisSettings
  tileWidth: number
  tileHeight: number
  tileRows: number
  hideTitle?: boolean
  showSourceBadge?: boolean
  onInsert: (item: ClipItem) => void | Promise<void>
  onTokenize: (item: ClipItem) => void | Promise<void>
  onStatus: (message: string) => void
  onRefresh: () => void | Promise<void>
  onAppear?: () => void
}) {
  const item = props.item
  const isImage = item.kind === "image"
  const previewPath = isImage ? imagePreviewPath(item.imagePath) : undefined
  const tileFrame = { width: props.tileWidth, height: props.tileHeight }
  const tileBackground = clipTileBackground(item)
  const metrics = clipTileMetrics(props.tileHeight, props.tileRows)
  const showTitle = metrics.showTitle
  // 使用 ref 保持回调引用稳定，避免父组件重绘时菜单被重建
  const onRefreshRef = useRef(props.onRefresh)
  onRefreshRef.current = props.onRefresh
  const onStatusRef = useRef(props.onStatus)
  onStatusRef.current = props.onStatus
  const onTokenizeRef = useRef(props.onTokenize)
  onTokenizeRef.current = props.onTokenize
  // 使用 useMemo 稳定 contextMenu 引用，防止父组件重绘时菜单被重建
  const contextMenu = useMemo(() => ({
    menuItems: (
      <ClipTileMenu
        item={item}
        settings={props.settings}
        onRefresh={() => onRefreshRef.current()}
        onStatus={(msg: string) => onStatusRef.current(msg)}
        onTokenize={(i: ClipItem) => onTokenizeRef.current(i)}
      />
    ),
  }), [item.id, item.updatedAt, item.kind, item.contentHash, item.favorite, item.pinned, item.manualFavorite, item.imagePath])
  return (
    <ZStack
      alignment="center"
      frame={tileFrame}
      background={"rgba(0,0,0,0.001)" as any}
      contentShape="rect"
      onAppear={props.onAppear}
      contextMenu={contextMenu}
    >
      <ZStack
        frame={tileFrame}
        background={tileBackground}
        clipShape={{ type: "rect", cornerRadius: 10 } as any}
        clipped
      >
        <Button
          action={() => {
            playClick()
            void props.onInsert(item)
          }}
          buttonStyle="glass"
          buttonBorderShape={{ roundedRectangleRadius: 10 }}
          controlSize="mini"
          frame={tileFrame}
        >
          <VStack frame={tileFrame} />
        </Button>
        <ZStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
          allowsHitTesting={false}
        >
          <VStack
            frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
            padding={metrics.padding}
            spacing={metrics.spacing}
            clipped
          >
            {isImage && previewPath ? (
              <Image
                filePath={previewPath}
                resizable
                scaleToFit
                frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
              />
            ) : isImage ? (
              <Image
                systemName="photo"
                font={props.tileHeight < 76 ? "title2" : "largeTitle"}
                foregroundStyle="secondaryLabel"
                frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" as any }}
              />
            ) : (
              <>
                {showTitle ? (
                  <Text
                    font="headline"
                    lineLimit={1}
                    frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                    multilineTextAlignment="leading"
                  >
                    {item.title}
                  </Text>
                ) : null}
                <Text
                  font="subheadline"
                  foregroundStyle="label"
                  lineLimit={metrics.contentLineLimit}
                  frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
                  multilineTextAlignment="leading"
                >
                  {summarizeContent(item.content, KEYBOARD_TILE_PREVIEW_LIMIT)}
                </Text>
              </>
            )}
          </VStack>
          {props.showSourceBadge ? (
            <HStack
              frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomLeading" as any }}
              padding={{ bottom: metrics.padding, leading: metrics.padding }}
            >
              <Text font={metrics.iconFont} foregroundStyle="secondaryLabel" lineLimit={1}>
                {item.source === "remote" ? "远程" : "本地"}{formatDateTime(item.updatedAt) ? ` · ${formatDateTime(item.updatedAt)}` : ""}
              </Text>
            </HStack>
          ) : null}
          {item.pinned || item.favorite ? (
            <HStack
              spacing={4}
              frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" as any }}
              padding={{ bottom: metrics.padding, trailing: metrics.padding }}
            >
              {item.pinned ? <Image systemName="pin.fill" font={metrics.iconFont} foregroundStyle="systemOrange" /> : null}
              {item.favorite ? <Image systemName="star.fill" font={metrics.iconFont} foregroundStyle="systemYellow" /> : null}
            </HStack>
          ) : null}
        </ZStack>
      </ZStack>
    </ZStack>
  )
}

function ClipTileMenu(props: {
  item: ClipItem
  settings: CaisSettings
  onStatus: (message: string) => void
  onRefresh: () => void | Promise<void>
  onTokenize: (item: ClipItem) => void | Promise<void>
}) {
  const item = props.item
  const isImage = item.kind === "image"
  const builtins = props.settings.keyboardMenu.builtins

  async function copyItem() {
    try {
      const fullContent = isImage ? undefined : renderClipOutput(item, await keyboardClipContent(item))
      await writeClipToPasteboard(item, fullContent)
      if (fullContent) lastPastedText = fullContent
      props.onStatus("已复制")
    } catch (error: any) {
      props.onStatus(String(error?.message ?? error ?? "复制失败"))
    }
  }

  async function sourceText(): Promise<string> {
    let source = selectedKeyboardText()
    if (!source && !isImage) {
      source = renderClipOutput(item, await keyboardClipContent(item))
    }
    return source
  }

  async function saveMenuResult(result: MenuActionResult, source: string) {
    const saveSettings = { ...props.settings, captureText: true, captureImages: true }
    if (result.kind === "text") {
      if (!result.text.trim() || result.text === source) return 0
      const saved = await addClipFromPayload({ kind: "text", text: result.text }, saveSettings)
      await props.onRefresh()
      return saved.status !== "skipped" ? 1 : 0
    }
    if (result.kind === "texts") {
      let savedCount = 0
      for (const text of result.texts) {
        if (!text.trim() || text === source) continue
        const saved = await addClipFromPayload({ kind: "text", text }, saveSettings)
        if (saved.status !== "skipped") savedCount += 1
      }
      await props.onRefresh()
      return savedCount
    }
    if (result.kind === "image") {
      const saved = await addClipFromPayload({ kind: "image", image: result.image }, saveSettings)
      await props.onRefresh()
      return saved.status !== "skipped" ? 1 : 0
    }
    return 0
  }

  async function handleMenuResult(result: MenuActionResult | null, source: string) {
    if (!result) {
      props.onStatus("当前条目不支持该功能")
      return
    }
    if (result.kind === "openUrl") {
      await Safari.openURL(result.url)
      return
    }
    if (result.kind === "text") {
      insertKeyboardText(result.text)
      const saved = await saveMenuResult(result, source)
      props.onStatus(saved ? "已上屏并保存" : "已上屏")
      return
    }
    if (result.kind === "texts") {
      const saved = await saveMenuResult(result, source)
      props.onStatus(saved ? `已拆分保存 ${saved} 条` : "没有新的拆分结果")
      return
    }
    await Pasteboard.setImage(result.image)
    const saved = await saveMenuResult(result, source)
    props.onStatus(saved ? "已写入剪贴板并保存" : "已写入剪贴板")
  }

  async function runBuiltinAction(action: KeyboardMenuBuiltinAction) {
    const source = await sourceText()
    if (!source && !(isImage && action === "base64Encode")) {
      props.onStatus("当前条目不支持该功能")
      return
    }
    if (isImage && action !== "base64Encode") {
      props.onStatus("当前条目不支持该功能")
      return
    }
    try {
      const result = applyBuiltinMenuAction({
        action,
        source,
        imagePath: item.imagePath,
        isImage,
      })
      await handleMenuResult(result, source)
    } catch (error: any) {
      props.onStatus(String(error?.message ?? error ?? `${menuBuiltinTitle(action)}失败`))
    }
  }

  async function runCustomAction(action: KeyboardCustomAction) {
    const source = await sourceText()
    if (!source || isImage) {
      props.onStatus("当前条目不支持该自定义功能")
      return
    }
    try {
      await handleMenuResult(applyCustomMenuAction(action, source), source)
    } catch (error: any) {
      props.onStatus(String(error?.message ?? error ?? "自定义功能执行失败"))
    }
  }

  async function toggleItemPinned() {
    await togglePinned(item)
    await props.onRefresh()
    props.onStatus(item.pinned ? "已取消置顶" : "已置顶")
  }

  async function toggleItemFavorite() {
    await toggleFavorite(item)
    await props.onRefresh()
    props.onStatus(item.favorite ? "已取消收藏" : "已收藏")
  }

  async function deleteItem() {
    const isRemote = item.source === "remote" || item.id.startsWith("remote:")
    if (isRemote) {
      const result = await deleteRemoteForKeyboardItem(props.settings, item)
      if (!result.ok) {
        props.onStatus(`删除远程失败：${result.message ?? "未知错误"}`)
        return
      }
      if (item.kind !== "image") {
        const text = result.remote ? remoteItemContent(result.remote) : item.content
        if (text.trim()) await deleteClipboardTextClipsByContent(text)
      }
      await props.onRefresh()
      props.onStatus(`已删除远程：${item.title}`)
      return
    }
    const result = await deleteRemoteForKeyboardItem(props.settings, item)
    if (!result.ok) {
      props.onStatus(`删除远程失败：${result.message ?? "未知错误"}`)
      return
    }
    await softDeleteClip(item)
    await props.onRefresh()
    props.onStatus(`已删除：${item.title}`)
  }

  function renderBuiltinAction(action: KeyboardMenuBuiltinAction) {
    switch (action) {
      case "tokenize":
        return !isImage && builtins.tokenize ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void props.onTokenize(item)} />
        ) : null
      case "base64Encode":
        return builtins.base64Encode ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "base64Decode":
        return !isImage && builtins.base64Decode ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "cleanWhitespace":
        return !isImage && builtins.cleanWhitespace ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "removeBlankLines":
        return !isImage && builtins.removeBlankLines ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "splitLines":
        return !isImage && builtins.splitLines ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "uppercase":
        return !isImage && builtins.uppercase ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "lowercase":
        return !isImage && builtins.lowercase ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "chineseAmount":
        return !isImage && builtins.chineseAmount ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      case "openUrl":
        return builtins.openUrl && item.kind === "url" ? (
          <Button key={action} title={menuBuiltinTitle(action)} systemImage={menuBuiltinSystemImage(action)} action={() => void runBuiltinAction(action)} />
        ) : null
      default:
        return null
    }
  }

  return (
    <Group>
      <Button title="复制" systemImage="doc.on.doc" action={() => void copyItem()} />
      <Button
        title={item.pinned ? "取消置顶" : "置顶"}
        systemImage={item.pinned ? "pin.slash" : "pin"}
        action={() => void toggleItemPinned()}
      />
      {!item.manualFavorite ? (
        <Button
          title={item.favorite ? "取消收藏" : "收藏"}
          systemImage={item.favorite ? "star.slash" : "star"}
          action={() => void toggleItemFavorite()}
        />
      ) : null}
      {getOrderedMenuBuiltins(props.settings).map((action) => renderBuiltinAction(action))}
      {!isImage ? (
        props.settings.keyboardMenu.customActions
          .filter((action) => action.enabled)
          .map((action) => (
            <Button
              key={action.id}
              title={action.title}
              systemImage={customActionSystemImage(action)}
              action={() => runCustomAction(action)}
            />
          ))
      ) : null}
      <Button title="删除" systemImage="trash" role="destructive" action={() => void deleteItem()} />
    </Group>
  )
}

function memoDisplayTitle(memo: KeyboardMemoItem): string {
  return (memo.title || firstMeaningfulLine(memo.text) || "Memo").trim()
}

function firstMeaningfulLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ""
}

type MemoSubfield = {
  key: string
  value: string
}

function escapeRegexChar(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function memoSubfields(text: string, separators = ":：；"): MemoSubfield[] {
  const chars = Array.from(separators || ":：；").map(escapeRegexChar).join("") || ":：；"
  const regex = new RegExp(`^([^${chars}]{1,32})[${chars}]\\s*(.*)$`)
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const fields: MemoSubfield[] = []
  let current: MemoSubfield | null = null
  for (const line of lines) {
    const match = line.match(regex)
    if (match) {
      if (current && current.value.trim()) fields.push({ key: current.key, value: current.value.trim() })
      current = { key: match[1].trim(), value: match[2].trim() }
      continue
    }
    if (current) {
      current.value = current.value ? `${current.value}\n${line}` : line
    }
  }
  if (current && current.value.trim()) fields.push({ key: current.key, value: current.value.trim() })
  return fields
}

function MemoPanel(props: {
  settings: CaisSettings
  groups: KeyboardMemoGroup[]
  columnsPerRow: number
  onInsertText: (text: string) => void | Promise<void>
  onCopyText: (text: string) => void | Promise<void>
}) {
  const hasGroups = props.groups.some((group) => group.memos.length)
  return (
    <ScrollView axes="vertical" scrollIndicator="hidden" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <VStack spacing={8} frame={{ maxWidth: "infinity", maxHeight: hasGroups ? undefined : "infinity", alignment: hasGroups ? "topLeading" as any : "center" as any }}>
        {hasGroups ? props.groups.filter((group) => group.memos.length).map((group) => (
          <MemoGroupSection
            key={group.id}
            settings={props.settings}
            group={group}
            columnsPerRow={props.columnsPerRow}
            onInsertText={props.onInsertText}
            onCopyText={props.onCopyText}
          />
        )) : (
          <VStack spacing={8} frame={{ maxWidth: "infinity", height: 120, alignment: "center" as any }}>
            <Image systemName="tray" font="title" foregroundStyle="secondaryLabel" />
            <Text foregroundStyle="secondaryLabel">暂无 Memos，请在 CAIS 脚本内添加</Text>
          </VStack>
        )}
      </VStack>
    </ScrollView>
  )
}

function MemoGroupSection(props: {
  settings: CaisSettings
  group: KeyboardMemoGroup
  columnsPerRow: number
  onInsertText: (text: string) => void | Promise<void>
  onCopyText: (text: string) => void | Promise<void>
}) {
  const group = props.group
  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} padding={{ leading: 4 }}>{group.title}</Text>
      <LazyVGrid
        columns={Array.from({ length: normalizeKeyboardActionColumns(props.columnsPerRow) }, () => ({ size: "flexible" as any, spacing: 8 }))}
        spacing={8}
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
      >
        {group.memos.map((memo) => (
          <MemoTile
            key={memo.id}
            settings={props.settings}
            memo={memo}
            onInsertText={props.onInsertText}
            onCopyText={props.onCopyText}
          />
        ))}
      </LazyVGrid>
    </VStack>
  )
}

function KeyboardMemoStatusLine(props: { dashed: boolean }) {
  const lineFill = "systemRed"
  if (props.dashed) {
    return (
      <VStack spacing={2} frame={{ width: 14, height: 18, alignment: "center" as any }}>
        <Capsule fill={lineFill} frame={{ width: 3, height: 4 }} />
        <Capsule fill={lineFill} frame={{ width: 3, height: 4 }} />
        <Capsule fill={lineFill} frame={{ width: 3, height: 4 }} />
      </VStack>
    )
  }
  return (
    <VStack frame={{ width: 14, height: 18, alignment: "center" as any }}>
      <Capsule fill={lineFill} frame={{ width: 3, height: 16 }} />
    </VStack>
  )
}

const KEYBOARD_ACTION_TILE_HEIGHT = 36

function KeyboardActionTile(props: {
  title: string
  disabled?: boolean
  leading?: any
  showLeading?: boolean
  contextMenu?: any
  onPress: () => void | Promise<void>
}) {
  const tileFrame = { maxWidth: "infinity" as any, height: KEYBOARD_ACTION_TILE_HEIGHT }
  return (
    <ZStack
      frame={tileFrame}
      background={props.disabled ? "rgba(118,118,128,0.12)" as any : "rgba(118,118,128,0.22)" as any}
      clipShape={{ type: "rect", cornerRadius: 10 } as any}
      contentShape="rect"
      contextMenu={props.contextMenu}
    >
      <Button
        action={() => {
          if (props.disabled) return
          playClick()
          void props.onPress()
        }}
        buttonStyle="plain"
        disabled={props.disabled}
        frame={tileFrame}
      >
        <HStack spacing={6} frame={{ maxWidth: "infinity", height: KEYBOARD_ACTION_TILE_HEIGHT, alignment: "leading" as any }} padding={{ leading: 8, trailing: 8, top: 3, bottom: 3 }}>
          {props.showLeading === false ? null : (props.leading ?? <KeyboardMemoStatusLine dashed={false} />)}
          <Text
            font="subheadline"
            foregroundStyle={props.disabled ? "secondaryLabel" : "label"}
            lineLimit={1}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
          >
            {props.title}
          </Text>
        </HStack>
      </Button>
    </ZStack>
  )
}

function MemoTile(props: {
  settings: CaisSettings
  memo: KeyboardMemoItem
  onInsertText: (text: string) => void | Promise<void>
  onCopyText: (text: string) => void | Promise<void>
}) {
  const memo = props.memo
  const fields = memo.enableSubfields ? memoSubfields(memo.text, props.settings.memoSubfieldSeparators) : []
  const hasFields = fields.length > 0
  // 用 useMemo 稳定 contextMenu 引用，防止父组件重绘时菜单被重建
  const contextMenu = useMemo(() => ({
    menuItems: (
      <Group>
        <Button title="上屏全部" systemImage="text.cursor" action={() => void props.onInsertText(memo.text)} />
        <Button title="复制全部" systemImage="doc.on.doc" action={() => void props.onCopyText(memo.text)} />
        {hasFields ? fields.map((field, index) => (
          <Button
            key={`${field.key}-${index}`}
            title={field.key}
            systemImage="arrow.turn.down.right"
            action={() => void props.onInsertText(field.value)}
          />
        )) : null}
      </Group>
    ),
  }), [memo.text, memo.enableSubfields, props.settings.memoSubfieldSeparators, props.onInsertText, props.onCopyText])
  const onPress = useMemo(() => () => props.onInsertText(memo.text), [props.onInsertText, memo.text])
  const leading = useMemo(() => <KeyboardMemoStatusLine dashed={Boolean(memo.enableSubfields)} />, [memo.enableSubfields])
  return (
    <KeyboardActionTile
      title={memoDisplayTitle(memo)}
      leading={leading}
      contextMenu={contextMenu}
      onPress={onPress}
    />
  )
}

function EmojiPanel(props: {
  onInsert: (emoji: string) => void
}) {
  const [visibleCategoryId, setVisibleCategoryId] = useState<string>(EMOJI_CATEGORIES[1]?.id ?? EMOJI_CATEGORIES[0].id)

  const ROWS_PER_PAGE = 4
  const GRID_SPACING = 10

  const columnCount = useMemo(
    () => Math.max(5, Math.floor(Device.screen.width / EMOJI_COLUMN_MIN_WIDTH)),
    [],
  )
  const columns = useMemo(
    () => Array.from({ length: columnCount }, () => ({ size: "flexible" as any, spacing: 8 })),
    [columnCount],
  )

  // Build pages with column-major ordering.
  // Step 1: split each category's items into columns of ROWS_PER_PAGE items each.
  // Step 2: bundle columnCount columns into each page.
  // Step 3: flatten each page row-by-row (row-major for LazyVGrid display),
  //          which yields column-major visual order because each column was
  //          pre-filled top-to-bottom.
  const pages = useMemo(() => {
    const result: { key: string; categoryId: string; items: string[] }[] = []
    for (const category of EMOJI_CATEGORIES) {
      // Build columns: each column holds up to ROWS_PER_PAGE items (top→bottom)
      const cols: string[][] = []
      for (let i = 0; i < category.items.length; i += ROWS_PER_PAGE) {
        cols.push(category.items.slice(i, i + ROWS_PER_PAGE))
      }
      // Bundle columns into pages
      for (let p = 0; p < cols.length; p += columnCount) {
        const pageCols = cols.slice(p, p + columnCount)
        const pageItems: string[] = []
        // Flatten: for each row, take the item from each column that has it
        for (let row = 0; row < ROWS_PER_PAGE; row++) {
          for (const col of pageCols) {
            if (row < col.length) pageItems.push(col[row])
          }
        }
        result.push({
          key: `${category.id}-p${Math.floor(p / columnCount)}`,
          categoryId: category.id,
          items: pageItems,
        })
      }
    }
    return result
  }, [columnCount])

  // Quick lookup: page key → category id
  const pageCategoryMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const page of pages) map[page.key] = page.categoryId
    return map
  }, [pages])

  return (
    <VStack spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <GeometryReader>
        {(proxy) => {
          // Reserve space for the bottom category bar.
          const totalHeight = Math.max(1, proxy.size.height - EMOJI_CATEGORY_BAR_HEIGHT - 8)
          // Derive item height so exactly 4 rows fill the available space.
          const itemHeight = Math.max(24, Math.floor((totalHeight - GRID_SPACING * (ROWS_PER_PAGE - 1)) / ROWS_PER_PAGE))
          const fontSize = Math.min(itemHeight - 4, 36)

          return (
            <ScrollViewReader>
              {(scrollProxy) => (
                <VStack spacing={4} frame={{ maxWidth: "infinity", height: proxy.size.height }}>
                  <ScrollView
                    axes="horizontal"
                    scrollIndicator="hidden"
                    onScrollTargetVisibilityChange={{
                      idType: "string",
                      threshold: 0.3,
                      onChanged: (ids) => {
                        const firstId = ids[0] as string | undefined
                        if (firstId) {
                          const catId = pageCategoryMap[firstId]
                          if (catId) setVisibleCategoryId(catId)
                        }
                      },
                    }}
                    frame={{ maxWidth: "infinity", height: totalHeight }}
                  >
                    <LazyHStack spacing={0} scrollTargetLayout>
                      {pages.map((page) => (
                        <VStack key={page.key} padding={{ leading: 8, trailing: 8 }}>
                          <LazyVGrid columns={columns} spacing={GRID_SPACING}>
                            <ForEach
                              count={page.items.length}
                              itemBuilder={(index) => {
                                const emoji = page.items[index]
                                return emoji ? (
                                  <Button
                                    key={`${page.key}-${index}`}
                                    action={() => props.onInsert(emoji)}
                                    buttonStyle="plain"
                                    frame={{ height: itemHeight }}
                                  >
                                    <Text font={{ size: fontSize } as any}>{emoji}</Text>
                                  </Button>
                                ) : (null as any)
                              }}
                            />
                          </LazyVGrid>
                        </VStack>
                      ))}
                    </LazyHStack>
                  </ScrollView>
                  <HStack spacing={4} frame={{ maxWidth: "infinity", height: EMOJI_CATEGORY_BAR_HEIGHT }}>
                    <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity", height: EMOJI_CATEGORY_BAR_HEIGHT }}>
                      <LazyHStack spacing={8} frame={{ height: EMOJI_CATEGORY_BAR_HEIGHT }}>
                        <ForEach
                          count={EMOJI_CATEGORIES.length}
                          itemBuilder={(index) => {
                            const category = EMOJI_CATEGORIES[index]
                            const selected = category.id === visibleCategoryId
                            return (
                              <Button
                                key={category.id}
                                action={() => {
                                  scrollProxy.scrollTo(`${category.id}-p0`)
                                  setVisibleCategoryId(category.id)
                                }}
                                buttonStyle="plain"
                                frame={{ width: 38, height: EMOJI_CATEGORY_BAR_HEIGHT }}
                              >
                                <ZStack
                                  frame={{ width: 38, height: 34 }}
                                  background={selected ? "rgba(118,118,128,0.38)" as any : "clear"}
                                  clipShape="circle"
                                >
                                  <Text font={{ size: 22 } as any} foregroundStyle={selected ? "label" : "secondaryLabel"}>{category.icon}</Text>
                                </ZStack>
                              </Button>
                            )
                          }}
                        />
                      </LazyHStack>
                    </ScrollView>
                  </HStack>
                </VStack>
              )}
            </ScrollViewReader>
          )
        }}
      </GeometryReader>
    </VStack>
  )
}

/**
 * 隔离 useTraits() 响应式钩子，防止 textDidChange/selectionDidChange
 * 事件触发 KeyboardView 整体重渲染（会导致 contextMenu 被重建）。
 */
function TraitsTracker(props: { traitsRef: any }) {
  const traits = keyboard()?.useTraits?.()
  props.traitsRef.current = traits
  return null
}

export function KeyboardView(props: { initialState?: KeyboardInitialState } = {}) {
  const traitsRef = useRef<any>(undefined)
  const pipPresented = useObservable(false)
  const initialSettings = props.initialState?.settings ?? loadSettings()
  const initialTab = props.initialState?.activeTab ?? keyboardTabForStartPage(initialSettings.defaultStartPage)
  const initialScope = keyboardScopeForTab(initialTab)
  const initialItems = props.initialState?.loaded && props.initialState.scope === initialScope
    ? props.initialState.items
    : cachedKeyboardItems(initialScope)
  const initialLoaded = Boolean(props.initialState?.loaded || initialItems.length)
  const initialClipPageLimit = keyboardPageLimit(initialSettings, Math.max(KEYBOARD_CLIP_PAGE_STEP, initialItems.length || KEYBOARD_CLIP_PAGE_STEP))
  const initialMemoGroups = readMemosFromCache()
  const [activeTab, setActiveTab] = useState(initialTab)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const shouldRefreshVisibleClipboardItems = keyboardTabShowsClipboardItems(activeTab)
  const shouldRefreshVisibleClipboardItemsRef = useRef(shouldRefreshVisibleClipboardItems)
  shouldRefreshVisibleClipboardItemsRef.current = shouldRefreshVisibleClipboardItems
  const [memoGroups, setMemoGroups] = useState<KeyboardMemoGroup[]>(() => initialMemoGroups)
  activeKeyboardScope = keyboardScopeForTab(activeTab)
  const [items, setItems] = useState<ClipItem[]>(() => initialItems)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const [, setClipPageLimit] = useState(initialClipPageLimit)
  const clipPageLimitRef = useRef(initialClipPageLimit)
  const [settings, setSettings] = useState<CaisSettings>(() => initialSettings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [keyboardLayout, setKeyboardLayout] = useState<KeyboardLayoutMode>(() => readKeyboardLayout())
  const [memoColumnsPerRow, setMemoColumnsPerRow] = useState<2 | 3 | 4>(() => readKeyboardMemoColumns())
  const [aiColumnsPerRow, setAiColumnsPerRow] = useState<2 | 3 | 4>(() => normalizeKeyboardActionColumns(initialSettings.ai?.columnsPerRow))
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [tokenPage, setTokenPage] = useState<KeyboardTokenPage | null>(null)
  const [emojiMode, setEmojiMode] = useState(false)
  const spaceDragXRef = useRef<number | null>(null)
  const spaceDragConsumedRef = useRef(false)
  const spaceLongPressActiveRef = useRef(false)
  const spaceLongPressTimerRef = useRef<any>(null)
  const spaceSuppressNextPressRef = useRef(false)
  const spaceLongPressFeedbackPlayedRef = useRef(false)
  const [appPipActive, setAppPipActive] = useState(() => readPipControlState().active)
  const appPipActiveRef = useRef(appPipActive)
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>({
    active: false,
    lastMessage: "未启动",
  })
  const didHandleInitialTabEffect = useRef(false)
  const [loading, setLoading] = useState(() => !initialLoaded)
  const [aiInput, setAiInput] = useState("")
  const [aiInputPreviewVisible, setAiInputPreviewVisible] = useState(false)
  const [aiInputPreviewFeedback, setAiInputPreviewFeedback] = useState(0)
  const [aiInitialized, setAiInitialized] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState("")
  const aiLoadingRef = useRef(false)
  currentFeedbackSettings = settings
  appPipActiveRef.current = appPipActive
  const visibleItems = useMemo(() => {
    const filteredItems = items
      .filter((item) => {
        const kind = String(item.kind)
        if (kind === "file") return false // 隐藏文件
        if (kind === "image") return false // 隐藏图片
        return true
      })
    return filteredItems.slice(0, keyboardListCap(settings))
  }, [items, settings.keyboardMaxItems, settings.maxItems, settings.showRemoteFiles, activeTab])

  // 异步从数据库加载最新设置，如果有变化则更新
  useEffect(() => {
    let cancelled = false
    loadSettingsFromDB().then(async (dbSettings) => {
      if (cancelled) return
      const current = settingsRef.current
      const settingsChanged = dbSettings.keyboardMaxItems !== current.keyboardMaxItems ||
        dbSettings.maxItems !== current.maxItems ||
        dbSettings.showRemoteFiles !== current.showRemoteFiles ||
        dbSettings.defaultStartPage !== current.defaultStartPage
      const syncChanged = dbSettings.syncClipboard.enabled !== current.syncClipboard.enabled ||
        dbSettings.syncClipboard.url !== current.syncClipboard.url
      if (settingsChanged || syncChanged) {
        setSettings(dbSettings)
      }
      // 如果远程同步已配置，刷新远程缓存并更新列表
      if (isRemoteSyncConfigured(dbSettings.syncClipboard)) {
        try {
          await refreshKeyboardRemoteClipCache(dbSettings)
        } catch {}
        if (!cancelled) {
          const scope = keyboardScopeForTab(activeTabRef.current)
          const items = await getKeyboardClips(dbSettings, scope, clipPageLimitRef.current)
          if (!cancelled && clipListKey(items) !== clipListKey(itemsRef.current)) setItems(items)
        }
        // 打开键盘时采集本地剪切板并上传到远程
        if (!cancelled && dbSettings.syncClipboard.autoUpload) {
          try {
            const payload = await readPasteboardPayload()
            if (payload) {
              const clipResult = await addClipFromPayload(payload, dbSettings)
              if (clipResult.status === "created" || clipResult.status === "updated") {
                if (payload.kind === "image") {
                  if (dbSettings.syncClipboard.uploadSingleFile) {
                    const image = payload.image
                    if (image) {
                      const pngData = typeof image.toPNGData === "function" ? image.toPNGData() : undefined
                      const jpegData = !pngData && typeof image.toJPEGData === "function" ? image.toJPEGData(0.9) : undefined
                      const data = pngData ?? jpegData
                      const mime = pngData ? "image/png" : "image/jpeg"
                      const name = `clipboard-${Date.now()}.${pngData ? "png" : "jpg"}`
                      if (data) {
                        await uploadCurrentClipboardToRemote(dbSettings.syncClipboard, {
                          type: "Image", text: name, data, dataName: name, dataMimeType: mime,
                        })
                      }
                    }
                  }
                } else if (dbSettings.syncClipboard.uploadText) {
                  const text = payload.kind === "url" ? (payload.url ?? payload.text ?? "") : (payload.text ?? "")
                  if (text.trim()) {
                    await uploadCurrentClipboardToRemote(dbSettings.syncClipboard, { type: "Text", text })
                  }
                }
              }
            }
          } catch (e) {
            console.error("[CAIS][Keyboard] 打开键盘时上传本地剪切板失败", e)
          }
        }
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    currentFeedbackSettings = settings
    prepareCaisFeedback(settings)
    const lifecycle = ++keyboardLifecycleGeneration
    void boot(lifecycle)
    let lastSeenClipDataVersion = props.initialState?.version ?? readClipDataVersion()
    const timer = (globalThis as any).setInterval?.(() => {
      // 先检查tab，非剪贴板tab直接跳过，避免任何不必要的Storage读取
      const currentTab = activeTabRef.current
      if (!keyboardTabShowsClipboardItems(currentTab)) return
      // 更新版本号
      const version = readClipDataVersion()
      const versionChanged = version > lastSeenClipDataVersion
      if (versionChanged) lastSeenClipDataVersion = version
      const pipActive = readPipControlState().active
      if (appPipActiveRef.current !== pipActive) {
        appPipActiveRef.current = pipActive
        setAppPipActive(pipActive)
      }
      if (versionChanged) {
        void refresh(true, lifecycle, activeKeyboardScope)
      }
    }, 900)
    const sync = settings.syncClipboard
    let remoteStopped = false
    let remoteTimer: any = null
    const remoteIntervalMs = Math.max(2, Number(sync.intervalSec) || 5) * 1000
    const scheduleRemoteRefresh = () => {
      if (remoteStopped || !isRemoteSyncConfigured(sync)) return
      remoteTimer = (globalThis as any).setTimeout?.(async () => {
        if (remoteStopped) return
        try {
          const changed = await refreshKeyboardRemoteClipCache(settings)
          if (changed && keyboardTabShowsClipboardItems(activeTabRef.current)) {
            await refresh(true, lifecycle, activeKeyboardScope)
          }
        } catch {
        } finally {
          scheduleRemoteRefresh()
        }
      }, remoteIntervalMs)
    }
    scheduleRemoteRefresh()
    return () => {
      remoteStopped = true
      if (remoteTimer) (globalThis as any).clearTimeout?.(remoteTimer)
      if (keyboardLifecycleGeneration === lifecycle) keyboardLifecycleGeneration += 1
      if (timer) (globalThis as any).clearInterval?.(timer)
      if (keyboardMonitorStartTimer) {
        ;(globalThis as any).clearTimeout?.(keyboardMonitorStartTimer)
        keyboardMonitorStartTimer = null
      }
      stopContinuousDelete()
      stopKeyboardMonitor()
      currentFeedbackSettings = null
      disposeCaisFeedback()
    }
  }, [])

  useEffect(() => {
    if (!didHandleInitialTabEffect.current) {
      didHandleInitialTabEffect.current = true
      return
    }
    const lifecycle = keyboardLifecycleGeneration
    if (activeTab === TAB_MEMOS) {
      void loadMemoGroupsFromDB().then(() => {
        const nextGroups = readMemosFromCache()
        if (memoListKey(nextGroups) !== memoListKey(memoGroups)) setMemoGroups(nextGroups)
        setLoading(false)
      })
      return
    }
    if (activeTab === TAB_AI) {
      if (!aiInitialized) {
        setAiInitialized(true)
        void (async () => {
          try {
            const payload = await readPasteboardPayload()
            const clipboardText = payload?.text ?? payload?.url ?? ""
            if (clipboardText) {
              setAiInput(clipboardText)
            }
          } catch {
          }
        })()
      }
      setLoading(false)
      return
    }
    const scope = keyboardScopeForTab(activeTab)
    activeKeyboardScope = scope
    const resetLimit = keyboardPageLimit(settings, KEYBOARD_CLIP_PAGE_STEP)
    clipPageLimitRef.current = resetLimit
    setClipPageLimit(resetLimit)
    // 切换到剪贴板tab时确保监昕器已启动
    ensureKeyboardMonitor()
    const cached = cachedKeyboardItems(scope)
    if (cached.length) {
      setItems(cached)
      setLoading(false)
    } else {
      setItems([])
      setLoading(true)
    }
    void refresh(true, lifecycle, scope).finally(() => {
      if (lifecycle === keyboardLifecycleGeneration && scope === activeKeyboardScope) setLoading(false)
    })
  }, [activeTab])

  function ensureKeyboardMonitor() {
    if (keyboardMonitorStopper) return
    keyboardMonitorStopper = startClipboardMonitor(settings, (next) => {
      if (next.lastCapturedAt && shouldRefreshVisibleClipboardItemsRef.current) void refresh()
    }, { uploadCurrentToRemote: true })
  }

  function stopKeyboardMonitor() {
    keyboardMonitorStopper?.()
    keyboardMonitorStopper = null
  }

  function scheduleKeyboardMonitor(lifecycle: number) {
    if (keyboardMonitorStartTimer) {
      ;(globalThis as any).clearTimeout?.(keyboardMonitorStartTimer)
    }
    keyboardMonitorStartTimer = (globalThis as any).setTimeout?.(() => {
      keyboardMonitorStartTimer = null
      if (lifecycle !== keyboardLifecycleGeneration) return
      ensureKeyboardMonitor()
    }, 250)
  }

  async function boot(lifecycle: number) {
    if (!initialLoaded) setLoading(true)
    try {
      // 只在显示剪贴板项目的tab上执行refresh
      if (!initialLoaded && keyboardTabShowsClipboardItems(activeTabRef.current)) {
        await refresh(true, lifecycle)
      }
      // 只在剪贴板tab上启动监听器，Memo/AI tab不需要且会导致不必要的写存储
      if (lifecycle === keyboardLifecycleGeneration && keyboardTabShowsClipboardItems(activeTabRef.current)) {
        scheduleKeyboardMonitor(lifecycle)
      }
    } catch {
    } finally {
      // 仅在 loading 为 true 时才调用 setLoading(false)，避免无意义的重绘
      if (lifecycle === keyboardLifecycleGeneration && !initialLoaded) setLoading(false)
    }
  }

  async function refresh(force = false, lifecycle = keyboardLifecycleGeneration, scope = activeKeyboardScope) {
    const generation = ++keyboardRefreshGeneration
    // 刷新远程缓存（如果有配置），确保本地和远程数据一起显示
    if (isRemoteSyncConfigured(settings.syncClipboard) && keyboardTabShowsClipboardItems(activeTabRef.current)) {
      try { await refreshKeyboardRemoteClipCache(settings) } catch {}
    }
    const next = await getKeyboardClips(settings, scope, clipPageLimitRef.current)
    if (lifecycle !== keyboardLifecycleGeneration) return
    if (generation !== keyboardRefreshGeneration) return
    const key = clipListKey(next)
    if (!force && key === lastKeyboardItemsKeyByScope[scope]) return
    rememberKeyboardItems(scope, next)
    if (scope !== activeKeyboardScope) return
    // 避免不必要的重新渲染：只有当内容真正变化时才更新
    const currentKey = clipListKey(itemsRef.current)
    if (key === currentKey) return
    setItems(next)
  }

  function ensureKeyboardLoadMore(index: number) {
    if (activeTab === TAB_MEMOS || activeTab === TAB_AI) return
    if (loading) return
    if (index < Math.max(0, visibleItems.length - KEYBOARD_LOAD_MORE_THRESHOLD)) return
    const current = clipPageLimitRef.current
    if (items.length < current) return
    const next = keyboardPageLimit(settings, current + KEYBOARD_CLIP_PAGE_STEP)
    if (next === current) return
    clipPageLimitRef.current = next
    setClipPageLimit(next)
    void refresh(true)
  }

  async function memoClipboardText(): Promise<string> {
    try {
      const payload = await readPasteboardPayload()
      return payload?.text ?? payload?.url ?? ""
    } catch {
      return ""
    }
  }

  async function renderMemoText(text: string): Promise<string> {
    const clipboardText = text.includes("{{CLIPBOARD}}") ? await memoClipboardText() : ""
    return renderRuntimeTemplate(text, clipboardText)
  }

  async function insertMemoText(text: string) {
    const rendered = await renderMemoText(text)
    insertKeyboardText(rendered)
    lastPastedText = rendered
  }

  async function copyMemoText(text: string) {
    try {
      const rendered = await renderMemoText(text)
      await writeTextToPasteboard(rendered)
      lastPastedText = rendered
    } catch {
    }
  }

  // 使用 ref 保持回调引用稳定，避免 MemoPanel 不必要的重绘
  const insertMemoTextRef = useRef(insertMemoText)
  insertMemoTextRef.current = insertMemoText
  const copyMemoTextRef = useRef(copyMemoText)
  copyMemoTextRef.current = copyMemoText
  const stableInsertMemoText = useMemo(() => (text: string) => insertMemoTextRef.current(text), [])
  const stableCopyMemoText = useMemo(() => (text: string) => copyMemoTextRef.current(text), [])

  async function refreshRemoteNow() {
    if (loading) return
    setLoading(true)
    try {
      await refreshKeyboardRemoteClipCache(settings)
      await refresh(true)
    } catch {
    } finally {
      setLoading(false)
    }
  }

  function pasteLastContent() {
    const fallback = items.find((item) => item.kind !== "image")?.content ?? ""
    const text = lastPastedText || fallback
    if (!text) {
      return
    }
    insertKeyboardText(text)
  }

  function clearInput() {
    const kb = keyboard()
    const before = String(kb?.textBeforeCursor ?? "")
    const after = String(kb?.textAfterCursor ?? "")
    const total = characterCount(before) + characterCount(after)
    if (!total) {
      return
    }
    if (after) kb?.moveCursor?.(characterCount(after))
    for (let index = 0; index < total; index += 1) {
      deleteBackward()
    }
  }

  async function captureNow() {
    setLoading(true)
    try {
      await captureCurrentClipboard(settings, { uploadCurrentToRemote: true })
      await refresh()
    } catch {
    } finally {
      setLoading(false)
    }
  }

  async function insertClip(item: ClipItem) {
    if (item.kind === "image") {
      try {
        await writeClipToPasteboard(item)
      } catch {
      }
      return
    }
    const fullContent = renderClipOutput(item, await keyboardClipContent(item))
    insertKeyboardText(fullContent)
  }

  async function openTokenPage(item: ClipItem) {
    if (item.kind === "image") return
    const fullContent = renderClipOutput(item, await keyboardClipContent(item))
    const tokens = tokenizeWords(fullContent)
    if (!tokens.length) return
    setTokenPage({
      title: item.title,
      tokens,
      selectedIds: [],
    })
  }

  function toggleToken(token: CaisToken) {
    setTokenPage((page) => {
      if (!page) return page
      return {
        ...page,
        selectedIds: page.selectedIds.includes(token.id)
          ? page.selectedIds.filter((id) => id !== token.id)
          : [...page.selectedIds, token.id],
      }
    })
  }

  function clearSelectedTokens() {
    setTokenPage((page) => page ? { ...page, selectedIds: [] } : page)
  }

  function insertSelectedTokens() {
    if (!tokenPage) return
    const text = selectedTokenText(tokenPage.tokens, tokenPage.selectedIds)
    if (!text) return
    insertKeyboardText(text)
    lastPastedText = text
  }

  function deleteBackward() {
    keyboard()?.deleteBackward?.()
  }

  function moveHostCursorBySpaceDrag(direction: number) {
    const kb = keyboard()
    if (direction < 0 && !(kb?.textBeforeCursor ?? "")) return false
    if (direction > 0 && !(kb?.textAfterCursor ?? "")) return false
    kb?.moveCursor?.(direction)
    playClick()
    return true
  }

  function updateSpaceLongPressDrag(details: any) {
    const x = Number(details?.location?.x ?? details?.startLocation?.x ?? 0)
    if (spaceDragXRef.current == null) {
      spaceDragXRef.current = Number(details?.startLocation?.x ?? x)
    }
    const dx = x - spaceDragXRef.current
    const steps = Math.trunc(dx / SPACE_CURSOR_DRAG_STEP)
    if (steps === 0) return false
    const direction = steps < 0 ? -1 : 1
    const moved = moveHostCursorBySpaceDrag(direction)
    spaceDragXRef.current += direction * SPACE_CURSOR_DRAG_STEP
    return moved
  }

  function clearSpaceLongPressTimer() {
    if (!spaceLongPressTimerRef.current) return
    ;(globalThis as any).clearTimeout?.(spaceLongPressTimerRef.current)
    spaceLongPressTimerRef.current = null
  }

  function activateSpaceLongPressDrag() {
    spaceLongPressActiveRef.current = true
    spaceDragXRef.current = null
    if (!spaceLongPressFeedbackPlayedRef.current) {
      spaceLongPressFeedbackPlayedRef.current = true
      playClick()
    }
  }

  function resetSpaceDragState() {
    const shouldSuppressPress = spaceDragConsumedRef.current || spaceLongPressActiveRef.current
    clearSpaceLongPressTimer()
    spaceDragXRef.current = null
    spaceDragConsumedRef.current = false
    spaceLongPressActiveRef.current = false
    spaceLongPressFeedbackPlayedRef.current = false
    if (shouldSuppressPress) spaceSuppressNextPressRef.current = true
  }

  function startSpaceLongPressTracking() {
    resetSpaceDragState()
    spaceLongPressTimerRef.current = (globalThis as any).setTimeout?.(() => {
      spaceLongPressTimerRef.current = null
      activateSpaceLongPressDrag()
    }, 350)
  }

  function spaceDragGesture() {
    return DragGesture({
      minDistance: 0,
      coordinateSpace: "local",
    })
      .onChanged((details: any) => {
        if (!spaceLongPressTimerRef.current && !spaceLongPressActiveRef.current) {
          startSpaceLongPressTracking()
        }
        if (!spaceLongPressActiveRef.current) return
        const moved = updateSpaceLongPressDrag(details)
        spaceDragConsumedRef.current = spaceDragConsumedRef.current || moved
      })
      .onEnded(() => {
        resetSpaceDragState()
      })
  }

  function startContinuousDelete() {
    stopContinuousDelete()
    deleteBackward()
    deleteRepeatTimer = (globalThis as any).setInterval?.(deleteBackward, 75)
  }

  function stopContinuousDelete() {
    if (!deleteRepeatTimer) return
    ;(globalThis as any).clearInterval?.(deleteRepeatTimer)
    deleteRepeatTimer = null
  }

  function startPipMonitor() {
    const status = { active: true, lastMessage: "监听运行中", lastCheckedAt: Date.now() }
    setMonitorStatus(status)
    ensureKeyboardMonitor()
  }

  function stopPipMonitor() {
    stopKeyboardMonitor()
    const status = { active: false, lastMessage: "监听已停止", lastCheckedAt: Date.now() }
    setMonitorStatus(status)
  }

  function toggleClipLayout() {
    setLayoutRevision((value) => value + 1)
    setKeyboardLayout((value) => {
      const next = nextKeyboardLayout(value)
      writeKeyboardLayout(next)
      return next
    })
  }

  function toggleLayoutButton() {
    if (activeTab === TAB_MEMOS) {
      setMemoColumnsPerRow((value) => {
        const next = nextKeyboardActionColumns(value)
        writeKeyboardMemoColumns(next)
        return next
      })
      setLayoutRevision((value) => value + 1)
      return
    }
    if (activeTab === TAB_AI) {
      setAiColumnsPerRow((value) => {
        const next = nextKeyboardActionColumns(value)
        saveSettings({
          ...settings,
          ai: {
            assistants: settings.ai?.assistants ?? [],
            defaultProvider: settings.ai?.defaultProvider ?? "script",
            defaultModelId: settings.ai?.defaultModelId ?? "",
            columnsPerRow: next,
          },
        })
        return next
      })
      setLayoutRevision((value) => value + 1)
      return
    }
    toggleClipLayout()
  }

  function currentLayoutButtonIcon(): string {
    if (activeTab === TAB_MEMOS) return keyboardActionColumnsIcon(memoColumnsPerRow)
    if (activeTab === TAB_AI) return keyboardActionColumnsIcon(aiColumnsPerRow)
    return keyboardLayoutIcon(keyboardLayout)
  }

  async function openPipInApp() {
    if (appPipActive) {
      requestPipStop()
      setAppPipActive(false)
      pipPresented.setValue(false)
      try {
        await Safari.openURL(Script.createRunURLScheme("CAIS", { pip: "0" }))
      } catch {
      }
      return
    }
    const url = Script.createRunURLScheme("CAIS", { pip: "1" })
    requestPipStart()
    setAppPipActive(true)
    pipPresented.setValue(true)
    const status = { active: true, lastMessage: "正在打开 CAIS 主应用", lastCheckedAt: Date.now() }
    setMonitorStatus(status)
    try {
      const ok = await Safari.openURL(url)
      if (!ok) {
        startPipMonitor()
      }
    } catch {
      startPipMonitor()
    }
  }

  async function openCaisApp() {
    try {
      await Safari.openURL(Script.createRunURLScheme("CAIS"))
    } catch (error: any) {
      setMonitorStatus({
        active: Boolean(appPipActive),
        lastMessage: String(error?.message ?? error ?? "打开 CAIS 失败"),
        lastCheckedAt: Date.now(),
      })
    }
  }

  function sendReturn() {
    const kb = keyboard()
    if (typeof kb?.send === "function") {
      kb.send()
      return
    }
    kb?.insertText?.("\n")
  }

  async function dismissToKeyboardHome() {
    await delay(KEYBOARD_EXIT_FEEDBACK_DELAY_MS)
    keyboard()?.dismissToHome?.()
  }

  async function switchToRimeKeyboard() {
    await delay(KEYBOARD_EXIT_FEEDBACK_DELAY_MS)
    const kb = keyboard()
    const target = rimeKeyboardScript()
    await kb?.switchToScript?.(target?.name ?? RIME_KEYBOARD_SCRIPT_NAME)
  }

  function insertEmoji(emoji: string) {
    insertKeyboardText(emoji)
  }

  function spaceKey() {
    return (
      <BottomKey
        systemImage="space"
        onPress={() => {
          if (spaceSuppressNextPressRef.current) {
            spaceSuppressNextPressRef.current = false
            return
          }
          keyboard()?.insertText?.(" ")
        }}
        onLongPress={() => {
          clearSpaceLongPressTimer()
          activateSpaceLongPressDrag()
        }}
        onLongPressEnd={resetSpaceDragState}
        simultaneousGesture={spaceDragGesture()}
      />
    )
  }

  function undoInsert() {
    if (!insertHistoryStack.length) return
    const lastText = insertHistoryStack.pop()!
    redoHistoryStack.push(lastText)
    const len = Array.from(lastText).length
    const kb = keyboard()
    for (let i = 0; i < len; i++) {
      kb?.deleteBackward?.()
    }
  }

  function redoInsert() {
    if (!redoHistoryStack.length) return
    const text = redoHistoryStack.pop()!
    insertHistoryStack.push(text)
    keyboard()?.insertText?.(text)
  }

  async function pasteToAIInput() {
    try {
      const payload = await readPasteboardPayload()
      const text = payload?.text ?? payload?.url ?? ""
      if (!text) {
        setMonitorStatus({ active: Boolean(appPipActive), lastMessage: "剪切板没有文本内容", lastCheckedAt: Date.now() })
        return
      }
      setAiInput(text)
      setAiResult("")
    } catch {
      setMonitorStatus({ active: Boolean(appPipActive), lastMessage: "读取剪切板失败", lastCheckedAt: Date.now() })
    }
  }

  function extractSelectionToAIInput() {
    const selected = selectedKeyboardText()
    if (!selected) {
      setMonitorStatus({ active: Boolean(appPipActive), lastMessage: "请先用光标选中文本", lastCheckedAt: Date.now() })
      return
    }
    setAiInput(selected)
    setAiResult("")
  }

  function closeAIInputPreview() {
    void withAnimation(Animation.easeOut(0.16), () => {
      setAiInputPreviewVisible(false)
    })
  }

  function showAIInputPreview() {
    setAiInputPreviewFeedback((value) => value + 1)
    void withAnimation(Animation.snappy({ duration: 0.18, extraBounce: 0.08 }), () => {
      setAiInputPreviewVisible(true)
    })
  }

  async function runAIAssistant(assistant: { id: string; name: string; systemPrompt: string; provider: string; modelId: string }) {
    const input = aiInput.trim()
    if (!input) {
      setMonitorStatus({ active: Boolean(appPipActive), lastMessage: "请先输入内容", lastCheckedAt: Date.now() })
      return
    }
    if (aiLoadingRef.current) return
    aiLoadingRef.current = true
    setAiLoading(true)
    setAiResult("")
    try {
      const provider: any = assistant.provider === "script" ? undefined : assistant.provider
      const modelId = assistant.provider === "script" ? undefined : (assistant.modelId || undefined)
      const stream = await (globalThis as any).Assistant.requestStreaming({
        systemPrompt: assistant.systemPrompt || undefined,
        messages: [{ role: "user", content: input }],
        provider,
        modelId,
      })
      let resultText = ""
      const reader = stream?.getReader?.()
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value?.type === "text" && value?.content) {
            resultText += value.content
            setAiResult(resultText)
          }
        }
      } else {
        for await (const chunk of (stream as any)) {
          if (chunk?.type === "text" && chunk?.content) {
            resultText += chunk.content
            setAiResult(resultText)
          }
        }
      }
      if (resultText) {
        insertKeyboardText(resultText)
        setAiResult("")
      } else {
        setMonitorStatus({ active: Boolean(appPipActive), lastMessage: "AI 助手返回了空结果", lastCheckedAt: Date.now() })
      }
    } catch (error: any) {
      setMonitorStatus({ active: Boolean(appPipActive), lastMessage: String(error?.message ?? error ?? "AI 请求失败"), lastCheckedAt: Date.now() })
    } finally {
      aiLoadingRef.current = false
      setAiLoading(false)
    }
  }

  const tokenSelectedText = tokenPage ? selectedTokenText(tokenPage.tokens, tokenPage.selectedIds) : ""
  const showRimeKeyboardSwitch = Boolean(settings.showRimeKeyboardSwitch)
  const rimeScript = showRimeKeyboardSwitch ? rimeKeyboardScript() : null

  return (
    <VStack
      spacing={7}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      padding={{ top: 6, bottom: 6, leading: KEYBOARD_ROOT_SIDE_PADDING, trailing: KEYBOARD_ROOT_SIDE_PADDING }}
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
      sensoryFeedback={{ trigger: aiInputPreviewFeedback, feedback: "selection" }}
      overlay={aiInputPreviewVisible ? (
        <ZStack
          alignment="center"
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          background={"rgba(0,0,0,0.18)" as any}
          contentShape="rect"
          onTapGesture={closeAIInputPreview}
          transition={Transition.opacity().animation(Animation.easeOut(0.12))}
        >
          <ZStack
            frame={{ width: Math.max(280, Device.screen.width - 44), height: 154, alignment: "topLeading" as any }}
            background={"rgba(44,44,46,0.96)" as any}
            clipShape={{ type: "rect", cornerRadius: 16 } as any}
            shadow={{ radius: 18, x: 0, y: 8 } as any}
            contentShape="rect"
            transition={Transition.scale(0.92, "center").combined(Transition.opacity()).animation(Animation.snappy({ duration: 0.18, extraBounce: 0.08 }))}
          >
            <ScrollView
              axes="vertical"
              scrollIndicator="visible"
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
              padding={{ leading: 14, trailing: 14, top: 12, bottom: 12 }}
            >
              <Text
                font="body"
                foregroundStyle={aiInput ? "label" : "secondaryLabel"}
                frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                multilineTextAlignment="leading"
                textSelection={false}
              >
                {aiInput || "现在没有内容，请点击右侧的粘贴或提取按钮"}
              </Text>
            </ScrollView>
          </ZStack>
        </ZStack>
      ) : undefined}
    >
      <TraitsTracker traitsRef={traitsRef} />
      {!emojiMode && (<HStack spacing={4} frame={{ maxWidth: "infinity", height: 36, alignment: "leading" as any }}>
        <IconButton
          systemImage="house.fill"
          frame={{ width: 32, height: 36 }}
          onPress={dismissToKeyboardHome}
          onLongPress={openCaisApp}
        />
        {tokenPage ? (
          <ZStack
            frame={{ minWidth: 112, maxWidth: "infinity", height: 36 }}
            background={"rgba(0,0,0,0.001)" as any}
            contentShape="rect"
          >
            <HStack spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "trailing" as any }}>
              <IconButton
                systemImage="chevron.left"
                onPress={() => setTokenPage(null)}
              />
              <IconButton
                systemImage="arrow.counterclockwise.circle"
                tint={tokenSelectedText ? "label" : "secondaryLabel"}
                disabled={!tokenSelectedText}
                onPress={clearSelectedTokens}
              />
              <IconButton
                systemImage="text.cursor"
                tint={tokenSelectedText ? "label" : "secondaryLabel"}
                disabled={!tokenSelectedText}
                onPress={insertSelectedTokens}
              />
            </HStack>
          </ZStack>
        ) : (
          <ZStack
            frame={{ minWidth: showRimeKeyboardSwitch ? 96 : 112, maxWidth: 150, height: 36 }}
            clipShape="capsule"
          >
            <Picker
              title=""
              pickerStyle="segmented"
              value={activeTab}
              onChanged={(index: number) => setActiveTab(index)}
              frame={{ maxWidth: "infinity", height: 36 }}
            >
              <Image systemName={settings.passwordVaultEnabled ? "lock.fill" : tabIcon(TAB_FAVORITES)} tag={TAB_FAVORITES} />
              {/* 本地 tab 暂时注释：剪切板 tab 已作为通用剪切板入口。
              <Image systemName={tabIcon(TAB_CLIPS)} tag={TAB_CLIPS} />
              */}
              <Image systemName={tabIcon(TAB_NETWORK)} tag={TAB_NETWORK} />
              <Image systemName={tabIcon(TAB_MEMOS)} tag={TAB_MEMOS} />
              <Image systemName={tabIcon(TAB_AI)} tag={TAB_AI} />
            </Picker>
          </ZStack>
        )}
        {!tokenPage && showRimeKeyboardSwitch ? (
          <IconButton
            systemImage={rimeScript?.icon ?? "keyboard.fill"}
            frame={{ width: 34, height: 36 }}
            onPress={switchToRimeKeyboard}
          />
        ) : null}
        <ScrollView
          axes="horizontal"
          scrollIndicator="hidden"
          scrollTargetBehavior="viewAlignedLimitAlwaysByOne"
          frame={{ maxWidth: "infinity", height: 36 }}
        >
          <LazyHStack spacing={6} frame={{ height: 36 }} scrollTargetLayout>
            <IconButton systemImage="arrow.clockwise" disabled={loading} onPress={refreshRemoteNow} />
            <IconButton systemImage="doc.on.clipboard" onPress={pasteLastContent} />
            <IconButton systemImage="xmark.circle" onPress={clearInput} />
            <IconButton systemImage="square.and.arrow.down.on.square" disabled={loading} onPress={captureNow} />
            <IconButton systemImage="keyboard.chevron.compact.down" onPress={() => keyboard()?.dismiss?.()} />
            <IconButton
              systemImage={currentLayoutButtonIcon()}
              onPress={toggleLayoutButton}
            />
            <IconButton
              systemImage={appPipActive ? "pip.exit" : "pip.enter"}
              tint={appPipActive ? "systemBlue" : "label"}
              onPress={openPipInApp}
            />
          </LazyHStack>
        </ScrollView>
      </HStack>)}

      {emojiMode ? (
        <EmojiPanel onInsert={insertEmoji} />
      ) : tokenPage ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
          padding={{ leading: CLIP_SCROLL_SIDE_PADDING, trailing: CLIP_SCROLL_SIDE_PADDING }}
        >
          <TokenSelectionPanel
            tokens={tokenPage.tokens}
            selectedIds={tokenPage.selectedIds}
            selectedText={tokenSelectedText}
            compact
            onToggle={toggleToken}
          />
        </VStack>
      ) : activeTab === TAB_MEMOS ? (
        <MemoPanel
          settings={settings}
          groups={memoGroups}
          columnsPerRow={memoColumnsPerRow}
          onInsertText={stableInsertMemoText}
          onCopyText={stableCopyMemoText}
        />
      ) : activeTab === TAB_AI ? (
        <VStack
          spacing={6}
          frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" as any }}
          padding={{ leading: CLIP_SCROLL_SIDE_PADDING, trailing: CLIP_SCROLL_SIDE_PADDING }}
        >
          <HStack spacing={AI_INPUT_ROW_SPACING} frame={{ maxWidth: "infinity", height: AI_INPUT_BAR_HEIGHT, alignment: "top" as any }}>
            <ZStack
              frame={{ width: Math.max(1, Device.screen.width - AI_INPUT_SIDE_PADDING * 2 - AI_INPUT_ACTIONS_WIDTH - AI_INPUT_ROW_SPACING), height: AI_INPUT_BAR_HEIGHT, alignment: "topLeading" as any }}
              background={"rgba(118,118,128,0.14)" as any}
              clipShape={{ type: "rect", cornerRadius: 10 } as any}
              clipped
              contentShape="rect"
              onLongPressGesture={{
                minDuration: 450,
                perform: showAIInputPreview,
              }}
            >
              <Text
                font={aiInput ? "body" : "footnote"}
                foregroundStyle={aiInput ? "label" : "placeholderText"}
                lineLimit={{ max: 3 }}
                minScaleFactor={0.55}
                allowsTightening
                textSelection={false}
                allowsHitTesting={false}
                fixedSize={{ horizontal: false, vertical: false }}
                frame={{ maxWidth: "infinity", height: AI_INPUT_BAR_HEIGHT, alignment: "topLeading" as any }}
                padding={{ leading: 8, trailing: 8, top: 2, bottom: 2 }}
                multilineTextAlignment="leading"
              >
                {aiInput || "现在没有内容，请点击右侧的粘贴或提取按钮"}
              </Text>
            </ZStack>
            <HStack spacing={AI_INPUT_BUTTON_SPACING} frame={{ width: AI_INPUT_ACTIONS_WIDTH, height: AI_INPUT_BUTTON_HEIGHT, alignment: "top" as any }}>
              <IconButton
                systemImage="doc.on.clipboard"
                tint="label"
                frame={{ width: AI_INPUT_BUTTON_WIDTH, height: AI_INPUT_BUTTON_HEIGHT }}
                onPress={pasteToAIInput}
              />
              <IconButton
                systemImage="text.cursor"
                tint="label"
                frame={{ width: AI_INPUT_BUTTON_WIDTH, height: AI_INPUT_BUTTON_HEIGHT }}
                onPress={extractSelectionToAIInput}
              />
            </HStack>
          </HStack>
          {aiLoading ? (
            <VStack frame={{ maxWidth: "infinity", height: 48, alignment: "center" as any }}>
              <ProgressView />
            </VStack>
          ) : null}
          <ScrollView axes="vertical" scrollIndicator="hidden" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
            {(() => {
              const assistants = settings.ai?.assistants ?? []
              if (!assistants.length) {
                return (
                  <VStack spacing={8} frame={{ maxWidth: "infinity", height: 120, alignment: "center" as any }}>
                    <Image systemName="brain" font="title" foregroundStyle="secondaryLabel" />
                    <Text foregroundStyle="secondaryLabel">暂无 AI 助手，请在 CAIS 主应用的 AI 页面添加</Text>
                  </VStack>
                )
              }
              const gridColumns = Array.from({ length: aiColumnsPerRow }, () => ({ size: "flexible" as any, spacing: 8 }))
              return (
                <LazyVGrid
                  columns={gridColumns}
                  spacing={8}
                  frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                >
                  {assistants.map((assistant: any) => (
                    <KeyboardActionTile
                      key={assistant.id}
                      title={assistant.name}
                      disabled={aiLoading}
                      showLeading={false}
                      onPress={() => runAIAssistant(assistant)}
                    />
                  ))}
                </LazyVGrid>
              )
            })()}
          </ScrollView>
        </VStack>
      ) : activeTab === TAB_FAVORITES && settings.passwordVaultEnabled ? (
        <PasswordVaultPanel />
      ) : (
        <GeometryReader>
          {(proxy) => {
            const rowCount = keyboardLayoutRows(keyboardLayout)
            const columnCount = keyboardLayoutColumns(keyboardLayout)
            const gridHeight = Math.max(1, proxy.size.height)
            const tileHeight = clipTileHeightForRows(gridHeight, rowCount)
            const tileWidth = clipTileWidthForColumns(proxy.size.width, columnCount)
            const clipColumns = Array.from({ length: columnCount }, () => ({ size: "flexible" as any, spacing: CLIP_GRID_SPACING }))
            const hideTitle = true
            return (
              <ScrollView
                key={`clip-scroll-${keyboardLayout}-${layoutRevision}-${activeTab}`}
                axes="vertical"
                scrollIndicator="hidden"
                frame={{ maxWidth: "infinity", height: gridHeight }}
                padding={{ leading: CLIP_SCROLL_SIDE_PADDING, trailing: CLIP_SCROLL_SIDE_PADDING }}
                refreshable={async () => { await refresh(true) }}
              >
                {visibleItems.length ? (
                  <LazyVGrid
                    columns={clipColumns}
                    spacing={CLIP_GRID_SPACING}
                    frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
                  >
                    <ForEach
                      count={visibleItems.length}
                      itemBuilder={(index) => {
                        const item = visibleItems[index]
                        return item ? (
                          <ClipTile
                            key={item.id}
                            item={item}
                            settings={settings}
                            tileWidth={tileWidth}
                            tileHeight={tileHeight}
                            tileRows={rowCount}
                            hideTitle={hideTitle}
                            showSourceBadge={activeTab === TAB_NETWORK}
                            onInsert={insertClip}
                            onTokenize={openTokenPage}
                            onRefresh={refresh}
                            onStatus={() => {}}
                            onAppear={() => ensureKeyboardLoadMore(index)}
                          />
                        ) : (null as any)
                      }}
                    />
                  </LazyVGrid>
                ) : loading ? (
                  <VStack
                    frame={{ width: Math.max(300, Device.screen.width - 28), height: gridHeight, alignment: "center" as any }}
                    spacing={8}
                  >
                    <ProgressView />
                  </VStack>
                ) : (
                  <VStack
                    frame={{ width: Math.max(300, Device.screen.width - 28), height: gridHeight, alignment: "center" as any }}
                    spacing={8}
                  >
                    <Image systemName={tabIcon(activeTab)} font="largeTitle" foregroundStyle="secondaryLabel" />
                    <Text foregroundStyle="secondaryLabel">
                      {activeTab === TAB_FAVORITES ? "暂无收藏" : "暂无剪切板记录"}
                    </Text>
                  </VStack>
                )}
              </ScrollView>
            )
          }}
        </GeometryReader>
      )}

      <HStack spacing={6} frame={{ maxWidth: "infinity", height: 42 }}>
        {/* <BottomKey systemImage="globe" width={46} onPress={() => keyboard()?.nextKeyboard?.()} /> */}
        <BottomKey
          systemImage="face.smiling"
          tint={emojiMode ? "systemBlue" : undefined}
          width={46}
          onPress={() => {
            setEmojiMode((value) => !value)
            setTokenPage(null)
          }}
        />
        <BottomKey
          systemImage="arrow.uturn.backward"
          width={46}
          onPress={undoInsert}
        />
        <BottomKey
          systemImage="arrow.uturn.forward"
          width={46}
          onPress={redoInsert}
        />
        {spaceKey()}
        <BottomKey
          systemImage="delete.left"
          width={46}
          onPress={deleteBackward}
          onLongPress={startContinuousDelete}
          onLongPressEnd={stopContinuousDelete}
        />
        <BottomKey
          title={undefined}
          systemImage={returnKeySymbol(traitsRef.current?.returnKeyType)}
          width={68}
          onPress={sendReturn}
        />
      </HStack>
    </VStack>
  )
}
