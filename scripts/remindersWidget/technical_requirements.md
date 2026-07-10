# remindersWidget 技术文档：Alertpilot 联动链路与颜色判定方案

##1. 本文目标

本文用于沉淀当前 `Alertpilot -> 快捷指令 -> remindersWidget intent -> 通知 / 实时活动` 的真实链路，并明确后续“提醒事项颜色判定”应遵守的约束与推荐方案，供下一轮对话继续实现。

---

##2. 当前已确认的核心约束

###2.1 不破坏 Reminder 原始字段

用户明确要求：

- 不修改 Reminder 的标题、备注、标签、地点等现有字段来塞入额外元数据。
-颜色判定相关信息，后续只能走两条路：
1.直接复用 `Alertpilot` 已有判断逻辑。
2.由 `Alertpilot` 在创建完成后写入独立文件持久化，再由 `remindersWidget`读取。

###2.2 不在 reminderWidget复制一套 Alertpilot 判定函数

用户明确不希望 `remindersWidget`维护一套和 `Alertpilot` 类似的：

- 时间补全
- 地点补全
- 工作日 /休息日判断
- tag 推导

也就是说，widget 不应该自己重跑一遍 `Alertpilot` 的调度逻辑。

---

##3. 当前创建提醒到 intent触发的实际链路

当前链路与用户描述一致：

```text
Alertpilot 创建提醒
 ↓
快捷指令调用 remindersWidget/intent.tsx
 ↓
intent.tsx 接收 nameOfReminder, classReminders
 ↓
按标题 + 日历匹配 Reminder
 ↓
获取 Reminder.identifier
 ↓
发送通知
 ↓
若临近到期则启动实时活动
```

###3.1 remindersWidget intent 当前入参

文件：`remindersWidget/intent.tsx:8`

当前 `Intent.shortcutParameter.value`结构为：

```ts
{
 body: string
 subtitle: string
 nameOfReminder: string
 classReminders: string
}
```

###3.2 intent.tsx 当前行为

文件：`remindersWidget/intent.tsx:15`

当前逻辑如下：

1. 根据 `classReminders` 查找对应提醒日历。
2. 拉取该日历下未完成提醒。
3.通过 `nameOfReminder` 做标题匹配。
4. 命中后取得 `identifier`。
5. 使用该 `identifier`：
 -发送通知。
 -作为跳转到系统提醒详情页的目标。
 - 在满足条件时启动实时活动。

###3.3 通知与实时活动触发点

文件：`remindersWidget/intent.tsx:26`

- 如果 Reminder 存在 `dueDateComponents`，且到期时间在1 小时内，且 `config.isAutoLiveActivity === true`，则自动调用 `startLiveActivity(...)`。
- 无论是否启动实时活动，只要成功匹配到 Reminder，都会发送通知。

文件：`remindersWidget/intent.tsx:33`

通知中会附带：

- `userInfo.identifier`
- 点击通知直接跳转系统 Reminder详情页
- “修改提醒事项”操作
- “启动实时活动”操作

---

##4. Alertpilot 输出侧当前已确认链路

###4.1 Alertpilot先做智能时间决策，再落最终日期地点

文件：`Alertpilot/src/app.ts:142`
文件：`Alertpilot/src/app.ts:186`

当前顺序是：

1. `applySmartScheduleDecision(...)`
2. `resolveDateTime(...)`

因此：

-先决定任务类别对应的建议时间 / 时间槽。
- 再把该时间落到最终日期、最终地点、最终提醒时间上。

###4.2 smartScheduleDecision 不直接产出 tag 或 location

文件：`Alertpilot/src/smartScheduler.ts:228`

`applySmartScheduleDecision(...)` 当前主要负责：

- 写入 `input.rawTime`
- 在部分情况下写入 `input.month`
- 写入内部 `smartScheduleDecision = { category, slot, reason }`

它本身不直接决定最终 `tag` 或最终 `location`。

###4.3 location 是在 resolveDateTime 中由时间补全出来的

文件：`Alertpilot/src/dateTime.ts:42`

`timeCompletion(...)` 的行为已经确认：

