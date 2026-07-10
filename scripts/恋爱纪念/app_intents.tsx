import {
  AppIntentManager,
  AppIntentProtocol,
  Widget,
} from "scripting"
import {
  recordPhotoSwitch,
  readSettings,
  saveSettings,
  switchToNextPhoto,
} from "./widget-common"

export const ShowNextPhotoIntent = AppIntentManager.register({
  name: "ShowNextLoveAnniversaryPhoto",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    const settings = readSettings()
    const nextSettings = switchToNextPhoto(settings)
    if (nextSettings === settings) return

    saveSettings(nextSettings)
    recordPhotoSwitch()
    Widget.reloadAll()
  },
})
