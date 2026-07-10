import { Intent, Script } from "scripting"
import { notification, startLiveActivity } from "./components/model"
import { config } from "./components/config"


(async () => {
    const fileName = 'App Intents'

    // if (Notification.current) {
    //     // notification(
    //     //     Notification.current?.request.content.title ?? '',
    //     //     Notification.current?.request.content.userInfo.identifier,
    //     //     true
    //     // )
    //     try {
    //         const isOK = Script.createRunSingleURLScheme(Script.name, { url: `x-apple-reminderkit://REMCDReminder/${Notification.current?.request.content.userInfo.identifier}` })
    //         notification(`打开URL:${isOK}`, String(Notification.current?.request.content.userInfo.identifier), true)
    //     } catch (error) {
    //         notification("无法打开URL:", String(error), true)
    //     }
    //     return
    // }

    if (Object.keys(Script.queryParameters).length > 0) { // Action 按钮回调
        if (Script.queryParameters.startLiveActivity) {
            const { title, identifier, dueDate, notes } = Script.queryParameters
            await startLiveActivity({ title, identifier, dueDate, notes })
        } else {
            const { url } = Script.queryParameters
            Safari.openURL(url)
            notification(fileName, `回调打开URL: ${url}`, config.debug, true)
            Script.exit(Intent.text('完成'))
            return
        }
    }
    // Widget.preview({ family: "systemSmall" })
})()