- 当没有明确时间时，按当前时间段补全 `time + location + otherTime`
- 当已有时间时，按该时间补全 `location`

也就是说，地点补全本质上是时间驱动的结果。

###4.4 最终日期若为休息日，地点还会再被覆盖

文件：`Alertpilot/src/dateTime.ts:361`

`resolveDateTime(...)` 在构建最终日期后，还会检查该日期是不是休息日：

- 如果是休息日，则强制使用 `restLocation`
- 如果不是休息日，则保留之前按解析 / 补全得到的地点

这意味着最终地点不是单纯“按时刻映射一次”就结束，而是还受最终日期类型影响。

###4.5 tag只是最终 location 的字符串映射结果

文件：`Alertpilot/src/app.ts:411`

`buildTags(...)` 当前逻辑：

```ts
const locationTag = config["地点"][input.location || ""] || ""
const customTag = input.tag ? `,${input.tag}` : ""
return `${locationTag}${customTag} `
```

因此可以确认：

- `tag`不是独立的时间判定结果。
- `tag` 是最终 `location` 的字符串化输出。
- 而最终 `location` 又来自“时间补全 +休息日覆盖地点”这条链路。

---

##5. 为什么 reminderWidget 不应该自己复算颜色类型

###5.1仅靠 Reminder 字段无法无损还原 Alertpilot语义

当前 Reminder API 与现有项目代码里，widget侧稳定能直接拿到的主要字段是：

- `identifier`
- `title`
- `notes`
- `calendar`
- `dueDateComponents`
- `isCompleted`

参考：

- `remindersWidget/components/model.ts:7`
- `Reminder` API 文档

但 widget侧拿不到：

- Alertpilot 内部的 `smartScheduleDecision`
- Alertpilot解析出的最终 `location key`
- Alertpilot 输出中的内部推导依据

所以如果 widget仅根据 Reminder 自己去推导“工作 /休息颜色”，只能得到一个近似结果，无法保证和 Alertpilot 创建时的真实决策一致。

###5.2 在 widget 再写一套函数，维护成本高

如果在 `remindersWidget` 重写类似逻辑，就会引入以下问题：

- 与 `Alertpilot` 时间补全规则重复维护
- 与 `Off day`依赖重复耦合
- 一旦 `Alertpilot` 调整时间补全 / 地点补全 /休息日覆盖策略，widget侧也要同步改
- 两边很容易逐渐漂移

因此，该方向不推荐。

---

##6. 两个候选方向对比

###6.1方向 A：在 reminderWidget直接调用 Alertpilot 函数

#### 思路

在 widget 或 intent 中直接调用 `Alertpilot` 内部的某个判定函数，临时算出该 Reminder 属于工作还是休息。

#### 优点

- 理论上可复用同一套逻辑来源。

#### 问题

- `Alertpilot`现有链路不是一个“给定 Reminder 就返回 scheduleKind”的纯函数。
- 它依赖输入解析、用户画像、配置、Off day、时间补全、地点补全、最终日期等一整套上下文。
- widget侧拿到的是创建后的 Reminder，不一定具备创建当时的全部上下文。
- 实际上很容易演变成“为了复用而被迫重组 Alertpilot 内部结构”，工程量大、风险高。

####结论

- **不推荐作为近期实现方案。**

###6.2方向 B：由 Alertpilot 写入独立持久化文件

#### 思路

在 Alertpilot 成功创建 Reminder，并且 remindersWidget 的 `intent.tsx`通过 `nameOfReminder + classReminders` 找到 `identifier` 后，将颜色判定需要的最终结果写入本地独立存储文件。

#### 优点

- 不修改 Reminder 自身任何字段。
- 在“创建提醒的当下”记录最终判定结果，信息最准确。
- widget只负责读取结果，不重复计算。
- 后续维护成本最低。

#### 风险点

-需要设计 `identifier -> metadata` 的持久化结构。
-需要考虑 Reminder 被删除、完成、重建后的清理与失效策略。

####结论

- **这是当前最推荐、最好做、最好维护的方向。**

---

##7. 推荐的数据持久化范围

当前讨论后，推荐只持久化 widget 真正需要的“最终结论”，而不是把 Alertpilot 所有中间态都存下来。

