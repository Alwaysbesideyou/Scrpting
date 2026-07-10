import {
  DisclosureGroup,
  Button,
  fetch,
  ForEach,
  Form,
  HStack,
  Image,
  Menu,
  Navigation,
  NavigationLink,
  NavigationStack,
  Picker,
  Section,
  SecureField,
  Spacer,
  Stepper,
  Text,
  TextField,
  Toggle,
  useEffect,
  useObservable,
  useRef,
  useState,
} from "scripting";

import type {
  AppStartPage,
  CaisSettings,
  ClipboardClearRange,
  RemoteTimeDisplayMode,
  SyncClipboardAccount,
  KeyboardCustomAction,
  KeyboardCustomActionMode,
  KeyboardMenuBuiltinAction,
} from "../types";
import { makeId } from "../utils/common";
import {
  JAVASCRIPT_ACTION_EXAMPLE,
  runJavaScriptTransform,
  validateRegexPattern,
  validateRuntimeTemplate,
} from "../utils/custom_action";

const INTERVAL_OPTIONS = [100, 200, 300, 400, 500];
const MAX_ITEM_OPTIONS = [200, 500, 800];
const KEYBOARD_MAX_ITEM_OPTIONS = [30, 50, 100, 200, 0];
const CLIPBOARD_CLEAR_OPTIONS: Array<{ range: ClipboardClearRange; title: string }> = [
  { range: "recent", title: "最近内容" },
  { range: "threeDays", title: "近三天" },
  { range: "sevenDays", title: "近七天" },
  { range: "older", title: "更早" },
];
const APP_START_PAGE_OPTIONS: Array<{ value: AppStartPage; title: string }> = [
  { value: "favorites", title: "收藏" },
  { value: "network", title: "剪切板" },
  { value: "memos", title: "Memos" },
  { value: "ai", title: "AI" },
  { value: "settings", title: "设置" },
];
const APP_CONTENT_LINE_MIN = 1;
const APP_CONTENT_LINE_MAX = 12;
const JAVASCRIPT_HELP = [
  "函数名必须是 transform，只接收一个文本参数 text，需返回 { text }。",
  "trim(): 移除首尾空白",
  "replace(a, b): 替换内容，可配合正则使用",
  "match(regexp): 获取匹配结果",
  "split(text): 拆分字符串",
  "join(text): 合并数组为字符串",
  "toUpperCase(): 转为大写",
  "toLowerCase(): 转为小写",
  "slice(start, end): 截取字符串",
].join("\n");

const BUILTIN_ACTIONS: Array<{
  key: KeyboardMenuBuiltinAction;
  title: string;
}> = [
  { key: "pin", title: "置顶" },
  { key: "favorite", title: "收藏" },
  { key: "tokenize", title: "分词" },
  { key: "base64Encode", title: "Base64 编码" },
  { key: "base64Decode", title: "Base64 解码" },
  { key: "cleanWhitespace", title: "移除空格" },
  { key: "removeBlankLines", title: "移除空行" },
  { key: "splitLines", title: "按行拆分" },
  { key: "uppercase", title: "转为大写" },
  { key: "lowercase", title: "转为​小写" },
  { key: "chineseAmount", title: "中文大写金额" },
  { key: "openUrl", title: "打开链接" },
];
const FIXED_BUILTIN_ACTION_KEYS: KeyboardMenuBuiltinAction[] = [
  "pin",
  "favorite",
];
const CONFIGURABLE_BUILTIN_ACTIONS = BUILTIN_ACTIONS.filter(
  (action) => !FIXED_BUILTIN_ACTION_KEYS.includes(action.key),
);

function syncAccountId(account: Pick<SyncClipboardAccount, "id" | "url" | "username">): string {
  const id = (account.id || "").trim();
  if (id) return id;
  return `${(account.url || "").trim().replace(/\/+$/, "")}\n${account.username || ""}`;
}

function syncAccountKey(account: Pick<SyncClipboardAccount, "url" | "username">): string {
  return `${(account.url || "").trim().replace(/\/+$/, "")}\n${account.username || ""}`;
}

