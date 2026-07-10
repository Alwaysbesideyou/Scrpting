import { NavigationStack, VStack } from "scripting"
import type { CaisSettings, ClipboardClearRange } from "../types"
import { SettingsView } from "./SettingsView"

type PageElement = any

export function SettingsPage(props: {
  value: CaisSettings
  onChanged: (value: CaisSettings) => void
  onClearFavorites: () => void
  onClearClipboard: (range: ClipboardClearRange) => void
  onSyncNow: () => void
  onClearRemote: () => void
  onRemoteStats: () => void
  addActionToken: number
  leadingToolbar: PageElement
  trailingToolbar: PageElement
  toast: any
}) {
  return (
    <NavigationStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" as any }}
        toast={props.toast}
      >
        <SettingsView
          value={props.value}
          onChanged={props.onChanged}
          onClearFavorites={props.onClearFavorites}
          onClearClipboard={props.onClearClipboard}
          onSyncNow={props.onSyncNow}
          onClearRemote={props.onClearRemote}
          onRemoteStats={props.onRemoteStats}
          addActionToken={props.addActionToken}
          leadingToolbar={props.leadingToolbar}
          trailingToolbar={props.trailingToolbar}
        />
      </VStack>
    </NavigationStack>
  )
}
