/**
 * CAIS 共享 Tab 配置 —— 一处修改，AppRoot 和 KeyboardView 同步更新。
 */

export const TAB_FAVORITES = 0
export const TAB_CLIPS = 1
export const TAB_NETWORK = 2
export const TAB_MEMOS = 3
export const TAB_AI = 4
export const TAB_SETTINGS = 5

/** AppRoot 显示的 tab 顺序（排除已注释的"本地"tab） */
export const APP_TAB_ORDER: readonly number[] = [TAB_FAVORITES, TAB_NETWORK, TAB_MEMOS, TAB_AI, TAB_SETTINGS]

/** KeyboardView 显示的 tab 顺序（排除已注释的"本地"tab，不含设置） */
export const KEYBOARD_TAB_ORDER: readonly number[] = [TAB_FAVORITES, TAB_NETWORK, TAB_MEMOS, TAB_AI]

export interface TabDescriptor {
  title: string
  icon: string // SF Symbol name
}

export const TAB_DESCRIPTORS: Readonly<Record<number, TabDescriptor>> = {
  [TAB_FAVORITES]: { title: "收藏", icon: "star" },
  [TAB_CLIPS]:     { title: "本地", icon: "doc.on.clipboard" },
  [TAB_NETWORK]:   { title: "剪切板", icon: "doc.on.clipboard" },
  [TAB_MEMOS]:     { title: "Memos", icon: "text.book.closed" },
  [TAB_AI]:        { title: "AI", icon: "brain" },
  [TAB_SETTINGS]:  { title: "设置", icon: "gearshape" },
}

export function tabTitle(tab: number): string {
  return TAB_DESCRIPTORS[tab]?.title ?? ""
}

export function tabIcon(tab: number): string {
  return TAB_DESCRIPTORS[tab]?.icon ?? "questionmark"
}

/** AppStartPage → tab 映射（legacy 兼容） */
export function tabForStartPage(page: string | undefined): number {
  switch (page) {
    case "favorites": return TAB_FAVORITES
    case "clipboard":
    case "network": return TAB_NETWORK
    case "memos": return TAB_MEMOS
    case "ai": return TAB_AI
    case "settings": return TAB_SETTINGS
    default: return TAB_FAVORITES
  }
}