function compareSyncAccountId(a: SyncClipboardAccount, b: SyncClipboardAccount): number {
  const left = syncAccountId(a);
  const right = syncAccountId(b);
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function sortSyncAccounts(accounts: SyncClipboardAccount[]): SyncClipboardAccount[] {
  return [...accounts].sort(compareSyncAccountId);
}

function syncAccountTitle(account: Pick<SyncClipboardAccount, "url" | "username">): string {
  const rawUrl = (account.url || "").trim();
  const host = rawUrl.replace(/^https?:\/\//i, "").split("/")[0] || "未填写服务器";
  return `${host}-${account.username || "匿名"}`;
}

function accountFromSync(sync: CaisSettings["syncClipboard"]): SyncClipboardAccount | null {
  const url = (sync.url || "").trim().replace(/\/+$/, "");
  if (!url) return null;
  return {
    id: sync.currentAccountId || makeId("sync_account"),
    url,
    username: sync.username || "",
    password: sync.password || "",
    allowInsecure: Boolean(sync.allowInsecure),
  };
}

function upsertSyncAccount(
  accounts: SyncClipboardAccount[],
  account: SyncClipboardAccount | null,
  replaceId?: string,
): SyncClipboardAccount[] {
  if (!account) return sortSyncAccounts(accounts);
  const fixedAccount = { ...account, id: account.id || replaceId || makeId("sync_account") };
  const duplicateKey = syncAccountKey(fixedAccount);
  const next = accounts.filter((item) => {
    if (replaceId && syncAccountId(item) === replaceId) return false;
    if (syncAccountId(item) === fixedAccount.id) return false;
    return syncAccountKey(item) !== duplicateKey;
  });
  return sortSyncAccounts([fixedAccount, ...next]).slice(0, 20);
}

function syncAccountOptions(sync: CaisSettings["syncClipboard"]): SyncClipboardAccount[] {
  return sortSyncAccounts(upsertSyncAccount(sync.accounts || [], accountFromSync(sync)));
}

function selectedSyncAccountIndex(sync: CaisSettings["syncClipboard"]): number {
  const current = accountFromSync(sync);
  const options = syncAccountOptions(sync);
  if (!current) return options.length;
  const index = options.findIndex(
    (item) => syncAccountId(item) === syncAccountId(current),
  );
  return index >= 0 ? index : options.length;
}

function optionIndex(options: number[], value: number): number {
  const index = options.findIndex((item) => item === value);
  return index >= 0 ? index : 0;
}

function customActionModeIndex(mode: KeyboardCustomActionMode): number {
  if (mode === "regexExtract") return 1;
  if (mode === "regexRemove") return 2;
  if (mode === "javascript") return 3;
  return 0;
}

function customActionModeFromIndex(index: number): KeyboardCustomActionMode {
  if (index === 1) return "regexExtract";
  if (index === 2) return "regexRemove";
  if (index === 3) return "javascript";
  return "template";
}

function appStartPageIndex(value: AppStartPage): number {
  const index = APP_START_PAGE_OPTIONS.findIndex((item) => item.value === value);
  return index >= 0 ? index : 1;
}

function CustomActionEditorView(props: { action?: KeyboardCustomAction }) {
  const dismiss = Navigation.useDismiss();
  const [title, setTitle] = useState(props.action?.title ?? "");
  const [mode, setMode] = useState<KeyboardCustomActionMode>(
    props.action?.mode ?? "template",
  );
  const [template, setTemplate] = useState(
    props.action?.template ?? "{{text}}",
  );
  const [regex, setRegex] = useState(props.action?.regex ?? "");
  const [regexRemoveAll, setRegexRemoveAll] = useState(
    Boolean(props.action?.regexRemoveAll ?? true),
  );
  const [script, setScript] = useState(
    props.action?.script ?? JAVASCRIPT_ACTION_EXAMPLE,
  );

  async function save() {
    const fixedTitle = title.trim();
    const fixedTemplate = template.trim();
    const fixedRegex = regex.trim();
    const fixedScript = script.trim();
    if (!fixedTitle) {
      await Dialog.alert({ message: "请输入功能名称" });
      return;
    }
    if (mode === "template" && !fixedTemplate) {
      await Dialog.alert({ message: "请输入模板内容" });
      return;
    }
    if ((mode === "regexExtract" || mode === "regexRemove") && !fixedRegex) {
      await Dialog.alert({ message: "请输入正则表达式" });
      return;
    }
    if (mode === "javascript" && !fixedScript) {
      await Dialog.alert({ message: "请输入 JavaScript 函数" });
      return;
    }
    if (mode === "template") {
      const templateError = validateRuntimeTemplate(fixedTemplate);
      if (templateError) {
        await Dialog.alert({ title: "模板错误", message: templateError });
        return;
      }
    }
    if (mode === "regexExtract" || mode === "regexRemove") {
      const regexError = validateRegexPattern(
        fixedRegex,
        mode === "regexRemove" && regexRemoveAll,
      );
      if (regexError) {
        await Dialog.alert({
          title: "正则表达式错误",
          message: regexError,
        });
        return;
      }
    }
    if (mode === "javascript") {
      try {
        runJavaScriptTransform(fixedScript, "示例文本");
      } catch (error: any) {
        await Dialog.alert({
          title: "JavaScript 错误",
          message: String(error?.message ?? error ?? "JavaScript 函数无效"),
        });
        return;
      }
    }
    dismiss({
      id: props.action?.id ?? makeId("menu"),
      title: fixedTitle,
      mode,
      template: mode === "template" ? fixedTemplate : "",
      regex: mode === "regexExtract" || mode === "regexRemove" ? fixedRegex : "",
      regexRemoveAll: mode === "regexRemove" ? regexRemoveAll : false,
      script: mode === "javascript" ? fixedScript : "",
      enabled: props.action?.enabled ?? true,
    });
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle={props.action ? "编辑功能" : "添加功能"}
        navigationBarTitleDisplayMode="inline"
        formStyle="grouped"
        presentationDetents={[0.72, "large"]}
        presentationDragIndicator="visible"
        toolbar={{
          topBarLeading: (
            <Button title="取消" role="cancel" action={() => dismiss(null)} />
          ),
          topBarTrailing: <Button title="保存" action={() => void save()} />,
        }}
      >
        <Section header={<Text>基本信息</Text>}>
          <TextField
            title="名称"
            value={title}
            prompt="例如：提取手机号"
            onChanged={setTitle}
          />
          <Picker
            title="类型"
            pickerStyle="menu"
            value={customActionModeIndex(mode)}
            onChanged={(index: number) =>
              setMode(customActionModeFromIndex(index))
            }
          >
            <Text tag={0}>模板替换</Text>
            <Text tag={1}>正则提取</Text>
            <Text tag={2}>正则删除</Text>
            <Text tag={3}>JavaScript 转换</Text>
          </Picker>
        </Section>

        {mode === "template" ? (
          <Section
            header={<Text>模板</Text>}
            footer={
              <Text>
                {
                  "可使用 {{text}}、{{date}}、{{time}}、{{datetime}}、{{timestamp}}。"
                }
              </Text>
            }
          >
            <TextField
              title=""
              value={template}
              prompt={'例如："{{text}}" - {{datetime}}'}
              axis="vertical"
              frame={{
                minHeight: 92,
                maxWidth: "infinity",
                alignment: "topLeading" as any,
              }}
              onChanged={setTemplate}
            />
          </Section>
        ) : mode === "javascript" ? (
          <Section
            header={<Text>JavaScript 函数</Text>}
            footer={
              <Text>{JAVASCRIPT_HELP}</Text>
            }
          >
            <TextField
              title=""
              value={script}
              prompt={JAVASCRIPT_ACTION_EXAMPLE}
              axis="vertical"
              frame={{
                minHeight: 170,
                maxWidth: "infinity",
                alignment: "topLeading" as any,
              }}
              onChanged={setScript}
            />
          </Section>
        ) : (
          <Section
            header={<Text>正则表达式</Text>}
            footer={
              <Text>
                {mode === "regexRemove"
                  ? "应用时会移除命中的内容。"
                  : "应用时会插入第一个捕获组；没有捕获组时插入完整匹配结果。"}
              </Text>
            }
          >
            <TextField
              title=""
              value={regex}
              prompt={
                mode === "regexRemove"
                  ? "例如：\\s+"
                  : "例如：[\\w.-]+@[\\w.-]+\\.[A-Za-z]{2,}"
              }
              axis="vertical"
              frame={{
                minHeight: 92,
                maxWidth: "infinity",
                alignment: "topLeading" as any,
              }}
              onChanged={setRegex}
            />
            {mode === "regexRemove" ? (
              <Toggle
                title="删除全部匹配"
                value={regexRemoveAll}
                onChanged={setRegexRemoveAll}
                toggleStyle="switch"
              />
            ) : null}
          </Section>
        )}
      </Form>
    </NavigationStack>
  );
}

function SyncAccountEditorPage(props: {
  initialDraft: SyncClipboardAccount;
  navigationTitle: string;
  onSave: (draft: SyncClipboardAccount) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onTest: (draft: SyncClipboardAccount) => Promise<void>;
}) {
  const [draft, setDraft] = useState(props.initialDraft);
  const [passwordVisible, setPasswordVisible] = useState(false);

  function updateDraft(patch: Partial<SyncClipboardAccount>) {
    setDraft((current: SyncClipboardAccount) => ({ ...current, ...patch }));
  }

  return (
    <Form navigationTitle={props.navigationTitle} formStyle="grouped">
      <Section>
        <TextField title="服务器地址" value={draft.url} prompt="https://example.com 或 http://192.168.1.10:5033" onChanged={(url: string) => updateDraft({ url })} />
        <TextField title="用户名" value={draft.username} prompt="留空表示无需登录" onChanged={(username: string) => updateDraft({ username })} />
        <HStack frame={{ maxWidth: "infinity", alignment: "center" as any }}>
          {passwordVisible ? (
            <TextField title="密码" value={draft.password} prompt="对应 SyncClipboard 的 Basic Auth 密码" onChanged={(password: string) => updateDraft({ password })} />
          ) : (
            <SecureField title="密码" value={draft.password} prompt="对应 SyncClipboard 的 Basic Auth 密码" onChanged={(password: string) => updateDraft({ password })} />
          )}
          <Button action={() => setPasswordVisible(!passwordVisible)}>
            <Image systemName={passwordVisible ? "eye.slash" : "eye"} foregroundStyle="secondaryLabel" />
          </Button>
        </HStack>
        <Toggle value={draft.allowInsecure} onChanged={(allowInsecure: boolean) => updateDraft({ allowInsecure })} toggleStyle="switch">
          <Text>允许自签名 / HTTP 请求</Text>
        </Toggle>
        <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Button title="测试链接" systemImage="network" action={() => void props.onTest(draft)} />
        </HStack>
        <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Button title="保存账号" systemImage="tray.and.arrow.down" action={() => void props.onSave(draft)} />
        </HStack>
        <Button title="删除账号" systemImage="person.crop.circle.badge.minus" role="destructive" action={() => void props.onDelete()} />
      </Section>
    </Form>
  );
}

export function SettingsView(props: {
  value: CaisSettings;
  onChanged: (settings: CaisSettings) => void;
  onClearFavorites?: () => void;
  onClearClipboard?: (range: ClipboardClearRange) => void;
  onSyncNow?: () => Promise<void> | void;
  onClearRemote?: () => Promise<void> | void;
  onRemoteStats?: () => Promise<void> | void;
  addActionToken?: number;
  leadingToolbar?: any;
  trailingToolbar?: any;
}) {
  const settings = props.value;
  const sync = settings.syncClipboard;
  const [syncDraft, setSyncDraft] = useState<SyncClipboardAccount>(() => accountFromSync(sync) ?? {
    id: makeId("sync_account"),
    url: "",
    username: "",
    password: "",
    allowInsecure: false,
  });
  const [syncAccountPickerIndex, setSyncAccountPickerIndex] = useState(() => selectedSyncAccountIndex(sync));
  const [syncSettingsExpanded, setSyncSettingsExpanded] = useState(false);

  useEffect(() => {
    setSyncDraft(accountFromSync(sync) ?? {
      id: makeId("sync_account"),
      url: "",
      username: "",
      password: "",
      allowInsecure: false,
    });
    setSyncAccountPickerIndex(selectedSyncAccountIndex(sync));
  }, [sync]);

  function updateSync(patch: Partial<typeof sync>) {
    update({ syncClipboard: { ...sync, ...patch } });
  }

  function updateSyncDraft(patch: Partial<SyncClipboardAccount>) {
    setSyncDraft((current: SyncClipboardAccount) => ({ ...current, ...patch }));
  }

  async function saveSyncDraft(draft: SyncClipboardAccount = syncDraft): Promise<boolean> {
    const url = draft.url.trim().replace(/\/+$/, "");
    if (!url) {
      await Dialog.alert({ message: "请先填写服务器地址" });
      return false;
    }
    const editingAccount = syncAccountPickerIndex < syncAccountOptions(sync).length
      ? syncAccountOptions(sync)[syncAccountPickerIndex]
      : null;
    const editingId = editingAccount ? syncAccountId(editingAccount) : (draft.id || makeId("sync_account"));
    const nextAccount: SyncClipboardAccount = {
      id: draft.id || editingId,
      url,
      username: draft.username,
      password: draft.password,
      allowInsecure: draft.allowInsecure,
    };
    const accounts = upsertSyncAccount(sync.accounts || [], nextAccount, editingId);
    const nextIndex = accounts.findIndex((item) => syncAccountId(item) === syncAccountId(nextAccount));
    update({
      syncClipboard: {
        ...sync,
        url: nextAccount.url,
        username: nextAccount.username,
        password: nextAccount.password,
        allowInsecure: nextAccount.allowInsecure,
        currentAccountId: nextAccount.id,
        accounts,
      },
    });
    setSyncAccountPickerIndex(nextIndex >= 0 ? nextIndex : 0);
    return true;
  }

  function selectSyncAccount(index: number) {
    const options = syncAccountOptions(sync);
    if (index >= options.length) {
      setSyncAccountPickerIndex(options.length);
      setSyncDraft({
        id: makeId("sync_account"),
        url: "",
        username: "",
        password: "",
        allowInsecure: false,
      });
      return;
    }
    const account = options[index];
    if (!account) return;
    const nextSync = {
      ...sync,
      url: account.url,
      username: account.username,
      password: account.password,
      allowInsecure: account.allowInsecure,
      currentAccountId: account.id,
    };
    update({ syncClipboard: nextSync });
    setSyncAccountPickerIndex(index);
    setSyncDraft({
      id: account.id || makeId("sync_account"),
      url: account.url,
      username: account.username,
      password: account.password,
      allowInsecure: account.allowInsecure,
    });
  }

  async function deleteCurrentSyncAccount() {
    const options = syncAccountOptions(sync);
    if (syncAccountPickerIndex >= options.length) {
      await Dialog.alert({ message: "当前没有可删除的同步账号" });
      return;
    }
    const current = options[syncAccountPickerIndex];
    if (!current) {
      await Dialog.alert({ message: "当前没有可删除的同步账号" });
      return;
    }
    const ok = await Dialog.confirm({
      title: "删除该账号？",
      message: syncAccountTitle(current),
      cancelLabel: "取消",
      confirmLabel: "删除",
    });
    if (!ok) return;
    const remaining = options.filter((item) => syncAccountId(item) !== syncAccountId(current));
    const nextAccount = remaining[0];
    update({
      syncClipboard: {
        ...sync,
        url: nextAccount?.url ?? "",
        username: nextAccount?.username ?? "",
        password: nextAccount?.password ?? "",
        allowInsecure: nextAccount?.allowInsecure ?? sync.allowInsecure,
        currentAccountId: nextAccount?.id ?? "",
        accounts: remaining,
      },
    });
    if (nextAccount) {
      setSyncAccountPickerIndex(0);
      setSyncDraft({
        id: nextAccount.id || makeId("sync_account"),
        url: nextAccount.url,
        username: nextAccount.username,
        password: nextAccount.password,
        allowInsecure: nextAccount.allowInsecure,
      });
    } else {
      setSyncAccountPickerIndex(0);
      setSyncDraft({
        id: makeId("sync_account"),
        url: "",
        username: "",
        password: "",
        allowInsecure: false,
      });
    }
  }

  async function testSyncDraftConnection(draft: SyncClipboardAccount = syncDraft): Promise<void> {
    const url = draft.url.trim().replace(/\/+$/, "");
    if (!url) {
      await Dialog.alert({ message: "请先填写服务器地址" });
      return;
    }
    try {
      const dataClass = (globalThis as any).Data;
      const auth = draft.username || draft.password
        ? { Authorization: `Basic ${dataClass.fromRawString(`${draft.username}:${draft.password}`, "utf-8")?.toBase64String?.() ?? ""}` }
        : {};
      const response = await fetch(`${url}/api/history/statistics`, {
        method: "GET",
        headers: { Accept: "application/json", ...auth },
        timeout: sync.timeoutSec || 100,
        allowInsecureRequest: draft.allowInsecure || /^http:\/\//i.test(url),
      } as any);
      await Dialog.alert({
        title: response.ok ? "连接成功" : "连接失败",
        message: response.ok ? "服务器可访问。" : `服务器返回 ${response.status}`,
      });
    } catch (error: any) {
      await Dialog.alert({ title: "连接失败", message: String(error?.message ?? error ?? "请求失败") });
    }
  }

  function FileAutoDownloadFilterPage() {
    // Use refs to avoid stale closure issues
    const filterModeRef = useRef(sync.fileAutoDownloadFilterMode || "disabled")
    const extensionsRef = useRef<string[]>(sync.fileAutoDownloadExtensions || [])
    const [renderKey, setRenderKey] = useState(0)
    const [newExtension, setNewExtension] = useState("")

    // Sync with parent state
    useEffect(() => {
      filterModeRef.current = sync.fileAutoDownloadFilterMode || "disabled"
      extensionsRef.current = sync.fileAutoDownloadExtensions || []
      setRenderKey(k => k + 1)
    }, [sync.fileAutoDownloadFilterMode, sync.fileAutoDownloadExtensions])

    function handleFilterModeChange(index: number) {
      const mode = index === 1 ? "whitelist" : index === 2 ? "blacklist" : "disabled"
      filterModeRef.current = mode
      setRenderKey(k => k + 1)
      updateSync({ fileAutoDownloadFilterMode: mode })
    }

    function handleExtensionsChange(newExtensions: string[]) {
      extensionsRef.current = newExtensions
      setRenderKey(k => k + 1)
      updateSync({ fileAutoDownloadExtensions: newExtensions })
    }

    function addExtension() {
      const ext = newExtension.trim().toLowerCase().replace(/^\.*/, "")
      if (!ext) return
      if (extensionsRef.current.includes(ext)) {
        Dialog.alert({ message: `"${ext}" 已存在` })
        return
      }
      handleExtensionsChange([...extensionsRef.current, ext])
      setNewExtension("")
    }

    function removeExtension(ext: string) {
      handleExtensionsChange(extensionsRef.current.filter((e) => e !== ext))
    }

    const filterMode = filterModeRef.current
    const extensions = extensionsRef.current
    const filterModeIndex = filterMode === "whitelist" ? 1 : filterMode === "blacklist" ? 2 : 0

    return (
      <Form key={renderKey} navigationTitle="文件下载过滤" formStyle="grouped">
        <Section header={<Text>过滤模式</Text>} footer={<Text>{filterMode === "disabled" ? "不过滤，所有满足大小限制的文件都会自动下载。" : filterMode === "whitelist" ? "白名单模式：只自动下载指定类型的文件。" : "黑名单模式：不自动下载指定类型的文件。"}</Text>}>
          <Picker title="过滤模式" pickerStyle="menu" value={filterModeIndex} onChanged={handleFilterModeChange}>
            <Text tag={0}>不过滤</Text>
            <Text tag={1}>白名单</Text>
            <Text tag={2}>黑名单</Text>
          </Picker>
        </Section>
        {filterMode !== "disabled" ? (
          <Section header={<Text>文件扩展名列表</Text>} footer={<Text>添加要{filterMode === "whitelist" ? "允许" : "阻止"}自动下载的文件扩展名（不含点号，如 pdf、doc、zip）。</Text>}>
            {extensions.map((ext: string) => (
              <HStack key={ext}>
                <Text>.{ext}</Text>
                <Spacer />
                <Button title="删除" systemImage="trash" role="destructive" action={() => removeExtension(ext)} />
              </HStack>
            ))}
            <HStack>
              <TextField title="添加扩展名" value={newExtension} prompt="如 pdf、doc" onChanged={setNewExtension} />
              <Button title="添加" systemImage="plus.circle" action={addExtension} />
            </HStack>
          </Section>
        ) : null}
      </Form>
    )
  }

  function SyncContentControlPage() {
    return (
      <Form navigationTitle="同步内容控制" formStyle="grouped">
        <Section>
          <Toggle value={sync.autoDownload} onChanged={(autoDownload: boolean) => updateSync({ autoDownload })} toggleStyle="switch"><Text>开启下载</Text></Toggle>
          {sync.autoDownload ? (
            <>
              <Stepper onIncrement={() => updateSync({ maxAutoDownloadFileSizeMb: Math.min(1024, (sync.maxAutoDownloadFileSizeMb || 10) + 1) })} onDecrement={() => updateSync({ maxAutoDownloadFileSizeMb: Math.max(1, (sync.maxAutoDownloadFileSizeMb || 10) - 1) })}>
                <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  <Text>自动下载文件大小限制</Text>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel">{sync.maxAutoDownloadFileSizeMb || 10} MB</Text>
                </HStack>
              </Stepper>
              <NavigationLink title="文件下载过滤" destination={<FileAutoDownloadFilterPage />} />
            </>
          ) : null}
          <Toggle value={sync.autoUpload} onChanged={(autoUpload: boolean) => updateSync({ autoUpload })} toggleStyle="switch"><Text>开启上传</Text></Toggle>
          <Toggle value={sync.uploadText} onChanged={(uploadText: boolean) => updateSync({ uploadText })} toggleStyle="switch"><Text>上传文字</Text></Toggle>
          <Toggle value={sync.uploadSingleFile} onChanged={(uploadSingleFile: boolean) => updateSync({ uploadSingleFile })} toggleStyle="switch"><Text>上传单个文件（包含图片）</Text></Toggle>
          <Toggle value={sync.uploadMultipleFiles} onChanged={(uploadMultipleFiles: boolean) => updateSync({ uploadMultipleFiles })} toggleStyle="switch"><Text>上传多个文件或文件夹</Text></Toggle>
          <Stepper onIncrement={() => updateSync({ maxUploadFileSizeMb: Math.min(2048, sync.maxUploadFileSizeMb + 1) })} onDecrement={() => updateSync({ maxUploadFileSizeMb: Math.max(1, sync.maxUploadFileSizeMb - 1) })}>
            <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
              <Text>最大上传文件大小</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel">{sync.maxUploadFileSizeMb} MB</Text>
            </HStack>
          </Stepper>
        </Section>
        <Section footer={<Text>开启下载后，远程文件类型（File）的记录会根据大小自动下载。小于限制的文件会自动下载到本地，大于限制的文件需要手动点击下载。图片和文本的下载不受此限制。</Text>}>
          <Text foregroundStyle="secondaryLabel">下载说明</Text>
        </Section>
      </Form>
    );
  }

  useEffect(() => {
    if (!props.addActionToken) return;
    void presentCustomActionEditor();
  }, [props.addActionToken]);

  function update(next: Partial<CaisSettings>) {
    props.onChanged({ ...settings, ...next });
  }

  function getOrderedBuiltinActions() {
    const order = settings.keyboardMenu.builtinOrder?.filter(
      (key) => !FIXED_BUILTIN_ACTION_KEYS.includes(key),
    );
    if (!order || !order.length) return CONFIGURABLE_BUILTIN_ACTIONS;
    const sorted = order
      .map((key) => CONFIGURABLE_BUILTIN_ACTIONS.find((a) => a.key === key))
      .filter(Boolean) as typeof BUILTIN_ACTIONS;
    const tokenize = CONFIGURABLE_BUILTIN_ACTIONS.find((a) => a.key === "tokenize");
    if (tokenize) {
      const index = sorted.findIndex((item) => item.key === "tokenize");
      if (index >= 0) sorted.splice(index, 1);
      sorted.unshift(tokenize);
    }
    const insertAfter = (
      anchor: KeyboardMenuBuiltinAction,
      action: typeof CONFIGURABLE_BUILTIN_ACTIONS[number],
    ) => {
      if (sorted.some((item) => item.key === action.key)) return;
      const index = sorted.findIndex((item) => item.key === anchor);
      if (index >= 0) {
        sorted.splice(index + 1, 0, action);
      } else {
        sorted.push(action);
      }
    };
    const removeBlankLines = CONFIGURABLE_BUILTIN_ACTIONS.find((a) => a.key === "removeBlankLines");
    const splitLines = CONFIGURABLE_BUILTIN_ACTIONS.find((a) => a.key === "splitLines");
    if (removeBlankLines) insertAfter("cleanWhitespace", removeBlankLines);
    if (splitLines) insertAfter("removeBlankLines", splitLines);
    for (const action of CONFIGURABLE_BUILTIN_ACTIONS) {
      if (!sorted.some((item) => item.key === action.key)) sorted.push(action);
    }
    return sorted;
  }

  function reorderBuiltins(indices: number[], newOffset: number) {
    const ordered = getOrderedBuiltinActions();
    const moving = indices.map((i) => ordered[i]);
    const rest = ordered.filter((_, i) => !indices.includes(i));
    rest.splice(newOffset, 0, ...moving);
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        builtinOrder: [
          "tokenize",
          ...rest.map((a) => a.key).filter((key) => key !== "tokenize"),
        ],
      },
    });
  }

  function reorderCustomActions(indices: number[], newOffset: number) {
    const arr = [...settings.keyboardMenu.customActions];
    const moving = indices.map((i) => arr[i]);
    const rest = arr.filter((_, i) => !indices.includes(i));
    rest.splice(newOffset, 0, ...moving);
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        customActions: rest,
      },
    });
  }

  function updateBuiltin(key: KeyboardMenuBuiltinAction, value: boolean) {
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        builtins: {
          ...settings.keyboardMenu.builtins,
          [key]: value,
        },
      },
    });
  }

  function updateCustomAction(
    id: string,
    patch: Partial<KeyboardCustomAction>,
  ) {
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        customActions: settings.keyboardMenu.customActions.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      },
    });
  }

  function saveCustomAction(action: KeyboardCustomAction) {
    const exists = settings.keyboardMenu.customActions.some(
      (item) => item.id === action.id,
    );
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        customActions: exists
          ? settings.keyboardMenu.customActions.map((item) =>
              item.id === action.id ? action : item,
            )
          : [...settings.keyboardMenu.customActions, action].slice(0, 12),
      },
    });
  }

  function removeCustomAction(id: string) {
    update({
      keyboardMenu: {
        ...settings.keyboardMenu,
        customActions: settings.keyboardMenu.customActions.filter(
          (item) => item.id !== id,
        ),
      },
    });
  }

  async function presentCustomActionEditor(action?: KeyboardCustomAction) {
    const next = await Navigation.present<KeyboardCustomAction | null>({
      element: <CustomActionEditorView action={action} />,
      modalPresentationStyle: "pageSheet",
    });
    if (next) saveCustomAction(next);
  }

  return (
    <Form
      formStyle="grouped"
      toolbar={{
        topBarLeading: props.leadingToolbar,
        topBarTrailing: props.trailingToolbar,
      }}
    >
      <Section
        header={<Text>剪贴板同步</Text>}
        footer={<Text>{sync.enabled ? (sync.url ? `服务器：${sync.url}` : "已启用同步，但还未填写服务器地址") : "开启后会按设定间隔与 SyncClipboard 服务器同步文本和图片。"}</Text>}
      >
        <Toggle value={sync.enabled} onChanged={(enabled: boolean) => updateSync({ enabled })} toggleStyle="switch">
          <Text>启用同步</Text>
        </Toggle>
        {(() => {
          const options = syncAccountOptions(sync);
          return (
            <Picker title="同步账号" pickerStyle="menu" value={syncAccountPickerIndex} onChanged={selectSyncAccount}>
              {options.map((account, index) => (
                <Text key={syncAccountId(account)} tag={index}>{syncAccountTitle(account)}</Text>
              ))}
            </Picker>
          );
        })()}
        <NavigationLink destination={<SyncAccountEditorPage
          initialDraft={syncDraft}
          navigationTitle={syncAccountPickerIndex >= syncAccountOptions(sync).length ? "添加账号" : "修改账号"}
          onSave={saveSyncDraft}
          onDelete={deleteCurrentSyncAccount}
          onTest={testSyncDraftConnection}
        />}>
          <Text>{syncAccountPickerIndex >= syncAccountOptions(sync).length ? "添加账号" : "修改账号"}</Text>
        </NavigationLink>
        <DisclosureGroup title="同步设置" isExpanded={syncSettingsExpanded} onChanged={setSyncSettingsExpanded}>
          <Stepper onIncrement={() => updateSync({ intervalSec: Math.min(3600, sync.intervalSec + 1) })} onDecrement={() => updateSync({ intervalSec: Math.max(2, sync.intervalSec - 1) })}>
            <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}><Text>同步间隔</Text><Spacer /><Text foregroundStyle="secondaryLabel">{sync.intervalSec} 秒</Text></HStack>
          </Stepper>
          <Stepper onIncrement={() => updateSync({ retryCount: Math.min(20, sync.retryCount + 1) })} onDecrement={() => updateSync({ retryCount: Math.max(0, sync.retryCount - 1) })}>
            <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}><Text>重试次数</Text><Spacer /><Text foregroundStyle="secondaryLabel">{sync.retryCount} 次</Text></HStack>
          </Stepper>
          <Stepper onIncrement={() => updateSync({ timeoutSec: Math.min(600, sync.timeoutSec + 1) })} onDecrement={() => updateSync({ timeoutSec: Math.max(5, sync.timeoutSec - 1) })}>
            <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}><Text>超时时间</Text><Spacer /><Text foregroundStyle="secondaryLabel">{sync.timeoutSec} 秒</Text></HStack>
          </Stepper>
          <NavigationLink title="同步内容控制" destination={<SyncContentControlPage />} />
        </DisclosureGroup>
        {props.onSyncNow ? <Button title="保存并同步" systemImage="arrow.triangle.2.circlepath" action={async () => { const saved = await saveSyncDraft(); if (saved) await props.onSyncNow?.(); }} /> : null}
        {props.onRemoteStats ? <Button title="查看远程统计" systemImage="chart.bar" action={() => void props.onRemoteStats?.()} /> : null}
      </Section>

      <Section header={<Text>数据管理</Text>}>
        <Button
          title="清空收藏数据"
          systemImage="star.slash"
          role="destructive"
          action={() => props.onClearFavorites?.()}
        />
        <Button
          title="清理剪贴板历史"
          systemImage="trash"
          action={async () => {
            const targetActions = [
              { label: "清理本地剪贴板", destructive: true },
              ...(props.onClearRemote ? [{ label: "清理远程历史", destructive: true }] : []),
            ]
            const target = await Dialog.actionSheet({
              title: "选择清理对象",
              actions: targetActions,
            })
            if (target == null) return
            if (target === 1 && props.onClearRemote) {
              props.onClearRemote()
              return
            }
            const actions = CLIPBOARD_CLEAR_OPTIONS.map((opt) => ({
              label: opt.title,
              destructive: true,
            }))
            const idx = await Dialog.actionSheet({
              title: "选择本地清理范围",
              actions,
            })
            if (idx != null) {
              const option = CLIPBOARD_CLEAR_OPTIONS[idx]
              if (option) {
                props.onClearClipboard?.(option.range)
              }
            }
          }}
        />
      </Section>

      <Section header={<Text>采集类型</Text>}>
        <Toggle
          value={settings.captureText}
          onChanged={(captureText: boolean) => update({ captureText })}
          toggleStyle="switch"
        >
          <Text>文本</Text>
        </Toggle>
        <Toggle
          value={settings.captureImages}
          onChanged={(captureImages: boolean) => update({ captureImages })}
          toggleStyle="switch"
        >
          <Text>图片</Text>
        </Toggle>
      </Section>

      <Section header={<Text>采集策略</Text>}>
        <Picker
          title="重复内容"
          pickerStyle="menu"
          value={settings.duplicatePolicy === "skip" ? 1 : 0}
          onChanged={(index: number) =>
            update({ duplicatePolicy: index === 1 ? "skip" : "bump" })
          }
        >
          <Text tag={0}>更新到顶部</Text>
          <Text tag={1}>跳过</Text>
        </Picker>
        <Picker
          title="监听间隔"
          pickerStyle="menu"
          value={optionIndex(INTERVAL_OPTIONS, settings.monitorIntervalMs)}
          onChanged={(index: number) =>
            update({ monitorIntervalMs: INTERVAL_OPTIONS[index] ?? 500 })
          }
        >
          {INTERVAL_OPTIONS.map((value, index) => (
            <Text key={value} tag={index}>
              {value} ms
            </Text>
          ))}
        </Picker>
        <Picker
          title="最多保留"
          pickerStyle="menu"
          value={optionIndex(MAX_ITEM_OPTIONS, settings.maxItems)}
          onChanged={(index: number) =>
            update({ maxItems: MAX_ITEM_OPTIONS[index] ?? 800 })
          }
        >
          {MAX_ITEM_OPTIONS.map((value, index) => (
            <Text key={value} tag={index}>
              {value} 条
            </Text>
          ))}
        </Picker>
        <Picker
          title="键盘保留条数"
          pickerStyle="menu"
          value={optionIndex(
            KEYBOARD_MAX_ITEM_OPTIONS,
            settings.keyboardMaxItems,
          )}
          onChanged={(index: number) =>
            update({ keyboardMaxItems: KEYBOARD_MAX_ITEM_OPTIONS[index] ?? 30 })
          }
        >
          {KEYBOARD_MAX_ITEM_OPTIONS.map((value, index) => (
            <Text key={value} tag={index}>
              {value > 0 ? `${value} 条` : "无限"}
            </Text>
          ))}
        </Picker>
      </Section>

      <Section header={<Text>界面显示</Text>}>
        <Picker
          title="默认进入页面"
          pickerStyle="menu"
          value={appStartPageIndex(settings.defaultStartPage)}
          onChanged={(index: number) =>
            update({ defaultStartPage: APP_START_PAGE_OPTIONS[index]?.value ?? "network" })
          }
        >
          {APP_START_PAGE_OPTIONS.map((option, index) => (
            <Text key={option.value} tag={index}>{option.title}</Text>
          ))}
        </Picker>
        <Stepper
          onIncrement={() =>
            update({
              appContentLineLimit: Math.min(
                APP_CONTENT_LINE_MAX,
                settings.appContentLineLimit + 1,
              ),
            })
          }
          onDecrement={() =>
            update({
              appContentLineLimit: Math.max(
                APP_CONTENT_LINE_MIN,
                settings.appContentLineLimit - 1,
              ),
            })
          }
        >
          <HStack frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <Text>内容显示行数</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">
              {settings.appContentLineLimit} 行
            </Text>
          </HStack>
        </Stepper>
        <Toggle
          value={settings.keyboardShowTitle}
          onChanged={(keyboardShowTitle: boolean) => update({ keyboardShowTitle })}
          toggleStyle="switch"
        >
          <Text>键盘显示标题</Text>
        </Toggle>
        <Toggle
          value={settings.showRemoteFiles}
          onChanged={(showRemoteFiles: boolean) => update({ showRemoteFiles })}
          toggleStyle="switch"
        >
          <Text>远程页面显示文件类型</Text>
        </Toggle>
        <Picker
          title="远程条目显示时间"
          pickerStyle="menu"
          value={settings.remoteTimeDisplay === "createTime" ? 1 : 0}
          onChanged={(index: number) =>
            update({ remoteTimeDisplay: (index === 1 ? "createTime" : "lastModified") as RemoteTimeDisplayMode })
          }
        >
          <Text tag={0}>最后修改时间</Text>
          <Text tag={1}>创建时间</Text>
        </Picker>
        <Toggle
          value={settings.showRimeKeyboardSwitch}
          onChanged={(showRimeKeyboardSwitch: boolean) => update({ showRimeKeyboardSwitch })}
          toggleStyle="switch"
        >
          <Text>显示 Rime 键盘切换按钮</Text>
        </Toggle>
        <Toggle
          value={settings.passwordVaultEnabled ?? false}
          onChanged={(passwordVaultEnabled: boolean) => update({ passwordVaultEnabled })}
          toggleStyle="switch"
        >
          <Text>密码库</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">
            开启后键盘收藏标签页将显示密码库
          </Text>
        </Toggle>
      </Section>

      <Section header={<Text>Memos</Text>} footer={<Text>子字段分隔符按单个字符识别。默认 :：；，输入多个字符时每个字符都可作为分隔符。</Text>}>
        <TextField
          title="子字段分隔符"
          value={settings.memoSubfieldSeparators}
          prompt=":：；"
          onChanged={(memoSubfieldSeparators: string) => update({ memoSubfieldSeparators })}
        />
      </Section>

      <Section header={<Text>反馈</Text>}>
        <Toggle
          value={settings.inputClicks}
          onChanged={(inputClicks: boolean) =>
            update({
              inputClicks,
              hapticEngineClicks: inputClicks ? false : settings.hapticEngineClicks,
            })}
          toggleStyle="switch"
        >
          <Text>系统按键音</Text>
        </Toggle>
        <Toggle
          value={settings.hapticEngineClicks}
          onChanged={(hapticEngineClicks: boolean) =>
            update({
              hapticEngineClicks,
              inputClicks: hapticEngineClicks ? false : settings.inputClicks,
            })}
          toggleStyle="switch"
        >
          <Text>Core Haptics 按键音</Text>
        </Toggle>
      </Section>

      <Section header={<Text>长按菜单</Text>}>
        <ForEach
          count={getOrderedBuiltinActions().length}
          itemBuilder={(index) => {
            const action = getOrderedBuiltinActions()[index];
            return action ? (
              <Toggle
                key={action.key}
                value={settings.keyboardMenu.builtins[action.key]}
                onChanged={(value: boolean) => updateBuiltin(action.key, value)}
                toggleStyle="switch"
              >
                <Text>{action.title}</Text>
              </Toggle>
            ) : (
              (null as any)
            );
          }}
          onMove={reorderBuiltins}
        />
      </Section>

      <Section header={<Text>自定义长按功能</Text>}>
        {settings.keyboardMenu.customActions.length ? (
          <ForEach
            count={settings.keyboardMenu.customActions.length}
            itemBuilder={(index) => {
              const action = settings.keyboardMenu.customActions[index];
              return action ? (
                <HStack
                  key={action.id}
                  frame={{ maxWidth: "infinity", alignment: "leading" as any }}
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button
                        title=""
                        systemImage="square.and.pencil"
                        tint="systemOrange"
                        action={() => void presentCustomActionEditor(action)}
                      />,
                      <Button
                        title=""
                        systemImage="trash"
                        role="destructive"
                        tint="systemRed"
                        action={() => removeCustomAction(action.id)}
                      />,
                    ],
                  }}
                >
                  <Text
                    frame={{
                      maxWidth: "infinity",
                      alignment: "leading" as any,
                    }}
                  >
                    {action.title}
                  </Text>
                  <Spacer />
                  <Toggle
                    title=""
                    value={action.enabled}
                    onChanged={(enabled: boolean) =>
                      updateCustomAction(action.id, { enabled })
                    }
                    toggleStyle="switch"
                  />
                </HStack>
              ) : (
                (null as any)
              );
            }}
            onMove={reorderCustomActions}
          />
        ) : (
          <Text foregroundStyle="secondaryLabel">点击右上角添加自定义功能</Text>
        )}
      </Section>
    </Form>
  );
}
