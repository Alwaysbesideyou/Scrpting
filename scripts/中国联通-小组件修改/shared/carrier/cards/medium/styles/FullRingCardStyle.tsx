// shared/carrier/cards/medium/styles/FullRingCardStyle.tsx
import { VStack, HStack, Text, Spacer, Rectangle, Widget, ZStack } from "scripting"

import type { MediumCommonProps } from "../common"
import { outerCardBg } from "../../../theme"
import { clamp01, formatFlowValue } from "../../../utils/carrierUtils"

const titleColor = { light: "rgba(0,0,0,0.72)", dark: "rgba(255,255,255,0.88)" } as const
const primaryText = { light: "rgba(0,0,0,0.92)", dark: "rgba(255,255,255,0.96)" } as const
const secondaryText = { light: "rgba(0,0,0,0.62)", dark: "rgba(255,255,255,0.78)" } as const
const trackColor = { light: "rgba(0,0,0,0.10)", dark: "rgba(255,255,255,0.14)" } as const
const flowBlue = { light: "#1298FF", dark: "#1298FF" } as const
const flowPurple = { light: "#8E6BFF", dark: "#8E6BFF" } as const

type DayBarItem = { generalRatio: number; directionalRatio: number; totalRatio: number; active: boolean }

function toFixedOneText(text: string): string {
  const match = String(text || "").trim().match(/^([0-9]+(?:\.[0-9]+)?)(.*)$/)
  if (!match) return text
  const n = Number(match[1])
  if (!Number.isFinite(n)) return text
  return `${n.toFixed(1)}${match[2]}`
}

function flowTotalSubtitle(totalMB?: number, ratio?: number): string {
  const total = formatFlowValue(Math.max(0, Number(totalMB || 0)), "MB")
  const totalText = `${Number(total.balance).toFixed(1)}${total.unit}`
  return `${totalText}(${(clamp01(ratio ?? 0) * 100).toFixed(1)}%)`
}

function FlowSummaryBlock(props: {
  title: string
  valueText: string
  totalMB?: number
  ratio?: number
  tint: typeof flowBlue | typeof flowPurple
  cardWidth?: number
}) {
  const { title, valueText, totalMB, ratio, tint, cardWidth } = props
  const progressRatio = clamp01(ratio ?? 0)
  const progressHeight = progressRatio <= 0 ? 0 : Math.max(4, Math.round(progressRatio * 50))
  const w = cardWidth ?? 120

  return (
    <VStack alignment="leading" spacing={4} frame={{ width: w }}>
      <Text font={13} fontWeight="semibold" foregroundStyle={titleColor} lineLimit={1} frame={{ height: 16 }}>
        {title}
      </Text>
      <HStack alignment="top" spacing={12} frame={{ width: w }}>
        <VStack
          alignment="center"
          spacing={0}
          frame={{ width: 8, height: 52 }}
          widgetBackground={{
            style: trackColor,
            shape: { type: "rect", cornerRadius: 4, style: "continuous" },
          }}
        >
          <Spacer minLength={0} />
          {progressHeight > 0 ? (
            <Rectangle
              fill={tint}
              frame={{ width: 8, height: progressHeight }}
              clipShape={{ type: "capsule", style: "continuous" }}
              widgetBackground={{
                style: tint,
                shape: { type: "rect", cornerRadius: 4, style: "continuous" },
              }}
            />
          ) : null}
        </VStack>
        <VStack alignment="leading" spacing={2} frame={{ minWidth: 0, maxWidth: Infinity, height: 52 }}>
          <Text font={28} fontWeight="semibold" foregroundStyle={primaryText} lineLimit={1} minScaleFactor={0.72}>
            {toFixedOneText(valueText)}
          </Text>
          <Spacer minLength={0} />
          <Text font={16} fontWeight="medium" foregroundStyle={secondaryText} lineLimit={1} minScaleFactor={0.72}>
            {flowTotalSubtitle(totalMB, ratio)}
          </Text>
        </VStack>
      </HStack>
    </VStack>
  )
}

