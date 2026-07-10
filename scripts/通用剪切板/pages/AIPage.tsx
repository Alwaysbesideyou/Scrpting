import { Form, NavigationStack } from "scripting"
import { APP_SCROLL_CONTENT_MARGINS } from "./pageConstants"

type PageElement = any

export function AIPage(props: {
  leadingToolbar: PageElement
  trailingToolbar: PageElement
  toast: any
  content: PageElement
}) {
  return (
    <NavigationStack>
      <Form
        formStyle="grouped"
        listRowSpacing={0}
        contentMargins={APP_SCROLL_CONTENT_MARGINS}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        toolbar={{ topBarLeading: props.leadingToolbar, topBarTrailing: props.trailingToolbar }}
        toast={props.toast}
      >
        {props.content}
      </Form>
    </NavigationStack>
  )
}
