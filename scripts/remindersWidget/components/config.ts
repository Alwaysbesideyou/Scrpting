export const config = {
    version: "1.0.1", // 小组件版本号
    name: "Reminders Widget", // 小组件名称
    description: "一个用于显示提醒事项的小组件",
    log: '250828: 修复提醒事项获取逻辑',
    icon: 'rosette', // 小组件图标
    debug: false, // 是否启用调试模式
    isAutoLiveActivity: true, // 通知调用是否自动启动实时活动
    maxLiveActivityCount: 3, // 最大实时活动数量，超过后会替换最旧的活动
    liveActivityDismissTimeInterval: 10, // 实时活动自动消失时间间隔（秒）
    widgetTimerInterval: 60, // 圆环倒计时和数字倒计时共用的兜底/显示时间间隔（分钟）
}