function FeeVoicePanel(props: {
  feeText: string
  voiceTitle: string
  voiceValueText: string
  panelWidth?: number
}) {
  const { feeText, voiceTitle, voiceValueText, panelWidth } = props
  const w = panelWidth ?? 72

  return (
    <VStack alignment="leading" spacing={4} frame={{ width: w }}>
      <Text font={11} fontWeight="medium" foregroundStyle={titleColor} lineLimit={1}>
        剩余话费
      </Text>
      <Text font={15} fontWeight="semibold" foregroundStyle={primaryText} lineLimit={1} minScaleFactor={0.72}>
        {feeText || "-"}
      </Text>
      <Spacer minLength={0} />
      <Text font={11} fontWeight="medium" foregroundStyle={titleColor} lineLimit={1}>
        {voiceTitle || "剩余语音"}
      </Text>
      <Text font={15} fontWeight="semibold" foregroundStyle={primaryText} lineLimit={1} minScaleFactor={0.72}>
        {voiceValueText || "-"}
      </Text>
    </VStack>
  )
}

function normalizeHourlyBaseMB(v?: number): number {
  const n = Number(v)
  return n === 100 || n === 300 || n === 500 || n === 1024 || n === 2048 ? n : 500
}

function dayBarItems(usageBars?: MediumCommonProps["usageBars"], hourlyBaseMB = 500): DayBarItem[] {
  const totalValues = Array.isArray(usageBars?.valuesMB) ? usageBars.valuesMB : []
  const generalValues = Array.isArray(usageBars?.generalValuesMB) ? usageBars.generalValuesMB : totalValues
  const directionalValues = Array.isArray(usageBars?.directionalValuesMB) ? usageBars.directionalValuesMB : []
  const count = Math.max(totalValues.length, generalValues.length, directionalValues.length)
  const baseMB = normalizeHourlyBaseMB(hourlyBaseMB)
  const totals = Array.from({ length: count }, (_, index) => {
    const explicitTotal = Number(totalValues[index])
    if (Number.isFinite(explicitTotal) && explicitTotal > 0) return explicitTotal
    return Math.max(0, Number(generalValues[index]) || 0) + Math.max(0, Number(directionalValues[index]) || 0)
  })
  const scaleMaxMB = Math.max(baseMB, ...totals)

  return Array.from({ length: count }, (_, index) => {
    const generalMB = Math.max(0, Number(generalValues[index]) || 0)
    const directionalMB = Math.max(0, Number(directionalValues[index]) || 0)
    const totalMB = Math.max(0, generalMB + directionalMB)
    return {
      generalRatio: clamp01(generalMB / scaleMaxMB),
      directionalRatio: clamp01(directionalMB / scaleMaxMB),
      totalRatio: clamp01(totalMB / scaleMaxMB),
      active: totalMB > 0,
    }
  })
}

