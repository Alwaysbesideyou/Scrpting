import { Notification } from "scripting"
import { DEBUG } from "./config"
import type { LogLevel, LogSink } from "./types"
import {
    createStructuredLog,
    formatConsoleLog,
    normalizeLogLevel,
    shouldLogLevel,
    type LogStage,
    type StructuredLogEntry
} from "./logger"

type LogRaw = unknown | (() => unknown)

export class Logger {
    private step = 1
    private level: LogLevel
    private onLog?: LogSink

    constructor(
        private logs: unknown[],
        onLogOrLevel?: LogSink | LogLevel | string,
        levelOrOnLog?: LogLevel | string | LogSink
    ) {
        if (typeof onLogOrLevel === "function") {
            this.onLog = onLogOrLevel
            this.level = normalizeLogLevel(typeof levelOrOnLog === "string" ? levelOrOnLog : undefined)
        } else {
            this.level = normalizeLogLevel(onLogOrLevel)
            this.onLog = typeof levelOrOnLog === "function" ? levelOrOnLog : undefined
        }
    }

    log(message: unknown, save = true) {
        const text = typeof message === "string" ? message : extractMessage(message) || "内部调试"
        this.write("debug", "TRANSFORM", text, message, save)
    }

    error(stage: LogStage | string, message: string, raw?: LogRaw, save = true) {
        this.write("error", stage, message, raw, save)
    }

    warn(stage: LogStage | string, message: string, raw?: LogRaw, save = true) {
        this.write("warn", stage, message, raw, save)
    }

    info(stage: LogStage | string, message: string, raw?: LogRaw, save = true) {
        this.write("info", stage, message, raw, save)
    }

    debug(stage: LogStage | string, message: string, raw?: LogRaw, save = true) {
        this.write("debug", stage, message, raw, save)
    }

    trace(stage: LogStage | string, message: string, raw?: LogRaw, save = true) {
        this.write("trace", stage, message, raw, save)
    }

    private write(
        level: LogLevel,
        stage: LogStage | string,
        message: string,
        raw?: LogRaw,
        save = true
    ) {
        const shouldDeliver = shouldLogLevel(level, this.level)
        if (!shouldDeliver) return

        const resolvedRaw = typeof raw === "function" ? raw() : raw
        const entry = createStructuredLog(save ? this.step : undefined, level, stage, message, resolvedRaw)

        console.log(formatConsoleLog(entry))
        this.onLog?.(entry)

        if (save) {
            this.logs.push(entry)
            this.step++
        }
    }

    async ios(message = "No Notification", title = "Alertpilot", openURL?: string) {
        if (!DEBUG && !message) return

        await Notification.schedule({
            title,
            body: String(message),
            iconImageData: {
                systemImage: "reminders.checklist",
                color: "rgba(238, 92, 98, 1)"
            },
            threadIdentifier: "Alertpilot",
            tapAction: openURL
                ? { type: "openURL", url: openURL }
                : "none",
            trigger: null
        })
    }
}

function extractMessage(value: unknown): string {
    if (!value || typeof value !== "object") return ""
    const message = (value as { message?: unknown }).message
    return typeof message === "string" ? message : ""
}

export type { LogStage, StructuredLogEntry }
