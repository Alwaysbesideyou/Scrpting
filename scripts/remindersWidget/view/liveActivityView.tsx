import { Text, Link, HStack, VStack, ZStack, Spacer, TimerIntervalLabel, ProgressView, Color, Circle, ShapeStyle, Button, Image, Rectangle } from "scripting"
import { CompleteReminderIntentLiveActivity, PostponeReminderIntentLiveActivity } from "../app_intents"
import { config } from "../components/config"
import { str2TimeText } from "../components/model"

const heightView = 45
const heightViewMax = 70
const stylePrimary: ShapeStyle = "label"
const styleSecondary: ShapeStyle = "secondaryLabel"
const styleImage: ShapeStyle = 'systemPink'
const styleBackground: Color | { light: Color, dark: Color } = Device.systemVersion.match("26") ? "clear" : {
    light: "rgba(255,255,255,0.5)",
    dark: "rgba(0,0,0,0.5)",
}

export function LargeActivityView({
    title,
    identifier,
    dueDate,
    notes,
    isCompleted
}: {
    title: string
    identifier: string
    dueDate: string
    notes?: string
    isCompleted?: boolean
}) {
    const timeText = isCompleted ? '❤️已完成' : str2TimeText(dueDate)
    const height = notes ? heightViewMax : heightView

    return (
        <HStack
            padding={{
                horizontal: 15,
                vertical: 10
            }}
            frame={{ height: height }}
            alignment="center"
            activityBackgroundTint={styleBackground}
        >
            {/* <Link
                url={`x-apple-reminderkit://`}
            >
                <Image
                    font={24}
                    systemName={config.icon}
                    imageScale={"large"}
                    fontWeight={"bold"}
                    foregroundStyle={styleImage}
                />
            </Link> */}
            <Button
                buttonStyle="plain"
                intent={PostponeReminderIntentLiveActivity({
                    reminderId: identifier,
                })}
            >
                <ZStack frame={{ width: 40, height: 40 }}>
                    <Image
                        font={24}
                        systemName={config.icon}
                        imageScale={"large"}
                        fontWeight={"bold"}
                        foregroundStyle={styleImage}
                    />
                </ZStack>
            </Button>
            <VStack
                alignment="leading"
            >
                <Link
                    url={`x-apple-reminderkit://REMCDReminder/${identifier}`}
                    font={"title2"}
                    fontDesign={"rounded"}
                    fontWeight={"semibold"}
                    foregroundStyle={stylePrimary}
                >
                    {title}
                </Link>
                {notes ?
                    (<Text
                        font={"footnote"}
                        foregroundStyle={styleSecondary}
                        lineLimit={2}
                    >
                        {notes}
                    </Text>)
                    : null
                }
            </VStack>
            <Spacer />
            <Button
                foregroundStyle={stylePrimary}
                tint={styleImage}
                font={22}
                fontDesign={"rounded"}
                fontWeight={"semibold"}
                title={timeText}
                intent={CompleteReminderIntentLiveActivity({
                    reminderId: identifier,
                    isCompleted: isCompleted ?? false,
                })}
            />
        </HStack>
    )
}

export function MiniActivityView({
}: {
    }) {
    return <Image
        font={20}
        systemName={config.icon}
        imageScale={"small"}
        fontWeight={"bold"}
        foregroundStyle={styleImage}
    />

}

function getTimerDates(dueDate: string, startDate?: string, fallbackMinutes: number = config.widgetTimerInterval) {
    const now = new Date()
    const parsedStart = startDate ? new Date(startDate) : now
    const startMs = parsedStart.getTime()
    const start = Number.isFinite(startMs) ? parsedStart : now
    const end = new Date(dueDate)
    const endMs = end.getTime()
    const safeEnd = Number.isFinite(endMs) && endMs > start.getTime()
        ? end
        : new Date(start.getTime() + fallbackMinutes * 60_000)

    // 倒计时完整区间固定为“创建实时活动时间 -> 提醒事项时间”。
    // 如果提醒时间早于创建时间，则统一使用 config.widgetTimerInterval 作为兜底倒计时长度。
    return {
        start,
        end: safeEnd,
    }
}

function CountdownClockIcon({
    dueDate,
    startDate,
}: {
    dueDate: string
    startDate?: string
}) {
    const { start, end } = getTimerDates(dueDate, startDate)

    return (
        <ZStack frame={{ width: 24, height: 24 }}>
            <Circle
                stroke={{ shapeStyle: "quaternaryLabel", strokeStyle: { lineWidth: 2 } }}
                frame={{ width: 22, height: 22 }}
            />
            <ProgressView
                timerFrom={start}
                timerTo={end}
                countsDown={true}
                label={<Text>{""}</Text>}
                currentValueLabel={<Text>{""}</Text>}
                progressViewStyle="circular"
                tint={styleImage}
                labelsHidden={true}
                frame={{ width: 22, height: 22 }}
            />
            {/* 0 点方向的终止刻度，长度约为圆环直径的 1/3。 */}
            <Rectangle
                fill={styleImage}
                frame={{ width: 2, height: 8 }}
                offset={{ x: 0, y: -7 }}
            />
        </ZStack>
    )
}

export function MiniCountdownLeading({
    dueDate,
    startDate,
}: {
    dueDate: string
    startDate?: string
}) {
    return <CountdownClockIcon dueDate={dueDate} startDate={startDate} />
}

export function MiniActivityViewLeading({
    title,
}: {
    title: string
}) {
    return <Text font={14} lineLimit={2}>
        {title.length > 5 ? title.slice(0, 5) + "…" : title}
    </Text>
}

export function MiniActivityViewTrailing({
    dueDate,
    startDate,
}: {
    dueDate: string
    startDate?: string
}) {
    const now = new Date()
    const { start, end } = getTimerDates(dueDate, startDate)
    const d = new Date(dueDate)
    const timeText = str2TimeText(dueDate)

    const nowMs = now.getTime()
    const dMs = d.getTime()
    const isValid = Number.isFinite(dMs)

    const withinConfiguredInterval = isValid && dMs >= nowMs && (dMs - nowMs) <= config.widgetTimerInterval * 60 * 1000
    const isExpired = isValid && dMs < nowMs

    const showTimer = isExpired || withinConfiguredInterval

    return showTimer ? (
        <TimerIntervalLabel
            from={isExpired ? start : now}
            to={isExpired ? end : d}
            font={16}
            frame={{ width: 48 }}
            showsHours={false}
            monospacedDigit={true}
        />
    ) : (
        <Text foregroundStyle="white" font={16}>
            {timeText}
        </Text>
    )
}

