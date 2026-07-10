import type { AIAssistant, AISettings } from "../types"
import { DEFAULT_AI_SETTINGS } from "../types"

export function createAIAssistantId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function readAISettingsFromRaw(raw: any): AISettings {
  const defaults = { ...DEFAULT_AI_SETTINGS }
  if (!raw || typeof raw !== "object") return defaults
  return {
    assistants: Array.isArray(raw.assistants) ? raw.assistants : defaults.assistants,
    defaultProvider: String(raw.defaultProvider ?? defaults.defaultProvider),
    defaultModelId: String(raw.defaultModelId ?? defaults.defaultModelId),
    columnsPerRow: Number.isFinite(Number(raw.columnsPerRow)) ? Math.max(2, Math.min(4, Number(raw.columnsPerRow))) : defaults.columnsPerRow,
  }
}

export function sortedAssistants(assistants: AIAssistant[]): AIAssistant[] {
  return assistants
    .map((a, i) => ({
      ...a,
      sortOrder: Number.isFinite(a.sortOrder) ? a.sortOrder : i,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
}

export function normalizeAssistantOrders(assistants: AIAssistant[]): AIAssistant[] {
  return sortedAssistants(assistants).map((a, i) => ({ ...a, sortOrder: i }))
}

export function updateAssistant(
  assistants: AIAssistant[],
  id: string,
  updates: Partial<Pick<AIAssistant, "name" | "systemPrompt" | "provider" | "modelId">>
): AIAssistant[] {
  return assistants.map((a) =>
    a.id === id ? { ...a, ...updates, updatedAt: Date.now() } : a
  )
}

export function removeAssistant(assistants: AIAssistant[], id: string): AIAssistant[] {
  return assistants.filter((a) => a.id !== id)
}

export function reorderAssistants(
  assistants: AIAssistant[],
  fromIndices: number[],
  toIndex: number
): AIAssistant[] {
  const sorted = sortedAssistants(assistants)
  const moving = fromIndices
    .sort((a, b) => a - b)
    .map((i) => sorted[i])
    .filter(Boolean)
  if (!moving.length) return sorted
  const remaining = sorted.filter((_, i) => !fromIndices.includes(i))
  const removedBefore = fromIndices.filter((i) => i < toIndex).length
  const target = Math.max(0, Math.min(remaining.length, toIndex - removedBefore))
  remaining.splice(target, 0, ...moving)
  return normalizeAssistantOrders(remaining)
}
