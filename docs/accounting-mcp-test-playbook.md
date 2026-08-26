# Accounting MCP 测试手册

## 文档目的

这份文档是当前 `accounting-mcp` 的实际测试说明，尽量不用技术黑话，方便你直接在 LibreChat 里发消息验证。

这份文档会告诉你：

- 每个场景可以直接说什么
- 模型大概率会调用哪个 MCP 接口
- 你应该去哪里看结果
- 哪些数据会自动同步到 Google Sheets

## 当前支持范围

当前这版主要支持这些能力：

- 员工报销录入
- 账务任务创建
- 原始材料保存
- 结构化账务记录
- 对账关联
- 待处理问题
- 保存查询视图
- 查询结果同步到 Google Sheets
- 同一个 workspace 共享一张 Google Sheet 给多人协作
- 直接读取 shared Google Sheet 的原始 worksheet 单元格
- 覆盖编辑或追加 shared Google Sheet 的指定单元格范围
- Accounting Record 新增和修正后自动同步到 `Accounting Records`
- Google Drive 文件夹创建、文件上传、文件移动

## 新增协作测试主线

如果你现在重点要验证“会计 A 创建共享表，客户 B 用自己的 OAuth 把材料写进同一张表”，建议优先走下面这条主线。

### 步骤 1：A 创建 workspace 共享表

先用 A 的账号在聊天里发送：

```text
请为 workspace acme-cn-2026-07 创建一张共享 Google Sheet，用来收集这个月结项目的所有材料和查询结果。
```

预期：

- 会调用 `create_shared_google_sheet`
- 返回 `workspaceId`、`spreadsheetId`、`spreadsheetUrl`
- 新表默认只有 `Accounting Records` 和 `Source Materials` 两个 tab，不应出现 `Expenses`

### 步骤 2：A 把表共享给 B

继续发送：

```text
把这张 workspace 表共享给 client-b@example.com，可编辑。
```

预期：

- 会调用 `share_shared_google_sheet`
- 返回最新成员列表

### 步骤 3：A 创建账务任务

发送：

```text
请在 workspace acme-cn-2026-07 下创建 ACME 中国 2026 年 7 月月结任务。
```

预期：

- 会调用 `upsert_accounting_case`
- 返回 case id

### 步骤 4：B 用自己的账号上传或保存材料

然后切换到 B 的 OAuth 账号，在聊天里发送：

```text
把这张发票保存到 workspace acme-cn-2026-07 刚才那个月结任务里。
```

预期：

- 会调用 `ingest_source_material`
- 如果这个 case 属于 `acme-cn-2026-07`，材料会自动写入共享表的 `Source Materials` 页签

### 步骤 5：B 查询并同步结果

继续发送：

```text
帮我查看这个 workspace 下的账务记录，并同步到 Google Sheets。
```

预期：

- 会调用 `search_accounting_records`
- 由于带着 `workspaceId`，结果会优先同步到共享 Google Sheet，而不是 B 自己的个人 sheet

如果这 5 步都通了，说明这条共享协作链路已经成立。

### 步骤 6：直接查看共享表里还没结构化的原始材料

如果你想验证“Agent 不查结构化记录，直接查 shared sheet 原始单元格”，可以继续发送：

```text
请列出这个 shared Google Sheet 里有哪些 worksheet tab，然后读取 Source Materials 这个页签前 20 行给我看。
```

预期：

- 先调用 `list_shared_google_sheet_tabs`
- 再调用 `read_shared_google_sheet_cells`
- 能直接读到共享表中的原始材料单元格，即使这些材料还没转成结构化记录


## 最短测试路线

如果你现在只想快速确认“整条链路通了”，按下面 5 步就够了。

### 步骤 1：先测最基础报销

在 LibreChat 里发送：

```text
徐毅正 2026-07-10 打车报销 12 元
```

预期：

- 会调用 `add_expense`
- 聊天里返回一条报销记录和记录 id
- Google Sheets 的 `Expenses` 页签里新增一行

### 步骤 2：创建一个月结任务

发送：

```text
我们现在开始处理 ACME 中国 2026 年 7 月的月结，请先帮我建一个账务任务。
```

预期：

- 会调用 `upsert_accounting_case`
- 聊天里返回一个 case id

### 步骤 3：保存两条原始材料

先发一条发票：

```text
这是一张供应商发票：2026 年 7 月 8 日，ABC 餐厅开了一张 230 元的餐饮发票，发票号是 INV-2026-001。请帮我保存到刚才那个月结任务里。
```

再发一条银行流水：

```text
这是一条银行流水：2026 年 7 月 9 日，银行支出 230 元，收款方是 ABC Restaurant。请帮我保存到当前任务。
```

预期：

- 会调用 `ingest_source_material`
- 每条材料都会返回一个 material id

