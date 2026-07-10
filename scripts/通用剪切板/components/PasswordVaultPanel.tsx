import { Text, VStack } from "scripting"

export function PasswordVaultPanel() {
  return (
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}
      spacing={16}
    >
      <Text font="title" foregroundStyle="secondaryLabel">
        密码库
      </Text>
      <Text font="subheadline" foregroundStyle="secondaryLabel">
        密码库功能正在开发中...
      </Text>
    </VStack>
  )
}
