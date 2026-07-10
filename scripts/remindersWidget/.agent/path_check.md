# Off day 相对路径检查

- 当前文件：`/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/remindersWidget/components/store.ts`
-目标文件：`/private/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripts/Off day/utils/is_rest_day.ts`

## 从 store.ts 推导相对路径

`components/store.ts` 所在目录：
- `.../scripts/remindersWidget/components/`

向上两级：
- `..` -> `.../scripts/remindersWidget/`
- `../..` -> `.../scripts/`

再进入：
- `Off day/utils/is_rest_day`

所以相对导入路径应为：
- `../../Off day/utils/is_rest_day`

##结论

当前导入路径本身是对的。若 diagnostics仍报 `Cannot find module`，更像是 TypeScript诊断器对跨项目、带空格目录名的相对导入解析失败，而不是相对路径算错。