function DailyUsageBars(props: { usageBars?: MediumCommonProps["usageBars"]; hourlyBaseMB?: number }) {
  const bars = dayBarItems(props.usageBars, props.hourlyBaseMB)
  const maxBarHeight = 42
  const barWidth = 7
  const chartWidth = 306
  const barCount = Math.max(1, bars.length)
  const barSpacing = barCount > 1 ? Math.max(4, (chartWidth - barCount * barWidth) / (barCount - 1)) : 0

  return (
    <VStack spacing={1} frame={{ minWidth: 0, maxWidth: Infinity }}>
      <HStack alignment="bottom" spacing={barSpacing} frame={{ width: chartWidth, height: 44 }}>
        {bars.map((bar, index) => {
          const generalHeight = Math.max(0, Math.round(bar.generalRatio * maxBarHeight))
          const directionalHeight = Math.max(0, Math.round(bar.directionalRatio * maxBarHeight))
          const totalHeight = Math.min(maxBarHeight, Math.max(0, Math.round(bar.totalRatio * maxBarHeight)))
          const purpleHeight = Math.min(directionalHeight, totalHeight)
          const blueHeight = Math.min(generalHeight, Math.max(0, totalHeight - purpleHeight))
          const active = bar.active && totalHeight > 0
          return (
            <ZStack key={`bar-${index}`} alignment="bottom" frame={{ width: barWidth, height: 44 }}>
              <Rectangle fill={trackColor} frame={{ width: 1, height: maxBarHeight }} />
              <VStack alignment="center" spacing={0} frame={{ width: barWidth, height: maxBarHeight }}>
                <Spacer minLength={0} />
                {active && purpleHeight > 0 ? <Rectangle fill={flowPurple} frame={{ width: barWidth, height: purpleHeight }} /> : null}
                {active && blueHeight > 0 ? <Rectangle fill={flowBlue} frame={{ width: barWidth, height: blueHeight }} /> : null}
              </VStack>
            </ZStack>
          )
        })}
      </HStack>
      <HStack alignment="center" frame={{ width: chartWidth }}>
        <Text font={11} fontWeight="semibold" foregroundStyle={secondaryText} lineLimit={1} frame={{ width: 18, alignment: "leading" }}>00</Text>
        <Spacer minLength={0} />
        <Text font={11} fontWeight="semibold" foregroundStyle={secondaryText} lineLimit={1} frame={{ width: 18, alignment: "center" }}>06</Text>
        <Spacer minLength={0} />
        <Text font={11} fontWeight="semibold" foregroundStyle={secondaryText} lineLimit={1} frame={{ width: 18, alignment: "center" }}>12</Text>
        <Spacer minLength={0} />
        <Text font={11} fontWeight="semibold" foregroundStyle={secondaryText} lineLimit={1} frame={{ width: 18, alignment: "center" }}>18</Text>
        <Spacer minLength={0} />
        <Text font={11} fontWeight="semibold" foregroundStyle={secondaryText} lineLimit={1} frame={{ width: 18, alignment: "trailing" }}>23</Text>
      </HStack>
    </VStack>
  )
}

/**
 * 图示版中号组件：上方左右两栏分别显示通用/定向流量，底部整行用 24 小时柱状图表达当天流量使用节奏。
 */
export function FullRingCardStyle(props: MediumCommonProps) {
  const {
    flowTitle,
    flowValueText,
    flowRatio,
    flowUsed,
    flowTotal,
    otherTitle,
    otherValueText,
    otherRatio,
    otherUsed,
    otherTotal,
    feeText,
    voiceTitle,
    voiceValueText,
    usageBars,
    mediumHourlyBarBaseMB,
  } = props

  return (
    <VStack
      alignment="center"
      spacing={8}
      padding={{ top: 12, leading: 12, bottom: 8, trailing: 12 }}
      widgetBackground={Widget.isTransparentBackground ? undefined : {
        style: outerCardBg,
        shape: { type: "rect", cornerRadius: 24, style: "continuous" },
      }}
    >
      <HStack alignment="top" spacing={8} frame={{ minWidth: 0, maxWidth: Infinity }}>
        <FlowSummaryBlock
          title="通用流量"
          valueText={flowValueText}
          totalMB={flowTotal}
          ratio={flowRatio}
          tint={flowBlue}
        />
        <FlowSummaryBlock
          title="定向流量"
          valueText={otherValueText || "0MB"}
          totalMB={otherTotal}
          ratio={otherRatio}
          tint={flowPurple}
        />
        <Spacer minLength={4} />
        <FeeVoicePanel
          feeText={feeText || "-"}
          voiceTitle={voiceTitle || "剩余语音"}
          voiceValueText={voiceValueText || "-"}
        />
      </HStack>

      <DailyUsageBars usageBars={usageBars} hourlyBaseMB={mediumHourlyBarBaseMB} />
    </VStack>
  )
}