###7.1 推荐最小结构

```ts
interface ReminderScheduleMeta {
 identifier: string
 scheduleKind: "work" | "rest"
 dueDate: string | null
 resolvedAt: string
}
```

###7.2 字段说明

- `identifier`
 - 系统 Reminder 的唯一标识。
 -作为 widget读取时的主键。

- `scheduleKind`
 - widget 最终真正关心的颜色分类结果。
 - 当前目标仅区分 `work` / `rest`。

- `dueDate`
 -记录创建时 Reminder 的到期时间，便于后续检查是否漂移。

- `resolvedAt`
 -记录判定写入时间，便于调试和后续清理。

###7.3 不建议直接持久化的内容

以下内容不是不能存，而是当前阶段不建议作为主方案核心字段：

- `smartCategory`
- `smartReason`
- `timeSlot`
- `tag`
- 中间态 `location`

原因：

- 它们大多是中间决策信息。
- widget 当前最终只需要颜色分组，不需要完整恢复整个决策过程。
-过早持久化过多字段，会增加后续迁移与清理复杂度。

---

##8. 当前技术判断

###8.1 已确认事实

1. `tag`不是独立判定源，而是最终 `location` 的字符串化结果。
2. `location` 的确定依赖时间补全，并且还受最终日期是否为休息日影响。
3.仅靠 Reminder 自身字段，widget 无法无损还原 Alertpilot 的完整时间 / 地点语义。
4. 用户不允许通过修改 Reminder 原始字段来塞入元数据。

###8.2 当前推荐方向

后续实现应优先采用：

- **Alertpilot / 快捷指令 / remindersWidget intent 在创建完成后写独立文件持久化最终 `scheduleKind`**
- **widget 渲染时按 `identifier`读取该结果并着色**

而不是：

- 在 widget侧自行重写时间补全 / 地点补全逻辑
-直接仅凭 Reminder 的 `dueDate` 做近似推断

---

##9. 后续新对话建议从这里继续

下一轮实现建议按以下问题继续推进：

1. 最终由谁写入 `identifier -> scheduleKind`：
 - `Alertpilot`直接写
 -还是 `remindersWidget/intent.tsx` 在匹配到 identifier 后写

2. 持久化文件的结构与读写位置：
 - 是否继续沿用 `Storage`
 -还是单独封装 metadata store

3. 清理策略：
 - Reminder 被删除时如何清理
 - Reminder 完成后是否保留一段时间
 - Reminder 到期后 metadata 是否继续保留

4. widget颜色映射：
 - `work -> 某颜色`
 - `rest -> 某颜色`

---

##10. 已修改文件历史与当前状态

本节专门记录本轮对话前后已经动过的文件，避免后续新对话误把“暂时实现”当成“最终正确方案”。

###10.1 Alertpilot 已修改项

#### `Alertpilot/src/types.ts`

当前状态：

- 已扩展 `AlertpilotOutput`，保留了：
 - `smartCategory?: string`
 - `smartReason?: string`
 - `timeSlot?: TimeSlot`
- 当前 `TimeSlot` 对外定义为：

```ts
export type TimeSlot = "work" | "restTime" | "restDay" | "specified" | "any"
```

说明：

-这是之前为了给下游同步时间类型做的输出扩展。
-这些字段当前仍然存在于 `Alertpilot` 输出类型中。
-但基于本轮最新结论，**后续不应默认认为 widget 一定要继续消费这些字段做颜色判断**。

#### `Alertpilot/src/app.ts`

当前状态：

- 已有 `normalizeOutputTimeSlot(...)`，用于把内部历史值如 `morning`归一到对外输出类型。
- 已把 `smartCategory`、`smartReason`、`timeSlot` 写入 `AlertpilotOutput`。
- `buildTags(...)` 保持为根据最终 `input.location` 输出字符串 tag。

说明：

-这些改动是之前“让 Alertpilot 把时间类型显式传给下游”的一部分。
- 当前仍保留在代码中。
-但根据本轮分析，**它们不应被直接视为 reminderWidget 最终着色方案的既定正确答案**。

