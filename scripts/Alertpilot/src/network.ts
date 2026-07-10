import { fetch } from "scripting"

export async function getHtmlTitle(url: string, timeout = 3): Promise<string> {
    const response = await fetch(url, {
        timeout,
        debugLabel: "Alertpilot getHtmlTitle"
    })

    const html = await response.text()
    const title = html.match(/<title.*?>(.+?)<\/title>/is)?.[1]

    return title?.replace(/\s+/g, " ").trim() || ""
}