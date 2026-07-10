// shared/carrier/cards/medium/common.tsx
import { VStack, HStack } from "scripting"
import { outerCardBg } from "../../theme"

export type MediumStyleKey = "FullRing" | "DialRing"

export type MediumCommonProps = {
  feeTitle: string
  feeText: string
  logoPath: string
  updateTime: string

  flowTitle: string
  flowValueText: string
  flowRatio: number
  flowUsed?: number
  flowTotal?: number
  usageBars?: {
    mode: "24h" | "12h" | "6h"
    bucketMinutes: number
    valuesMB: number[]
    generalValuesMB?: number[]
    directionalValuesMB?: number[]
    updatedAt: number
  }
  mediumHourlyBarBaseMB?: number

  otherTitle?: string
  otherValueText?: string
  otherRatio?: number
  otherUsed?: number
  otherTotal?: number

  voiceTitle: string
  voiceValueText: string
  voiceRatio: number
}

export function MediumOuter(props: { children: any }) {
  const { children } = props
  return (
    <VStack
      alignment="center"
      padding={{ top: 10, leading: 10, bottom: 10, trailing: 10 }}
      widgetBackground={{
        style: outerCardBg,
        shape: { type: "rect", cornerRadius: 24, style: "continuous" },
      }}
    >
      <HStack alignment="center" spacing={10}>
        {children}
      </HStack>
    </VStack>
  )
}