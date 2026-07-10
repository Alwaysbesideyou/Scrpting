# AI Assistant Grid + Output at Cursor

## Done

1. **Added `columnsPerRow` to `AISettings` type** (`types.ts`)
   - New field `columnsPerRow: number`, default 2
   - Added to `DEFAULT_AI_SETTINGS` and `readAISettingsFromRaw` in `ai_store.ts`

2. **Updated AI settings UI** (`AppRoot.tsx`)
   - `AISettingsView` now accepts and saves `columnsPerRow`
   - Added a picker with options 1-4 under "键盘 AI 助手布局"
   - `AISettingsResult` type includes `columnsPerRow`
   - `presentAISettings` passes and saves `columnsPerRow`
   - Used `DEFAULT_AI_SETTINGS` as fallback for `aiSettings` state

3. **AI panel now shows ALL assistants in a grid** (`KeyboardView.tsx`)
   - Removed the hardcoded `.slice(0, 4)` limit
   - Uses `LazyVGrid` with `columnsPerRow` (default 2) for layout
   - Assistants wrap to next row when exceeding columnsPerRow

4. **AI output goes to cursor** (`KeyboardView.tsx`)
   - `runAIAssistant` now calls `insertKeyboardText(resultText)` instead of `setAiInput(resultText)`
   - Input field stays unchanged after AI response — user sees their original input
