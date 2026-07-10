import { HStack, Image, Spacer, Text, useColorScheme, VStack } from "scripting"
import type { ClipItem } from "../types"
import { formatDateTime, summarizeContent } from "../utils/common"
import { imagePreviewPath } from "../storage/image_store"

function iconName(kind: ClipItem["kind"]): string {
  if (kind === "image") return "photo"
  if (kind === "url") return "link"
  return "doc.text"
}

function kindLabel(kind: ClipItem["kind"]): string {
  if (kind === "image") return "图片"
  if (kind === "url") return "链接"
  return "文本"
}

function sourceLabel(source: ClipItem["source"]): string {
  return source === "remote" ? "远程" : "本地"
}

export function ClipboardCard(props: {
  title: string
  content: string
  footer: string
  iconSystemName: string
  contentLineLimit: number
  previewPath?: string
  iconForegroundStyle?: string
  showFavorite?: boolean
  showPinned?: boolean
  titleLineLimit?: number
}) {
  const colorScheme = useColorScheme()
  const cardFill = colorScheme === "dark" ? "secondarySystemBackground" : "systemBackground"
  return (
    <HStack
      spacing={12}
      frame={{ maxWidth: "infinity", alignment: "leading" as any }}
      padding={{ top: 14, bottom: 14, leading: 14, trailing: 14 }}
      background={{ style: cardFill, shape: { type: "rect", cornerRadius: 18 } }}
      shadow={{
        color: colorScheme === "dark" ? "rgba(0,0,0,0.20)" : "rgba(0,0,0,0.07)",
        radius: 10,
        y: 4,
      }}
    >
      <Image
        systemName={props.iconSystemName}
        frame={{ width: 28 }}
        foregroundStyle={(props.iconForegroundStyle ?? "systemBlue") as any}
      />
      <VStack
        frame={{ maxWidth: "infinity", alignment: "topLeading" as any }}
        spacing={5}
      >
        <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text
            font="headline"
            lineLimit={props.titleLineLimit ?? 1}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
          >
            {props.title}
          </Text>
          <Spacer />
          {props.showFavorite ? <Image systemName="star.fill" foregroundStyle="systemYellow" /> : null}
          {props.showPinned ? <Image systemName="pin.fill" foregroundStyle="systemOrange" /> : null}
        </HStack>
        {props.previewPath ? (
          <HStack frame={{ maxWidth: "infinity", alignment: "center" as any }}>
            <Image
              filePath={props.previewPath}
              resizable
              scaleToFit
              frame={{ width: 96, height: 64, alignment: "center" as any }}
              clipShape={{ type: "rect", cornerRadius: 8 } as any}
            />
          </HStack>
        ) : (
          <Text
            font="subheadline"
            foregroundStyle="secondaryLabel"
            lineLimit={props.contentLineLimit}
            frame={{ maxWidth: "infinity", alignment: "leading" as any }}
            multilineTextAlignment="leading"
          >
            {props.content}
          </Text>
        )}
        <Text font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {props.footer}
        </Text>
      </VStack>
    </HStack>
  )
}

export function ClipRow(props: {
  item: ClipItem
  contentLineLimit: number
}) {
  const item = props.item
  const lineLimit = Math.max(1, props.contentLineLimit)
  const previewPath = item.kind === "image" ? imagePreviewPath(item.imagePath) : undefined
  return (
    <ClipboardCard
      title={item.title}
      content={previewPath ? "" : item.kind === "image" ? "图片已保存" : summarizeContent(item.content, Math.max(140, lineLimit * 90))}
      footer={`${sourceLabel(item.source)}${formatDateTime(item.updatedAt) ? " · " + formatDateTime(item.updatedAt) : ""} · ${kindLabel(item.kind)}`}
      iconSystemName={iconName(item.kind)}
      iconForegroundStyle={item.pinned ? "systemOrange" : "systemBlue"}
      previewPath={previewPath}
      showFavorite={item.favorite}
      showPinned={item.pinned}
      contentLineLimit={lineLimit}
    />
  )
}
