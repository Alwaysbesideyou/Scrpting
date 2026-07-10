import { Form, NavigationStack, VStack } from "scripting"
import { APP_SCROLL_CONTENT_MARGINS } from "./pageConstants"

type PageElement = any

export function NetworkPage(props: {
  leadingToolbar: PageElement
  trailingToolbar: PageElement
  toast: any
  pipControlPanel: PageElement
  searchPanel: PageElement
  filterPanel: PageElement
  content: PageElement
  onRefresh: () => Promise<void>
}) {
  return (
    <NavigationStack>
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "top" as any }}
        toolbar={{ topBarLeading: props.leadingToolbar, topBarTrailing: props.trailingToolbar }}
        toast={props.toast}
      >
        {props.pipControlPanel}
        {props.searchPanel}
        {props.filterPanel}
        <Form
          formStyle="grouped"
          listRowSpacing={0}
          contentMargins={APP_SCROLL_CONTENT_MARGINS}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          refreshable={props.onRefresh}
        >
          {props.content}
        </Form>
      </VStack>
    </NavigationStack>
  )
}