### 步骤 4：把材料整理成账务记录并做对账

先发：

```text
请把刚才那张 ABC 餐厅发票整理成一条供应商账单记录。
```

再发：

```text
请把刚才那条银行流水整理成一条银行记录。
```

最后发：

```text
请把刚才的供应商账单和银行付款记录对应起来，标记为已匹配。
```

预期：

- 前两条会调用 `upsert_accounting_record`
- 每条新增记录会自动登记到共享表 `Accounting Records`
- 最后一条会调用 `upsert_reconciliation_link`

然后把第一条记录金额或描述改掉，再发送：

```text
请读取共享表 Accounting Records 的 A1:V10，确认刚才的更正已经显示在对应 record_id 那一行。
```

预期：

- 修正仍调用 `upsert_accounting_record`，不会在 Sheet 重复新增同一个 `record_id`
- 随后调用 `read_google_sheet_cells` 读回真实单元格
- 对应行已更新，且工具回执中的 `sheetSync.ok` 为 `true`

### 步骤 4.1：验证指定单元格写入和读回

发送：

```text
请在这张共享表新建或使用 Notes tab，把 A1:B2 更新为两行：第一行是 field、value，第二行是 status、verified。然后直接读回 A1:B2 给我确认。
```

预期：

- 调用 `write_google_sheet_cells`，使用 `mode=update`
- 调用 `read_google_sheet_cells` 读回
- 返回的二维 values 与写入内容完全一致

### 步骤 5：查结果并同步到 Google Sheets

发送：

```text
帮我看看当前这个月结任务里现在有哪些记录，并同步到 Google Sheets。
```

预期：

- 会调用 `search_accounting_records`
- 聊天里会提示同步成功
- 你的个人 Google Sheets 文件里会新增一个 worksheet，比如 `ACME中国2026-07月结`

如果这 5 步都通了，说明：

- LibreChat 页面添加 MCP 正常
- Google OAuth 正常
- MCP 服务正常
- 数据库存储正常
- Google Sheets 同步正常

## 建议测试顺序

推荐按这个顺序测：

1. 员工报销
2. 创建共享 Google Sheet
3. 共享给第二个用户
4. 月结任务
5. 原始材料
6. 账务记录
7. 对账
8. 待处理问题
9. 查询和 worksheet 同步
10. 保存视图

---

## 场景 1：员工报销

### 话术 1

```text
徐毅正 2026-07-10 打车报销 12 元
```

预期接口：

- `add_expense`

验证点：

- 聊天里返回已保存的报销记录和 id
- Google Sheets 的 `Expenses` 页签新增一行

### 话术 2

```text
徐毅正 2026-07-10 午餐报销 48 元
```

预期接口：

- `add_expense`

### 话术 3

```text
帮我看看徐毅正现在一共报销了多少钱。
```

预期接口：

- `query_expense_summary`

### 话术 4

```text
把徐毅正的报销记录都列出来给我看。
```

预期接口：

- `list_expenses`

### 话术 5

```text
刚才徐毅正那条 48 元的午餐报销写错了，帮我撤销掉。
```

预期接口：

- `cancel_expense`

验证点：

- 记录状态变成已撤销
- 对应的表格行也会更新

---

## 场景 2：创建月结任务

这在系统里对应 `AccountingCase`，但测试时完全不用说这个词。

### 话术

```text
我们现在开始处理 ACME 中国 2026 年 7 月的月结，请先帮我建一个账务任务。
```

预期接口：

- `upsert_accounting_case`

验证点：

- 聊天里返回一个 case id
- 状态一般会是 `active` 或模型判断出的其他任务状态

可选追问：

```text
请告诉我刚才这个账务任务的编号。
```

---

## 场景 3：保存原始材料

这在系统里对应 `SourceMaterial`。

### 供应商发票

```text
这是一张供应商发票：2026 年 7 月 8 日，ABC 餐厅开了一张 230 元的餐饮发票，发票号是 INV-2026-001。请帮我保存到刚才那个月结任务里。
```

预期接口：

- `ingest_source_material`

### 银行流水

```text
这是一条银行流水：2026 年 7 月 9 日，银行支出 230 元，收款方是 ABC Restaurant。请帮我保存到当前任务。
```

预期接口：

- `ingest_source_material`

### 付款截图信息

```text
这是一张付款截图的信息：2026 年 7 月 9 日支付给 ABC Restaurant 230 元。请保存到当前任务。
```

预期接口：

- `ingest_source_material`

### 审批信息

```text
这是一条审批信息：李经理已经同意这笔客户招待费。请保存到当前任务。
```

预期接口：

- `ingest_source_material`

验证点：

- 每条材料都会返回 material id
- 每条材料都挂在当前月结任务下面

---

## 场景 4：整理结构化账务记录

这在系统里对应 `AccountingRecord`。