#### `Alertpilot/src/logger.ts`

当前状态：

-之前曾补充输出摘要对 `smartCategory` / `timeSlot` 的记录。

说明：

-这是日志层改动，主要用于调试。
- 它不直接决定后续 reminderWidget方案。

###10.2 remindersWidget 已修改项

#### `remindersWidget/intent.tsx`

当前状态：

- 当前只接收：

```ts
{
 body: string
 subtitle: string
 nameOfReminder: string
 classReminders: string
}
```

- 不再写入本地 `taskMeta` 或 `timeSlot` 映射。
- 当前职责仍是：
1. 根据 `nameOfReminder + classReminders` 匹配 Reminder。
2.取到 `identifier`。
3.发送通知。
4. 在临近到期时启动实时活动。

说明：

-这里之前短暂接入过 `smartCategory` / `smartReason` / `timeSlot` 入参和本地写入逻辑。
-这些逻辑**已经被移除**。
- 后续新对话不应假设 `intent.tsx`现在还在落本地 `taskMeta`。

#### `remindersWidget/widget.tsx`

当前状态：

- 已移除 `cleanupReminderTaskMeta()` 调用。

说明：

-这是因为此前的 `taskMeta` 映射清理逻辑已经一起撤掉。
- 后续若重新引入独立持久化文件，需要重新设计清理策略，不应默认复用旧的 `taskMeta cleanup` 思路。

#### `remindersWidget/components/store.ts`

当前状态：

-目前文件里保留的是：
 - live activity相关存储
 - 当前提醒数量存储
 - 翻页索引存储
 - `isWorkTimeDate(...)`
 - `getReminderScheduleColor(...)`
- 当前颜色判断实现是：
 - 工作日08:00–18:00 返回 `systemBlue`
 -其他时间返回 `systemGreen`

说明：

- **这段按 `dueDate`直接近似判断工作/休息颜色的实现，是我之前为了快速收敛而临时写入的。**
- 基于本轮最新结论，**这不是推荐继续沿用的最终方案**。
- 原因：
 - 它没有复用 Alertpilot 的完整“时间补全 + 地点补全 +休息日地点覆盖”语义。
 - 它只是 widget侧的近似推断。
- 因此后续新对话看到这里时，应把它视为：
 - **当前代码现状**
 - **但不是最终推荐方案**
 - **后续应被“独立持久化最终 scheduleKind”方案替换**

#### `remindersWidget/view/widgetView.tsx`

当前状态：

- 当前视图层通过：

```ts
const scheduleColor = getReminderScheduleColor(r.dueDateComponents?.date)
```

来决定标题和完成按钮颜色。

说明：

- **这同样属于“按 Reminder 自身 `dueDate`近似推断颜色”的临时实现。**
- 它和上面的 `store.ts` 一样，属于：
 -代码当前确实存在
 -但不应在新对话里被当成最终正确方向继续放大

#### `remindersWidget/technical_requirements.md`

当前状态：

- 本文档已被重写为本轮对话结论。
-旧的“`timeSlot` / `taskMeta`作为主方案”的文档内容已经被替换。

说明：

-但如果后续还有代码残留与本文档结论不一致，**应以本文档记录的“当前技术判断”作为后续修正依据**，而不是反过来认为代码现状一定正确。

###10.3 已放弃 / 不应继续默认成立的旧方向

以下方向在之前对话中曾经实现或半实现过，但**当前不应再被默认视为正确方案**：

1. `Alertpilot -> shortcut -> reminderWidget intent` 同步 `smartCategory + timeSlot`，再由 widget直接按 `timeSlot` 着色。
2. 在 `remindersWidget` 内维护 `identifier -> taskMeta` 映射，并长期依赖该映射做颜色显示。
3. 在 widget侧依据 Reminder 自身 `dueDate`近似推断工作 /休息颜色，并将其当成最终方案。

###10.4 当前应作为后续实现基线的判断

后续新对话继续实现时，应以以下判断为基线：

