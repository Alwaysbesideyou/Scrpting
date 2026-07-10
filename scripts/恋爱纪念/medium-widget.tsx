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
  nextNHolidays,
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
import { getTodayLoveIdiom } from "./love-idioms"

const WidgetWidth = 340
const WidgetHeight = 140
const WidgetPhotoWidth = 140
const WidgetPhotoHeight = WidgetPhotoWidth

function MediumMetricRow(props: {
  icon: string
  left: string
  right: number
}) {
  return (
    <WidgetMetricRow
      icon={props.icon}
      left={props.left}
      right={props.right}
      spacing={5}
      iconFont={18}
      iconSize={12}
      leftFont={12}
      prefixFont={12}
      numberFont={20}
    />
  )
}

function MediumProgressBar(props: { progress: number; remaining: number; width?: number }) {
  const width = props.width ?? 92
  const progress = clamp(props.progress, 0, 1)
  const fillWidth = Math.max(6, Math.round(width * progress))
  const fillColor = props.remaining <= 3 ? "rgba(255, 59, 48, 1)" : "rgba(255, 74, 122, 1)"

  return (
    <ZStack alignment="leading" frame={{ width, height: 10 }}>
      <VStack
        frame={{ width, height: 10 }}
        background="rgba(255, 74, 122, 0.22)"
        clipShape={{ type: "rect", cornerRadius: 5 }}
      />
      <VStack
        frame={{ width: fillWidth, height: 10 }}
        background={fillColor}
        clipShape={{ type: "rect", cornerRadius: 5 }}
      />
    </ZStack>
  )
}

function MediumProgressOrRemaining(props: {
  progress: number
  remaining: number
}) {
  if (props.remaining <= 30) {
    return <RemainingDaysLabel remaining={props.remaining} prefixFont={12} numberFont={20} />
  }

  return <MediumProgressBar progress={props.progress} remaining={props.remaining} width={56} />
}

export function MediumWidget() {
  const settings = readSettings()
  const today = startOfDay(new Date())
  const daysTogether = Math.max(0, dayDiff(parseDate(settings.startDate), today) + 1)
  const multiple = nextSpecialNumberInfo(settings, daysTogether)
  const holidays = nextNHolidays(settings, today, 2)
  const showTwoRows = holidays.length >= 2
  const holiday1 = holidays[0] ?? nextHoliday(settings, today)
  const holiday2 = holidays[1] ?? null
  const holiday1Remaining = holidayCountdownDays(today, holiday1)
  const holiday2Remaining = holiday2 ? holidayCountdownDays(today, holiday2) : 0
  const photoStackItems = selectedPhotoStack(settings)
  const selected = photoStackItems[0] ?? null
  const photo = compressedWidgetPhotoPath(selected?.path ?? null)
  const photoStack = photoStackItems.map((item: { path: string }) => compressedWidgetPhotoPath(item.path))

  const { idiom: todayIdiom } = getTodayLoveIdiom()

  return (
    <ZStack>
      {photo ? (
        <Image
          filePath={photo}
          resizable
          scaleToFill
          frame={{ maxWidth: 400, maxHeight: 180 }}
          blur={8}
          clipped
        />
      ) : (
        <PlaceholderPhoto />
      )}
      <VStack frame={{ maxWidth: 400, maxHeight: 180 }} background="regularMaterial" opacity={0.96} />

      <HStack alignment="center" spacing={14} frame={{ maxWidth: WidgetWidth, maxHeight: WidgetHeight }}>
        <Button buttonStyle="plain" intent={ShowNextPhotoIntent(undefined)}>
          <StackedPhotoView paths={photoStack} width={WidgetPhotoWidth} height={WidgetPhotoHeight} radius={15} />
        </Button>
        <VStack alignment="trailing" spacing={6} frame={{ maxWidth: 120, height: WidgetPhotoHeight }}>
          <HStack >
            <Text font={18} foregroundStyle="secondaryLabel" fontDesign="rounded" fontWeight="semibold" lineLimit={1}>
              {todayIdiom}
            </Text>
            <Spacer minLength={0} />
            <Text font={20} shadow={{ color: "rgba(0,0,0,0.30)", radius: 4 }}>{settings.emoji || "💗"}</Text>
          </HStack>
          <Spacer />
          <MediumMetricRow
            icon="calendar"
            left={holiday1.name}
            right={holiday1Remaining}
          />
          {showTwoRows && holiday2 ? (
            <MediumMetricRow
              icon="calendar"
              left={holiday2.name}
              right={holiday2Remaining}
            />
          ) : null}
          <HStack spacing={5} frame={{ maxWidth: "infinity" }}>
            <Image
              systemName="heart.fill"
              font={18}
              imageScale="small"
              foregroundStyle="rgba(255,255,255,0.88)"
              frame={{ width: 12, height: 12 }}
            />
            <Text {...WidgetButtonFont} font={12} lineLimit={1}>
              {`相恋`}
            </Text>
            <Text {...WidgetButtonFont} font={20} foregroundStyle="label" lineLimit={1}>
              {`${daysTogether}`}
            </Text>
            <Text {...WidgetButtonFont} font={12} lineLimit={1}>
              {`天`}
            </Text>
            <Spacer minLength={4} />
            <MediumProgressOrRemaining
              progress={multiple.progress}
              remaining={multiple.remaining}
            />
          </HStack>
        </VStack>
      </HStack>
    </ZStack>
  )
}
