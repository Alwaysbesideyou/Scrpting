import {
  LiveActivity,
  LiveActivityUI,
  LiveActivityUIBuilder,
  LiveActivityUIExpandedCenter,
} from "scripting"

import {
  LargeActivityView,
  MiniCountdownLeading,
  MiniActivityViewTrailing,
} from "./view/liveActivityView"

export const activityName = "ReminderActivity" // 需全局一致（文档 §5）

export type ReminderState = {
  title: string
  identifier: string
  dueDate: string // 必须 JSON 可序列化（文档 §9.1）
  startDate?: string // 倒计时起点；用于保持灵动岛每次展开/收起时进度一致
  notes?: string
  isCompleted?: boolean
}

const builder: LiveActivityUIBuilder<ReminderState> = (state) => {
  const { title, identifier, dueDate, startDate, notes, isCompleted } = state

  return (
    <LiveActivityUI
      content={<LargeActivityView title={title} identifier={identifier} dueDate={dueDate} notes={notes} isCompleted={isCompleted} />}
      compactLeading={<MiniCountdownLeading dueDate={dueDate} startDate={startDate} />}
      compactTrailing={<MiniActivityViewTrailing dueDate={dueDate} startDate={startDate} />}
      minimal={<MiniCountdownLeading dueDate={dueDate} startDate={startDate} />}
    // minimal={<MiniActivityViewTrailing dueDate={dueDate} startDate={startDate} />}
    >
      <LiveActivityUIExpandedCenter>
        {<LargeActivityView title={title} identifier={identifier} dueDate={dueDate} notes={notes} isCompleted={isCompleted} />}
      </LiveActivityUIExpandedCenter>
    </LiveActivityUI>
  )
}

export const ReminderLiveActivity = LiveActivity.register<ReminderState>(
  activityName,
  builder
)