1. 不修改 Reminder 原始字段。
2. 不在 widget侧复制 Alertpilot 的时间补全 / 地点补全逻辑。
3. 若要做颜色分类，优先考虑：
 - 在创建提醒完成后
 -通过已匹配到的 `identifier`
 - 将最终 `scheduleKind` 写入独立持久化文件
 - widget仅按 `identifier`读取结果显示

###10.5 本轮修改演进时间线

以下时间线用于说明“为什么代码里会出现一些现在已不推荐继续沿用的实现”。

1. 初始理解阶段
 - 最开始把需求理解成“根据提醒是否到了某个高亮窗口来变色”。
 -这个理解后来被用户纠正。

2. 第一版方向：显式同步 `timeSlot`
 -之后按“把任务分配到五种时间类型，再映射成颜色”的方向推进。
 - 因此修改了 `Alertpilot` 输出类型和部分输出逻辑，让下游可直接拿 `timeSlot` / `smartCategory`。
 -这也是 `Alertpilot/src/types.ts` 与 `Alertpilot/src/app.ts` 当前仍保留这些字段的原因。

3. 第二版方向：widget侧建立 `identifier -> taskMeta`
 - 为了把 `Alertpilot` 输出绑定到系统 Reminder，曾短暂推进过在 `remindersWidget/intent.tsx` 匹配到 `identifier` 后，写入本地 `taskMeta` 映射。
 - 同时还考虑过在 `widget.tsx` 中加入 `cleanupReminderTaskMeta()` 清理逻辑。
 -这一阶段的目标是让 widget直接消费 `timeSlot/taskMeta`。

4. 用户继续收窄需求
 - 用户指出文档里的五种时间类型本质上要归并成“工作时间 /休息时间”两类颜色。
 - 用户进一步指出，`tag` 来源于地点，而地点又受时间补全影响，因此不能只停留在 `timeSlot` 表层概念。

5. 第三版方向：按 Reminder 自身 `dueDate`近似判断颜色
 - 在进一步核对 `Alertpilot`逻辑前，我曾做过一版快速收敛实现：
 - 删除 `taskMeta/timeSlot` 存储逻辑。
 - 在 `remindersWidget/components/store.ts` 中加入 `isWorkTimeDate(...)` 与 `getReminderScheduleColor(...)`。
 - 在 `remindersWidget/view/widgetView.tsx` 中直接按 `r.dueDateComponents?.date` 着色。
 -这就是当前代码里仍能看到的 `systemBlue/systemGreen` 判断来源。

6. 第三版为何不再作为推荐方案
 - 后续深入核对 `Alertpilot` 后确认：
 - `tag`不是独立判定源，而是最终 `location` 的字符串输出。
 - `location`依赖时间补全，并且最终还会被“是否休息日”覆盖。
 - 因此，仅凭 Reminder 自身 `dueDate` 去做 widget侧近似判断，并不能无损复现 `Alertpilot`语义。
 -也正因为这个原因，当前虽然代码里保留了 `dueDate`近似实现，但文档已明确把它降级为“临时现状，不建议继续沿用”。

7. 当前收敛结论
 - 不再推荐继续扩展 `timeSlot/taskMeta` 路线。
 - 不再推荐把 `dueDate`近似判断当成最终方案。
 - 当前最推荐的后续方向是：
 - 在创建提醒链路完成后
 -通过已匹配到的 `identifier`
 - 独立持久化最终 `scheduleKind`
 -由 widget只读取最终结果着色

##11.关键文件索引

### Alertpilot

- `Alertpilot/src/app.ts:142`
- `Alertpilot/src/app.ts:186`
- `Alertpilot/src/app.ts:411`
- `Alertpilot/src/dateTime.ts:42`
- `Alertpilot/src/dateTime.ts:361`
- `Alertpilot/src/smartScheduler.ts:228`
- `Alertpilot/src/types.ts:3`

### remindersWidget

- `remindersWidget/intent.tsx:8`
- `remindersWidget/intent.tsx:15`
- `remindersWidget/intent.tsx:26`
- `remindersWidget/intent.tsx:33`
- `remindersWidget/components/model.ts:7`
- `remindersWidget/components/store.ts:49`
- `remindersWidget/components/store.ts:57`
- `remindersWidget/view/widgetView.tsx:150`
