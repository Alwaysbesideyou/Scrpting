import type { AlertpilotConfig } from "./types"

export function getDefaultReminderList(config: AlertpilotConfig): string {
    return config["默认配置"]?.["提醒列表"] || config["提醒列表"]?.["提醒"] || Object.values(config["提醒列表"] || {})[0] || "Reminders"
}

export function getDefaultAdditionalTime(config: AlertpilotConfig): string {
    return config["默认配置"]?.["附加时间"] || config["附加时间"]?.["今天"] || Object.values(config["附加时间"] || {})[0] || "0"
}

export function getDefaultTime(config: AlertpilotConfig): string {
    return config["默认配置"]?.["时间"] || config["时间"]?.["上午"] || Object.values(config["时间"] || {})[0] || "0900"
}

export function getDefaultWorkdayTime(config: AlertpilotConfig): string {
    return config["默认配置"]?.["工作日时间"] || getDefaultTime(config)
}

export function getDefaultRestDayTime(config: AlertpilotConfig): string {
    return config["默认配置"]?.["休息日时间"] || getDefaultTime(config)
}

export function getDefaultLocation(config: AlertpilotConfig): string {
    return config["默认配置"]?.["地点"] || config["地点"]?.["公司"] || Object.values(config["地点"] || {})[0] || "💼Work"
}

export const CHANGELOG = `3.0.0 更新内容
- 迁移脚本版本号到 script.json，版本信息与脚本元数据保持一致。
- 内置 AI 提醒解析：支持从快捷指令、分享文本、网页和 URL 中提取提醒事项。
- 支持多事项拆分与批量输出，Intent 输出统一包装为 items 数组，兼容快捷指令读取。
- 优化提醒时间、地点、列表、标签、父提醒、备注和链接的识别与组装。
- 新增/完善配置编辑界面、AI 提示词配置、运行日志与版本更新日志提醒。`
export const PROJECT_KEY = "Alertpilot"

export const DEBUG = false
export const SAVE_LOGS = true

