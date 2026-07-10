// shared/carrier/cards/medium/index.tsx
import type { MediumCommonProps, MediumStyleKey } from "./common"

import { FullRingCardStyle } from "./styles/FullRingCardStyle"

export type { MediumCommonProps, MediumStyleKey }

export function MediumLayout(props: MediumCommonProps & { layout: MediumStyleKey }) {
  const { layout: _layout, ...rest } = props
  // 中号组件已按用户图示统一重写：不再使用旧圆环/仪表盘四卡布局。
  return <FullRingCardStyle {...rest} />
}

export const MEDIUM_STYLE_OPTIONS: Array<{ key: MediumStyleKey; nameCN: string; nameEN: string }> = [
  { key: "FullRing", nameCN: "全圆环", nameEN: "FullRing" },
  { key: "DialRing", nameCN: "仪表盘", nameEN: "DialRing" },
]