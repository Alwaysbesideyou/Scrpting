# SyncClipboard API 文档

本文根据 Swagger UI / OpenAPI 定义整理：

- Swagger UI：`http://192.168.123.88:5033/swagger/index.html`
- OpenAPI JSON：`http://192.168.123.88:5033/swagger/v1/swagger.json`
- OpenAPI 版本：`3.0.4`
- API 标题：`SyncClipboard`
- API 版本：`1.0`

> 说明：Swagger 文档中所有接口均归属于 `SyncClipboard` tag。文档没有声明全局认证方案；如果服务端实际启用了 Basic Auth，请在请求中额外携带 `Authorization: Basic ...`。

> **如何访问 Swagger UI**：在独立服务器运行环境下，设定环境变量 `ASPNETCORE_ENVIRONMENT` 为 `Development` 后运行服务器；桌面客户端则打开服务器并在设置里开启诊断模式，然后访问 `http://{ip}:{port}/swagger/index.html`。

---

## API 架构概述

SyncClipboard API 分为两类：

| 类别 | 路径特征 | 用途 |
|---|---|---|
| **历史记录 API** | 以 `/api/` 起始 | 历史记录 CRUD、统计、版本查询 |
| **当前剪切板 API** | `/SyncClipboard.json`、`/file/{dataName}` | 获取/上传当前剪贴板 Profile 和附带数据 |