### 供应商账单

```text
请把刚才那张 ABC 餐厅发票整理成一条供应商账单记录。
```

预期接口：

- `upsert_accounting_record`

预期记录类型：

- `vendor_bill`

### 银行记录

```text
请把刚才那条银行流水整理成一条银行记录。
```

预期接口：

- `upsert_accounting_record`

预期记录类型：

- `bank_transaction`

### 客户发票

```text
请帮我登记一条客户发票：2026 年 7 月我们给 Client A 开了 5000 元服务费发票。
```

预期接口：

- `upsert_accounting_record`

预期记录类型：

- `customer_invoice`

## 场景 5：对账

这在系统里对应 `ReconciliationLink`。

### 正常匹配

```text
请把刚才的供应商账单和银行付款记录对应起来，标记为已匹配。
```

预期接口：

- `upsert_reconciliation_link`

### 客户发票和回款对应

```text
请把 Client A 的客户发票和刚才那笔 5000 元回款对应起来。
```

预期接口：

- `upsert_reconciliation_link`

## 场景 6：查询账务记录

### 通用查询

```text
帮我看看当前这个月结任务里现在有哪些账单和流水。
```

预期接口：

- `search_accounting_records`

### 查供应商账单

```text
把当前任务里的所有供应商账单列出来。
```

预期接口：

- `search_accounting_records`

### 查客户发票

```text
把当前任务里的所有客户发票列出来。
```

预期接口：

- `search_accounting_records`

### 查银行流水

```text
把当前任务里的所有银行流水列出来。
```

预期接口：

- `search_accounting_records`

### 查询并同步到表格

```text
帮我看看当前这个月结任务里现在有哪些记录，并同步到 Google Sheets。
```

预期接口：

- `search_accounting_records`

预期结果：

- 返回里会提示 worksheet 同步成功
- 你的个人 Google Sheets 文件里会新增一个 worksheet，例如 `ACME中国2026-07月结`

---

## 场景 7：保存视图

### 保存一个常用查询

```text
把当前任务里的供应商账单查询保存下来，名字叫 7月供应商账单。
```

预期接口：

- `search_accounting_records`

预期行为：

- 模型会通过 `saveViewName` 把这次查询存起来

### 列出保存过的视图

```text
把我保存过的查询视图列出来。
```

预期接口：

- `list_saved_views`

### 运行保存视图

```text
运行一下我保存的 7月供应商账单 视图。
```

预期接口：

- `run_saved_view`

### 运行并同步到表格

```text
运行一下我保存的 7月供应商账单 视图，并同步到 Google Sheets。
```

预期接口：

- `run_saved_view`

### 删除保存视图

```text
把 7月供应商账单 这个保存视图删掉。
```

预期接口：

- `delete_saved_view`

---

## MCP 接口列表与作用

下面是当前这版 `accounting-mcp` 里你最关心的接口。

### 报销相关

- `add_expense`
  作用：新增一条员工报销记录，并同步到 `Expenses` 表

- `list_expenses`
  作用：列出报销明细

- `cancel_expense`
  作用：撤销一条报销记录，并更新表格状态

- `query_expense_summary`
  作用：统计某个人或某段范围内的报销总额

- `get_accounting_usage_guide`
  作用：返回系统使用说明

### 月结与账务流程相关

- `upsert_accounting_case`
  作用：创建或更新一个账务任务，比如某个客户某个月的月结

- `ingest_source_material`
  作用：保存原始材料，比如发票、流水、付款截图、审批信息

- `upsert_accounting_record`
  作用：把原始材料整理成结构化账务记录，比如供应商账单、银行流水、客户发票

- `search_accounting_records`
  作用：按条件查询账务记录，并可选同步查询结果到 Google Sheets

- `upsert_reconciliation_link`
  作用：把两条记录建立对账关系，比如“这张发票对应这笔付款”

- `list_reconciliation_links`
  作用：查看已经建立的对账关联

- `upsert_review_item`
  作用：创建或更新待处理问题，比如缺审批、金额不一致、疑似重复

- `list_review_items`
  作用：列出当前任务下所有待处理问题，并可选同步到 Google Sheets

- `list_saved_views`
  作用：列出保存过的查询视图

- `run_saved_view`
  作用：运行一个保存好的查询视图，并可选同步到 Google Sheets

- `delete_saved_view`
  作用：删除一个保存的查询视图

---

## 业务对象和接口怎么对应

- 账务任务：`upsert_accounting_case`
- 原始材料：`ingest_source_material`
- 结构化记录：`upsert_accounting_record`
- 对账关系：`upsert_reconciliation_link`
- 待处理问题：`upsert_review_item`
- 记录查询：`search_accounting_records`
- 问题查询：`list_review_items`
- 保存视图：`list_saved_views` / `run_saved_view` / `delete_saved_view`