export const DEFAULT_CONFIG: AlertpilotConfig = {
    "提醒列表": {
        "订阅": "Subscription",
        "提醒": "Reminders",
        "购物": "Shopping",
        "电影": "Movies"
    },
    "默认配置": {
        "提醒列表": "Reminders",
        "附加时间": "0",
        "时间": "0900",
        "工作日时间": "0900",
        "休息日时间": "1000",
        "地点": "💼Work"
    },
    "calendarAddNum": 4,
    "时间补全": {
        "2200": ["早晨", "家", "明天"],
        "0900": ["中午", "", ""],
        "1700": ["1900", "家", ""],
        "0000": ["早上", "家", ""],
        "1200": ["1700", "", ""],
        "0830": ["上午", "公司", ""],
        "1900": ["2200", "家", ""],
        "0701": ["上班", "公司", ""]
    },
    "timeOut": 5,
    "saveLogs": true,
    "logLevel": "trace",
    "useBuiltInAi": true,
    "useCustomAiProviderModel": false,
    "aiProvider": "openai",
    "aiModelId": "gpt-4o-mini",
    "附加时间": {
        "今天": "0",
        "两星期": "14",
        "一小时后": "0.06",
        "明天": "1",
        "后天": "2",
        "一小时前": "-0.06",
        "等会": "0.03",
        "下星期": "7",
        "等下": "0.03",
        "昨天": "-1",
        "三小时后": "0.18"
    },
    "自动补全": [
        ["上班", "下午", "下班", "晚上", "夜间"],
        ["公司", "公司", "家", "家", "家"]
    ],
    "时间": {
        "中午": "1200",
        "早上": "0800",
        "下午": "1600",
        "早晨": "0700",
        "上午": "0900",
        "夜间": "2200",
        "中班": "1400",
        "上班": "0830",
        "晚上": "2000",
        "下班": "1730"
    },
    "userPreferences": {
        "enabled": true,
        "autoLearn": true,
        "workStart": "0830",
        "workEnd": "1730",
        "commuteMinutes": 90,
        "generalTaskDurationMinutes": 30,
        "importantTaskDurationMinutes": 60,
        "conflictDeferMinutes": 30,
        "conflictBufferMinutes": 10,
        "floatingTaskDelayMinutes": 10,
        "maxConcurrentTasks": 2,
        "dailyTaskStart": "2000",
        "dailyTaskEnd": "2200",
        "quietAfter": "2200",
        "importantTaskTime": "1000",
        "weekendDefaultTime": "1000",
        "studyPreferredTime": "2100",
        "exercisePreferredTime": "1930",
        "shoppingMode": "any",
        "shoppingTime": "2000",
        "houseworkMode": "any",
        "houseworkTime": "2000",
        "studyMode": "specified",
        "exerciseMode": "specified",
        "generalMode": "any",
        "generalPreferredTime": "2000",
        "defaultSmartCategory": "01",
        "simpleTaskPreferences": [],
        "simpleTaskNames": {},
        "simpleTaskIcons": {},
        "hiddenSimpleTaskIds": [],
        "customSimpleTasks": [],
        "learning": {},
        "learningByList": {},
        "memory": {
            "global": "",
            "aiDaily": [],
            "aiMarkdown": ""
        },
        "holidayCache": {
            "date": "",
            "months": 12,
            "text": ""
        }
    },
    "地点": {
        "寝室": "🏫Apartment",
        "家": "🏠Home",
        "实验室": "🧪Laboratory",
        "公司": "💼Work"
    },
    "restLocation": "🏠Home",
    "aiPrompt": `# Role and Goal
你是一个运行在 iOS Shortcuts 中以AI驱动的提醒事项输入助手，名叫Alertpilot。你的目标是理解用户输入的简单或复杂事项，将其按照分类拆分、提取、归类、总结核心内容。你是管理用户提醒事项的专家，你必须以智能地完成这项任务！

# Rules that must be followed
仔细分析用户输入的内容，特别是用户着重强调的内容和请求。你需要先判断输入中是否包含多个提醒事项，再输出 items 数组。拆分必须谨慎：
- 若输入中存在 "&"，它是强拆分符，必须按 "&" 分隔为多个独立提醒事项，顺序保持一致；
- 若没有 "&"，默认只输出 1 个提醒事项；“和/与/并/以及/还有”等连接词通常只是同一事项内的多个对象或补充信息，不要拆分；只有在语义上确实存在多个可独立执行、各自可形成提醒的事项（例如不同动作且不同对象，或不同时间分别对应不同事项）时，才拆分为多个 items；
- 不要因为“和/与/并/以及/还有”等连接词拆分同一个提醒事项的多个对象，例如“买牛奶和面包”必须是 1 个 item；
- 每个分组后的事件均需要按照下列规则独立处理，切勿合并处理！

- 不同的提醒事项按照顺序放置在 JSON 对象的 items 数组中；无明确拆分时 items 只包含 1 项；
- 每个 item 必须包含 rawText 字段：rawText 是该事项对应的原始片段，应保留该事项的时间、地点、优先级、@父提醒、#标签# 等可供脚本继续解析的信息；
- 所有的提醒类别：\${listText}；默认类别：Reminders，如果事件无法分类，则保持为默认；
- 在分组的事件中，第一行事件、时间、地点等内容，第二行及以后只为网站链接和备注内容，你需要理清；
- 若事项字数超过20个字，请将事件内容极致精简；
- 请将句子中出现的口语化或缩略的时间表达转换为完整、书面化的时间表达（标准化），仅处理与时间相关的内容，不对其他部分做改动。请保持句子原意，仅将涉及“时间”的口语词进行扩写。如果没有时间表达，则该项留空。（只包括：\${timeText}）以下是部分转换示例，以此类推：
     - 今晚 → 今天晚上
     - 明早 → 明天早上
     - 后晚 → 后天晚上
     - 昨中午 → 昨天中午
     - 今午 → 今天中午
     - 明晚 → 明天晚上
     - 今晨 → 今天早上
     - 昨晚 → 昨天晚上
     - 后早 → 后天早上
     - 前晚 → 前天晚上
     - 大前天早 → 大前天早上
     - 大后天晚 → 大后天晚上
- 若输入中包含(下个? (分钟|小时|天|周|星期|月|年)后?)，没有具体的数指向，默认为1，例如：
     - 下个(周|星期|月)→下一个(周|星期|月)
     - 下下…(周|星期|月)→下(原本下的数量，例如一、二…)个*(周|星期|月)
  你需要补全“时间”（下（数量）个（分钟|小时|天|周|星期|月|年)）；
- 请保持句子原意，仅将涉及“时间”的口语词进行扩写；
- 忽略提醒事项中类似时间的数字，如四位数字：1200（中午十二点）、2235（深夜十点三十五）等；
- 如果输入为空，则输出文本为空，类别为默认；
- 如果提醒中含有关键词“看”或“买”，同时输入的提醒包含电影名称或物品名称，则将提醒分类为Movies或Shopping，否则将提醒分类为默认；
- 如果传入了网页内容，请整理网页内容为备注。

# Output Format (Mandatory JSON)
你的最终决策 **必须** 严格遵循以下 JSON 格式输出，不要添加任何额外的解释性文字：

\`\`\`json
{
    "items": [
        {
            "rawText": "该事项对应的原始片段，保留时间、地点、优先级、@父提醒、#标签#等脚本可继续解析的信息",
            "text": "[事项 | 总结 | 翻译]",
            "isSummary": true,
            "classReminders": "提醒的分类",
            "timeWord": "该事件的口语化时间",
            "note": "备注",
            "url": "https://example.com"
        }
    ]
}
\`\`\`

# SYSTEM INFORMATION

回复语言: 中文
当前时间: \${currentTime}
---
近一年节假日: \${holidays}
---
网页内容: \${webContent}`,
}