关键当前剪切板 API：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/SyncClipboard.json` | 获取当前剪贴板 |
| `PUT` | `/SyncClipboard.json` | 上传/更新当前剪贴板 |
| `GET` | `/file/{dataName}` | 下载剪贴板附带数据（可选） |
| `PUT` | `/file/{dataName}` | 上传剪贴板附带数据（可选） |

---

## 1. 接口总览

| 方法 | 路径 | 请求体 | 成功响应 | 说明 |
|---|---|---|---|---|
| `GET` | `/api/history/{profileId}` | 无 | `HistoryRecordDto` | 获取指定历史记录元数据 |
| `GET` | `/api/history/{profileId}/data` | 无 | 文件/二进制数据 | 获取指定历史记录附带数据 |
| `POST` | `/api/history/query` | `multipart/form-data` | `HistoryRecordDto[]` | 查询历史记录列表 |
| `POST` | `/api/history` | `multipart/form-data` | `200 OK` | 新增/上传历史记录 |
| `PATCH` | `/api/history/{type}/{hash}` | JSON | `200 OK` | 更新历史记录状态 |
| `GET` | `/api/history/statistics` | 无 | `HistoryStatisticsDto` | 获取历史统计信息 |
| `DELETE` | `/api/history/clear` | 无 | `200 OK` | 清空历史记录 |
| `GET` | `/api/time` | 无 | `date-time` | 获取服务器时间 |
| `GET` | `/api/version` | 无 | `200 OK` | 获取服务端版本信息 |
| `DELETE` | `/file` | 无 | `200 OK` | 删除/清理文件资源 |
| `HEAD` | `/file/{fileName}` | 无 | `200 OK` | 检查文件是否存在或读取文件元信息 |
| `GET` | `/file/{fileName}` | 无 | 文件内容 | 下载指定文件 |
| `PUT` | `/file/{fileName}` | 未在 Swagger 中声明 | `200 OK` | 上传或覆盖指定文件 |
| `GET` | `/SyncClipboard.json` | 无 | `ProfileDto` | 获取当前剪切板 Profile |
| `PUT` | `/SyncClipboard.json` | `ProfileDto` JSON | `200 OK` | 更新当前剪切板 Profile |

## 2. 数据模型

### 2.1 `HistoryRecordDto`

历史记录对象。

```ts
type HistoryRecordDto = {
  hash?: string | null
  text?: string | null
  type?: ProfileType
  createTime?: string // date-time
  lastModified?: string // date-time
  lastAccessed?: string // date-time
  starred?: boolean
  pinned?: boolean
  size?: number // int64
  hasData?: boolean
  version?: number // int32
  isDeleted?: boolean
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `hash` | `string \| null` | 内容哈希 |
| `text` | `string \| null` | 文本内容或摘要 |
| `type` | `ProfileType` | 记录类型 |
| `createTime` | `string(date-time)` | 创建时间 |
| `lastModified` | `string(date-time)` | 最后修改时间 |
| `lastAccessed` | `string(date-time)` | 最后访问时间 |
| `starred` | `boolean` | 是否星标 |
| `pinned` | `boolean` | 是否置顶 |
| `size` | `integer(int64)` | 数据大小 |
| `hasData` | `boolean` | 是否有附带数据 |
| `version` | `integer(int32)` | 版本号 |
| `isDeleted` | `boolean` | 是否已删除 |

### 2.2 `HistoryRecordUpdateDto`

用于 PATCH 更新历史记录。

```ts
type HistoryRecordUpdateDto = {
  starred?: boolean | null
  pinned?: boolean | null
  isDelete?: boolean | null
  version?: number | null // int32
  lastModified?: string | null // date-time
  lastAccessed?: string | null // date-time
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `starred` | `boolean \| null` | 是否星标 |
| `pinned` | `boolean \| null` | 是否置顶 |
| `isDelete` | `boolean \| null` | 是否删除；注意字段名是 `isDelete`，不是 `isDeleted` |
| `version` | `integer(int32) \| null` | 版本号 |
| `lastModified` | `string(date-time) \| null` | 最后修改时间 |
| `lastAccessed` | `string(date-time) \| null` | 最后访问时间 |

### 2.3 `HistoryStatisticsDto`

历史统计信息。

```ts
type HistoryStatisticsDto = {
  activeCount?: number // int32
  starredCount?: number // int32
  deletedCount?: number // int32
  totalCount?: number // int32
  totalFileSizeMB?: number // double
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `activeCount` | `integer(int32)` | 活跃记录数量 |
| `starredCount` | `integer(int32)` | 星标记录数量 |
| `deletedCount` | `integer(int32)` | 已删除记录数量 |
| `totalCount` | `integer(int32)` | 总记录数量 |
| `totalFileSizeMB` | `number(double)` | 总文件大小，单位 MB |

### 2.4 `ProfileDto`

当前剪切板 Profile 对象。所有字段**大小写敏感**。

```ts
type ProfileDto = {
  type: ProfileType              // required
  hash?: string | null           // optional, empty string treated as null
  text: string                   // required
  hasData: boolean               // required
  dataName?: string | null       // required when hasData=true
  size?: number                  // optional, int64
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | `ProfileType` | **是** | 剪切板内容类型：`Text` / `Image` / `File` / `Group` |
| `hash` | `string \| null` | 否 | 内容唯一标识，空字符串视为 null。计算方法见 [Hash.md](Hash.md) |
| `text` | `string` | **是** | 剪切板预览字符串；对于 Text 类型，可存储完整内容或其起始部分 |
| `hasData` | `boolean` | **是** | 是否使用额外文件存储完整剪贴板信息 |
| `dataName` | `string \| null` | 条件必填 | 当 `hasData=true` 时必填，附带数据的文件名 |
| `size` | `integer(int64)` | 否 | 仅用于展示：文件类型为总字节数，Text 类型为完整字符串长度 |

#### 字段行为语义

**`text` 与 `hasData` 的关系：**

| 类型 | `hasData` | `text` 含义 | 完整数据位置 |
|---|---|---|---|
| `Text` | `false` | 完整文本内容 | `text` 字段 |
| `Text` | `true` | 文本起始部分（预览） | `/file/{dataName}`（UTF-8 编码的 .txt 文件） |
| `Image` | **恒为 `true`** | 预览/描述字符串 | `/file/{dataName}` |
| `File` | **恒为 `true`** | 预览/描述字符串 | `/file/{dataName}` |
| `Group` | **恒为 `true`** | 预览/描述字符串 | `/file/{dataName}` |

对于 Text 类型，可根据原字符串长度选择是否用额外 .txt 文件存储完整 UTF-8 编码内容。使用额外文件时，`text` 仅存储起始部分作为预览。

**`hash` 的约定：**

- 发送方应尽量提供 hash 信息
- 当 hash 存在时，接收方应验证 hash 与剪贴板内容的一致性，不一致时应执行错误处理
- 当 hash 为空或无法计算 hash 时，可使用 `type` + `text` 的组合简单判断剪贴板内容相等性
- hash 计算方法详见 [Hash.md](Hash.md)

**`size` 的语义：**

- 文件类型（Image / File / Group）：复制文件的总字节大小
- Text 类型：完整字符串的长度（字符数）
- 仅用于 UI 展示，不参与内容相等性判断

### 2.5 `ProfileType`

```ts
type ProfileType = 'Text' | 'File' | 'Image' | 'Group' | 'Unknown' | 'None'
```

可选值：

- `Text`
- `File`
- `Image`
- `Group`
- `Unknown`
- `None`

### 2.6 `ProfileTypeFilter`

用于历史查询的类型过滤。

```ts
type ProfileTypeFilter = 'None' | 'Text' | 'File' | 'Image' | 'Group' | 'FileAndGroup' | 'All'
```

可选值：

- `None`
- `Text`
- `File`
- `Image`
- `Group`
- `FileAndGroup`
- `All`

## 3. 接口详情

### 3.1 获取指定历史记录元数据

```http
GET /api/history/{profileId}
```

路径参数：

| 参数 | 位置 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `profileId` | path | 是 | `string` | 历史记录标识，常见格式为 `Type-Hash` |

成功响应：`200 OK`

响应内容类型：

- `text/plain`
- `application/json`
- `text/json`

响应体：`HistoryRecordDto`

示例：

```bash
curl http://192.168.123.88:5033/api/history/Text-ABCDEF123456
```

### 3.2 获取指定历史记录附带数据

```http
GET /api/history/{profileId}/data
```

路径参数：

| 参数 | 位置 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `profileId` | path | 是 | `string` | 历史记录标识，常见格式为 `Type-Hash` |

成功响应：`200 OK`

Swagger 未声明具体响应体 Schema，通常用于返回文件流或二进制数据。

示例：

```bash
curl -o data.bin http://192.168.123.88:5033/api/history/Image-ABCDEF123456/data
```

### 3.3 查询历史记录列表

```http
POST /api/history/query
Content-Type: multipart/form-data
```

请求体：`multipart/form-data`

| 字段 | 类型 | 格式/枚举 | 必填 | 说明 |
|---|---|---|---|---|
| `page` | `integer` | `int32` | 否 | 页码 |
| `before` | `string` | `date-time` | 否 | 查询早于该时间的记录 |
| `after` | `string` | `date-time` | 否 | 查询晚于该时间的记录 |
| `modifiedAfter` | `string` | `date-time` | 否 | 查询在该时间后修改的记录 |
| `types` | `ProfileTypeFilter` | 枚举 | 否 | 类型过滤 |
| `searchText` | `string` | - | 否 | 搜索文本 |
| `starred` | `boolean` | - | 否 | 是否仅查询星标/非星标记录 |
| `sortByLastAccessed` | `boolean` | - | 否 | 是否按最后访问时间排序 |

> Swagger 的 `schema.properties` 使用小驼峰字段名（如 `page`），`encoding` 中列出了 PascalCase 名称（如 `Page`）。实际调用时若遇到绑定问题，可尝试使用 PascalCase 表单字段名。

成功响应：`200 OK`

响应内容类型：

- `text/plain`
- `application/json`
- `text/json`

响应体：`HistoryRecordDto[]`

示例：

```bash
curl -X POST http://192.168.123.88:5033/api/history/query \
  -F page=1 \
  -F types=All \
  -F sortByLastAccessed=false
```

### 3.4 新增/上传历史记录

```http
POST /api/history
Content-Type: multipart/form-data
```

请求体：`multipart/form-data`

必填字段：

- `hash`
- `type`

字段列表：

| 字段 | 类型 | 格式/枚举 | 必填 | 说明 |
|---|---|---|---|---|
| `hash` | `string` | - | 是 | 内容哈希 |
| `type` | `ProfileType` | 枚举 | 是 | 记录类型 |
| `createTime` | `string` | `date-time` | 否 | 创建时间 |
| `lastModified` | `string` | `date-time` | 否 | 最后修改时间 |
| `lastAccessed` | `string` | `date-time` | 否 | 最后访问时间 |
| `starred` | `boolean` | - | 否 | 是否星标 |
| `pinned` | `boolean` | - | 否 | 是否置顶 |
| `version` | `integer` | `int32` | 否 | 版本号 |
| `isDeleted` | `boolean` | - | 否 | 是否已删除 |
| `text` | `string` | - | 否 | 文本内容或摘要 |
| `size` | `integer` | `int64` | 否 | 数据大小 |
| `data` | `string` | `binary` | 否 | 附带数据流；必须是 multipart/form-data 的最后一个 part |

成功响应：`200 OK`

Swagger 未声明响应体 Schema。

示例：

```bash
curl -X POST http://192.168.123.88:5033/api/history \
  -F hash=ABCDEF123456 \
  -F type=Text \
  -F createTime=2026-05-24T09:00:00Z \
  -F lastModified=2026-05-24T09:00:00Z \
  -F lastAccessed=2026-05-24T09:00:00Z \
  -F starred=false \
  -F pinned=false \
  -F version=1 \
  -F isDeleted=false \
  -F text='hello world' \
  -F size=11
```

带附带数据时，将 `data` 放在最后：

```bash
curl -X POST http://192.168.123.88:5033/api/history \
  -F hash=ABCDEF123456 \
  -F type=Image \
  -F createTime=2026-05-24T09:00:00Z \
  -F lastModified=2026-05-24T09:00:00Z \
  -F lastAccessed=2026-05-24T09:00:00Z \
  -F starred=false \
  -F pinned=false \
  -F version=1 \
  -F isDeleted=false \
  -F text='' \
  -F size=12345 \
  -F data=@image.png
```

### 3.5 更新历史记录状态

```http
PATCH /api/history/{type}/{hash}
Content-Type: application/json
```

路径参数：

| 参数 | 位置 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `type` | path | 是 | `ProfileType` | 记录类型 |
| `hash` | path | 是 | `string` | 内容哈希 |

请求体内容类型：

- `application/json`
- `text/json`
- `application/*+json`

请求体：`HistoryRecordUpdateDto`

```json
{
  "starred": true,
  "pinned": false,
  "isDelete": false,
  "version": 2,
  "lastModified": "2026-05-24T09:30:00Z",
  "lastAccessed": "2026-05-24T09:30:00Z"
}
```

成功响应：`200 OK`

示例：

```bash
curl -X PATCH http://192.168.123.88:5033/api/history/Text/ABCDEF123456 \
  -H 'Content-Type: application/json' \
  -d '{"starred":true,"version":2,"lastModified":"2026-05-24T09:30:00Z"}'
```

### 3.6 获取历史统计信息

```http
GET /api/history/statistics
```

成功响应：`200 OK`

响应内容类型：

- `text/plain`
- `application/json`
- `text/json`

响应体：`HistoryStatisticsDto`

示例：

```bash
curl http://192.168.123.88:5033/api/history/statistics
```

### 3.7 清空历史记录

```http
DELETE /api/history/clear
```

成功响应：`200 OK`

Swagger 未声明响应体 Schema。

示例：

```bash
curl -X DELETE http://192.168.123.88:5033/api/history/clear
```

### 3.8 获取服务器时间

```http
GET /api/time
```

成功响应：`200 OK`

响应内容类型：

- `text/plain`
- `application/json`
- `text/json`

响应体：`string(date-time)`

示例：

```bash
curl http://192.168.123.88:5033/api/time
```

### 3.9 获取服务端版本信息

```http
GET /api/version
```

成功响应：`200 OK`

Swagger 未声明响应体 Schema。

示例：

```bash
curl http://192.168.123.88:5033/api/version
```

### 3.10 删除/清理文件资源

```http
DELETE /file
```

成功响应：`200 OK`

Swagger 未声明请求体和响应体 Schema。

示例：

```bash
curl -X DELETE http://192.168.123.88:5033/file
```

### 3.11 检查指定文件

```http
HEAD /file/{fileName}
```

路径参数：

| 参数 | 位置 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `fileName` | path | 是 | `string` | 文件名 |

成功响应：`200 OK`

示例：

```bash
curl -I http://192.168.123.88:5033/file/example.png
```

### 3.12 下载指定文件

```http
GET /file/{fileName}
```

路径参数：

| 参数 | 位置 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `fileName` | path | 是 | `string` | 文件名 |

成功响应：`200 OK`

Swagger 未声明响应体 Schema，通常用于返回文件内容。

示例：

```bash
curl -O http://192.168.123.88:5033/file/example.png
```

### 3.13 上传或覆盖指定文件

```http
PUT /file/{fileName}
```

路径参数：

| 参数 | 位置 | 必填 | 类型 | 说明 |
|---|---|---|---|---|
| `fileName` | path | 是 | `string` | 文件名 |

成功响应：`200 OK`

Swagger 未声明请求体 Schema。实际调用时通常需要按服务端实现上传文件内容。

示例：

```bash
curl -X PUT --data-binary @example.png http://192.168.123.88:5033/file/example.png
```

### 3.14 获取当前剪切板 Profile

```http
GET /SyncClipboard.json
```


成功响应：`200 OK`

响应内容类型：

- `text/plain`
- `application/json`
- `text/json`

响应体：`ProfileDto`

示例：

```bash
curl http://192.168.123.88:5033/SyncClipboard.json
```

### 3.15 更新当前剪切板 Profile

```http
PUT /SyncClipboard.json
Content-Type: application/json
```

请求体 `ProfileDto` 各字段的行为语义详见 [2.4 ProfileDto](#24-profiledto)。

请求体内容类型：

- `application/json`
- `text/json`
- `application/*+json`

请求体：`ProfileDto`

```json
{
  "type": "Text",
  "hash": "ABCDEF123456",
  "text": "hello world",
  "hasData": false,
  "dataName": null,
  "size": 11
}
```

成功响应：`200 OK`

示例：

```bash
curl -X PUT http://192.168.123.88:5033/SyncClipboard.json \
  -H 'Content-Type: application/json' \
  -d '{"type":"Text","hash":"ABCDEF123456","text":"hello world","hasData":false,"dataName":null,"size":11}'
```

## 4. Content-Type 与响应格式

Swagger 中明确声明 JSON 响应的接口通常同时支持以下响应内容类型：

- `text/plain`
- `application/json`
- `text/json`

JSON 请求体接口通常支持：

- `application/json`
- `text/json`
- `application/*+json`

表单接口使用：

- `multipart/form-data`

二进制或文件类接口在 Swagger 中没有细化响应体 Schema，调用时应按文件流处理。

## 5. 调用注意事项

1. `POST /api/history` 的 `data` 字段在 Swagger 中说明为：`Transfer data stream. Must be the last part in the multipart/form-data.`，因此上传附带数据时必须把 `data` 文件 part 放到最后。
2. `POST /api/history/query` 的表单字段在 Swagger schema 中为小驼峰，在 encoding 中为 PascalCase；如绑定失败，可尝试 `Page`、`Before`、`After`、`ModifiedAfter`、`Types`、`SearchText`、`Starred`、`SortByLastAccessed`。
3. `PATCH /api/history/{type}/{hash}` 中删除状态字段为 `isDelete`。
4. `ProfileType` 与 `ProfileTypeFilter` 都是字符串枚举，传参时应使用枚举字符串值。
