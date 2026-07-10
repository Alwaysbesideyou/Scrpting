import {
  Button,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"
import {
  compressedWidgetPhotoPath,
  holidayCountdownDays,
  nextHoliday,
  nextSpecialNumberInfo,
  parseDate,
  PlaceholderPhoto,
  readSettings,
  RemainingDaysLabel,
  selectedPhotoStack,
  StackedPhotoView,
  startOfDay,
  dayDiff,
  WidgetButtonFont,
  WidgetMetricRow,
  clamp,
} from "./widget-common"
import { ShowNextPhotoIntent } from "./app_intents"

const WidgetWidth = 140
const WidgetHeight = 160
const WidgetPhotoHeight = 96
const WidgetPhotoWidth = WidgetPhotoHeight * 0.8

function SmallMetricRow(props: {
  icon: string
  left: string
  right: number
}) {
  return (
    <WidgetMetricRow
      icon={props.icon}
      left={props.left}
      right={props.right}
      spacing={3}
      iconFont={16}
      iconSize={9}
      numberFont={16}
    />
  )
}

function SmallProgressBar(props: { progress: number; remaining: number; width?: number }) {
  const width = props.width ?? 42
  const progress = clamp(props.progress, 0, 1)
  const fillWidth = Math.max(4, Math.round(width * progress))
  const fillColor = props.remaining <= 3 ? "rgba(255, 59, 48, 1)" : "rgba(255, 74, 122, 1)"

  return (
    <ZStack alignment="leading" frame={{ width, height: 8 }}>
      <VStack
        frame={{ width, height: 8 }}
        background="rgba(255, 74, 122, 0.22)"
        clipShape={{ type: "rect", cornerRadius: 4 }}
      />
      <VStack
        frame={{ width: fillWidth, height: 8 }}
        background={fillColor}
        clipShape={{ type: "rect", cornerRadius: 4 }}
      />
    </ZStack>
  )
}

function SmallProgressOrRemaining(props: {
  progress: number
  remaining: number
}) {
  if (props.remaining <= 30) {
    return <RemainingDaysLabel remaining={props.remaining} numberFont={16} />
  }

  return <SmallProgressBar progress={props.progress} remaining={props.remaining} width={45} />
}

export function SmallWidget() {
  const settings = readSettings()
  const today = startOfDay(new Date())
  const daysTogether = Math.max(0, dayDiff(parseDate(settings.startDate), today) + 1)
  const multiple = nextSpecialNumberInfo(settings, daysTogether)
  const holiday = nextHoliday(settings, today)
  const holidayRemainingDays = holidayCountdownDays(today, holiday)
  const photoStackItems = selectedPhotoStack(settings)
  const selected = photoStackItems[0] ?? null
  const photo = compressedWidgetPhotoPath(selected?.path ?? null)
  const photoStack = photoStackItems.map((item: { path: string }) => compressedWidgetPhotoPath(item.path))

  return (
    <ZStack>
      {photo ? (
        <Image
          filePath={photo}
          resizable
          scaleToFill
          frame={{ maxWidth: 200, maxHeight: 200 }}
          blur={8}
          clipped
        />
      ) : (
        <PlaceholderPhoto />
      )}
      <VStack frame={{ maxWidth: 200, maxHeight: 200 }} background="regularMaterial" opacity={0.96} />

      <VStack alignment="center" frame={{ maxWidth: WidgetWidth, maxHeight: WidgetHeight }}>
        <HStack alignment="center" frame={{ maxWidth: WidgetWidth }}>
          <Button buttonStyle="plain" intent={ShowNextPhotoIntent(undefined)}>
            <StackedPhotoView
              paths={photoStack}
              width={WidgetPhotoWidth}
              height={WidgetPhotoHeight}
              radius={13}
              offStepX={5}
              offStepY={-3}
            />
          </Button>
          <Spacer minLength={0} />
          <VStack alignment="trailing" spacing={0} frame={{ height: WidgetPhotoHeight }}>
            <Text font={17} shadow={{ color: "rgba(0,0,0,0.30)", radius: 4 }}>{settings.emoji || "💗"}</Text>
            <Spacer />
          </VStack>
        </HStack>
        <VStack frame={{ maxWidth: WidgetWidth }} padding={{ top: 0 }}>
          <SmallMetricRow
            icon="calendar"
            left={holiday.name}
            right={holidayRemainingDays}
          />
          <HStack spacing={3} frame={{ maxWidth: "infinity" }} padding={{ top: -8, bottom: 0 }}>
            <Image
              systemName="heart.fill"
              font={16}
              imageScale="small"
              foregroundStyle="rgba(255,255,255,0.88)"
              frame={{ width: 9, height: 9 }}
            />
            <Text {...WidgetButtonFont} lineLimit={1}>
              {`相恋`}
            </Text>
            <Text {...WidgetButtonFont} font={18} foregroundStyle="label" lineLimit={1}>
              {`${daysTogether}`}
            </Text>
            <Text {...WidgetButtonFont} lineLimit={1}>
              {`天`}
            </Text>
            <Spacer minLength={4} />
            <SmallProgressOrRemaining
              progress={multiple.progress}
              remaining={multiple.remaining}
            />
          </HStack>
        </VStack>
      </VStack>
    </ZStack>
  )
}
