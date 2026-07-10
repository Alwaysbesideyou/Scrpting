import { Widget } from "scripting"
import { MediumWidget } from "./medium-widget"
import { SmallWidget } from "./small-widget"
import { switchPhotoOnWidgetRefresh } from "./widget-common"

switchPhotoOnWidgetRefresh()

const content = Widget.family === "systemMedium" ? <MediumWidget /> : <SmallWidget />

Widget.present(content, {
  reloadPolicy: {
    policy: "after",
    date: new Date(Date.now() + 1000 * 60 * 30),
  },
})
