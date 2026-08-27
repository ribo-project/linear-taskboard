# Linear Taskboard 設定與使用指南

本文件說明目前這個 fork 的實際操作方式。

## 1. 核心原則

對 Linear-backed Project 來說：

```text
Linear = 專案與 Issue 的權威資料來源
SQLite = 本機 projection / cache
Taskboard = Codex 工作介面
Codex = 執行工作
Git / GitHub = 程式碼與 PR
```

不要在 Taskboard 建立另一套與 Linear 分離的任務管理流程。

## 2. 啟動 Taskboard

```bash
npm install
npm run build
npm start
```

預設網址：

```text
http://127.0.0.1:47823
```

開發模式：

```bash
npm run dev
```

## 3. 連接 Linear

### 從 UI 連接

1. 打開 Taskboard Project 選單。
2. 選擇 **連接 Linear** 或 **Linear 設定**。
3. 輸入 Linear Personal API Key。
4. 如有需要，填入 Team ID / Project ID 作為同步範圍。
5. 選擇是否只同步目前 Linear 使用者負責的 Issue。
6. 儲存並同步。

API Key 只保存在本機 `linear-connection.json`，不會回傳給前端。

### 使用 CLI

```bash
LINEAR_API_KEY=... npm run linear -- configure
npm run linear -- status
npm run linear -- sync
npm run linear -- clear
```

同步所有符合 Team / Project 範圍的 Issue，而不是只同步分配給自己：

```bash
LINEAR_API_KEY=... npm run linear -- configure --all
```

限制 Team / Project：

```bash
LINEAR_API_KEY=... npm run linear -- configure \
  --team-id <LINEAR_TEAM_ID> \
  --project-id <LINEAR_PROJECT_ID>
```

## 4. Linear Project 與 Codex Workspace 對應

同步完成後，每個 Linear Project 會在 Taskboard 形成一個 Project projection。

第一次要讓 Codex 執行該 Project 時：

1. 在 Codex 開啟正確的 repository / project。
2. 在 Taskboard 選擇對應的 Linear Project。
3. 按 **綁定目前 Codex**。
4. 確認畫面顯示的 project、host 與 workspace path 正確。

Taskboard 會沿用原本的 mapping storage：

```text
codexProjectId
codexProjectKind
codexHostId
workspacePath
```

不會另外建立第二套 mapping DB。

## 5. 讓 Issue 可以被 Codex 執行

自動執行不是看到 Todo 就直接做。

一張 Linear Issue 要進入可執行狀態，至少需要：

1. Linear 狀態為 `Todo`。
2. 在 Taskboard 的 Issue 詳情按 **允許 Codex**。
3. Linear Issue 上出現 `codex-ready` Label。
4. dependency snapshot 完整。
5. 所有 blocker 都已解除。
6. Project 已完成 Codex workspace mapping。
7. 沒有衝突的 active thread binding。

`codex-ready` 是 Linear 真實 Label。

### 取消 Codex 執行權限

在 Issue 詳情按 **取消 Codex**。

Taskboard 會移除 Linear 的 `codex-ready` Label，不會影響 Issue 其他 Labels。

## 6. Claim Eligibility

Taskboard Server 會直接算出 eligibility，Agent 不需要自行猜測。

### 新 Claim

```json
{
  "claimEligibility": {
    "eligible": true,
    "reasons": []
  }
}
```

可能的拒絕原因包含：

```text
MISSING_CODEX_READY
DEPENDENCIES_INCOMPLETE
BLOCKED_BY_DEPENDENCY
ALREADY_BOUND
STATUS_NOT_TODO
ARCHIVED
```

### 已有 Codex Thread 的續跑

已有完整 binding 的 Issue 使用：

```json
{
  "continuationEligibility": {
    "eligible": true,
    "reasons": []
  }
}
```

續跑仍然要通過 dependency 與 `codex-ready` gate。

## 7. Dependency

Linear blocker 是權威來源。

Taskboard 會讀取 Linear native relation，包含跨 Project blocker。

如果 dependency relation 沒有完整抓完，Taskboard 採 fail closed：

```text
dependency snapshot 不完整
→ 不允許 claim
```

而不是假設沒有 blocker。

## 8. Automation 行為

Project Automation 會先判斷：

```text
hasTodo
```

以及：

```text
hasRunnableTodo
```

兩者不同。

例如：

```text
Project 有 5 張 Todo
但全部沒有 codex-ready
```

此時：

```text
hasTodo = true
hasRunnableTodo = false
```

Codex cron 會暫停，但 Project Automation 不會被當成使用者手動關閉。

輕量 policy check 會持續檢查，一旦有任務可以執行就會重新啟動 automation。

## 9. Codex 正常工作流程

```text
Linear Todo
  + codex-ready
  + dependencies clear
        ↓
重新確認 eligibility
        ↓
Linear → In Progress
        ↓
建立 / 繼續 Codex thread
        ↓
開發
        ↓
測試 / 驗證
        ↓
將結果寫入 Linear Comment
        ↓
Linear → In Review
        ↓
人工驗收
        ↓
Done
```

Codex 預設不會自行把 Issue 直接移到 Done。

## 10. Thread Binding

完整 binding 包含：

```text
threadId
codexProjectId
codexProjectKind
codexHostId
workspacePath
```

如果 binding 不完整，或頂層 `threadId` 與 binding 裡的 `threadId` 不一致，automation 會 fail closed。

同一張 Issue 不允許另一個 Codex conversation 直接取代既有 binding。

## 11. 目前可寫回 Linear 的功能

已支援：

- Claim / review 使用的 Status transition
- Comment create/read
- `codex-ready` Label

部分底層 helper 已經存在，但還沒有完整 UI write-through 的欄位，不應視為正式可編輯功能。

目前 Taskboard 會將下列 Linear 欄位保持唯讀：

- Title
- Description
- Assignee
- Due date
- 一般 Relation 編輯
- 附件新增 / 刪除
- 其他尚未正式接線的屬性

## 12. 同步與 Refresh

目前桌面版以：

- 初始同步
- 手動同步
- 保守輪詢

為主。

未來如果要做多人正式部署，再考慮 Linear Webhook / OAuth。

## 13. 本機資料

預設：

```text
.data/taskboard.sqlite
.data/linear-connection.json
```

Linear Issue 的狀態、標題、Comments、Labels 等不是以 SQLite 為最終權威。

重新同步時，Linear 資料會覆蓋舊 projection；Codex-only metadata 會保留。

## 14. 測試與驗證

完整檢查：

```bash
npm run check
```

正式使用前仍建議做一次 Codex Desktop smoke test：

```text
建立測試 Issue
→ Todo
→ 允許 Codex
→ 啟用 Automation
→ 確認 In Progress
→ Codex 執行
→ Linear Comment
→ In Review
```

這個 smoke test 應使用專門的測試 Issue，不要直接拿正式客戶工作驗證第一輪。
