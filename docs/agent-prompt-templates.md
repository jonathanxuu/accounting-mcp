# Accounting MCP Agent Prompt Templates

这份文档给前端 agent、系统提示词、或联调同学直接复用。

目标很简单：

- 不让 agent 自己猜什么时候该建共享表
- 不让 agent 把二进制文件误走成文本创建
- 不让第二个 OAuth 用户掉回个人 sheet

## 模板 1：共享 workspace 协作总规则

适合放在 system prompt 或 connector usage guide 里。

```text
你正在操作 accounting-mcp。

当用户要在 Google Drive / Google Sheets 中协作处理某个 accounting workspace 时，遵循下面规则：

1. 如果用户提到多人协作、共享、客户也要上传、会计和客户共用同一张表，优先把任务理解为“workspace 共享协作”。
2. 对于 workspace 共享协作，不要直接把数据写到个人 Google Sheet。优先检查或创建该 workspace 的 shared Google Sheet。
3. 如果用户要给某个 workspace 建共享协作表，使用 `create_shared_google_sheet`。
4. 如果用户要求把共享表开放给另一个邮箱，使用 `share_shared_google_sheet`。
5. 如果用户要求查看当前 workspace 的共享表和成员，使用 `get_shared_google_sheet`。
6. 如果用户上传的是 PDF、图片、Office 文件、压缩包、音视频或其他二进制文件，不要使用 `create_google_drive_text_file`，优先使用 `upload_google_drive_file_auto`。
7. 只有在明确是纯文本内容，且目标是 Google Docs 或 text-like 文件时，才使用 `create_google_drive_text_file`。
8. 如果用户要上传原始材料到某个账务任务，优先先保存到 `ingest_source_material`，并确保该任务属于正确的 `workspaceId`。
9. 当 `search_accounting_records`、`list_review_items` 或 `run_saved_view` 需要同步到表格时，如果输入里已有 `workspaceId`，应理解为优先同步到该 workspace 的 shared Google Sheet。
10. 如果共享协作已经建立，不要再建议用户手动去 Google Drive 页面拖拽、复制或重复创建个人表。
```

## 模板 2：A 创建共享表并共享给 B

适合首轮搭建共享协作场景。

```text
请先为 workspace `acme-cn-2026-07` 创建一张 shared Google Sheet。
如果创建成功，再把它共享给 `client-b@example.com`，权限给 editor。
最后告诉我这张 shared sheet 的链接、workspaceId 和当前成员列表。
```

期望工具顺序：

1. `create_shared_google_sheet`
2. `share_shared_google_sheet`
3. `get_shared_google_sheet`

## 模板 3：B 用自己的 OAuth 账号把材料写入同一 workspace

适合第二个用户登录后继续干活。

```text
我现在是客户 B，用我当前登录的 Google OAuth 账号处理 `acme-cn-2026-07` 这个 workspace。
请不要创建我的个人 sheet，也不要把文件转换成 Google Docs。
把我接下来提供的材料按原始材料保存到这个 workspace 对应的账务任务中，并保持写入共享 sheet。
```

期望行为：

1. 复用已有 shared Google Sheet
2. 调用 `ingest_source_material`
3. 自动把记录写进共享 sheet 的 `Source Materials` 页签

## 模板 4：上传二进制文件到 Drive，不做格式转换

适合 PDF、图片、Word、Excel、Zip 等真实文件。

```text
把我上传的附件原样上传到 Google Drive，不要转换成 Google Docs，不要提取成纯文本，也不要新建文本文件。
如果需要你自己选择上传方式，请优先使用最稳妥的自动上传工具。
如果我给了目标文件夹，就上传到那个文件夹里。
```

期望工具：

- `upload_google_drive_file_auto`

不应该优先使用：

- `create_google_drive_text_file`

## 模板 5：查询 workspace 数据并同步到共享 sheet

适合 accountant / client 在共享协作期间查看结果。

```text
请查看 workspace `acme-cn-2026-07` 下当前的账务记录，并同步到共享 Google Sheet。
如果这个 workspace 已有 shared sheet，请同步到 shared sheet，不要同步到个人 sheet。
```

期望工具：

- `search_accounting_records`

关键输入：

- `workspaceId`
- `syncToWorksheet=true`

## 模板 6：查看待处理问题并同步到共享 sheet

```text
请列出 workspace `acme-cn-2026-07` 下所有未解决的 review items，并同步到共享 Google Sheet。
```

期望工具：

- `list_review_items`

关键输入：

- `workspaceId`
- `unresolvedOnly=true`
- `syncToWorksheet=true`

## 模板 7：推荐给前端的最小保护规则

如果前端也能给 agent 额外加一层规则，建议至少加这段：

```text
如果用户上传了真实附件文件，且目标是 Google Drive 原样保存，禁止优先选择文本创建类工具。
如果用户提到同一个 workspace 要给多人协作使用，禁止默认写入个人 Google Sheet；优先检查或创建 shared Google Sheet。
如果工具已经提供自动上传接口，优先使用自动上传接口，而不是让模型自己在小文件和大文件接口之间猜测。
```
