[English](README.md) | [繁體中文](README.zh-TW.md)

# Linear Taskboard for Codex

這是一套以 **Linear 為任務來源**、直接整合進 Codex 的工作面板。

本專案 fork 自原版 Codex Taskboard，保留原本的 Codex 內嵌 UI、啟動器、Skill、對話綁定、Git branch / worktree 與 Project Automation，並把 Linear 改成專案與 Issue 的唯一權威資料來源。

> **目前狀態：** Linear 整合已在開發分支完成主要功能，目前正進行 Codex Desktop 真機驗證。本 fork 目前沒有正式簽章版桌面安裝包。

## 為什麼要做這個 fork

原本的流程需要：

```text
打開 Linear
  ↓
找到 Issue
  ↓
複製 Issue ID
  ↓
切回 Codex
  ↓
告訴 Codex 開始做
```

這個 fork 的目標是把流程改成：

```text
Linear
  ↓
Linear Adapter / 本機 Projection
  ↓
Codex 內的 Taskboard
  ↓
Codex 對話 + Repository / Worktree
  ↓
Git / GitHub
  ↓
Linear In Review
  ↓
人工驗收 → Done
```

最重要的原則是：

**Linear 永遠是專案與 Issue 的唯一權威資料來源。**

SQLite 只負責本機快取 / projection，以及 Linear 沒有的 Codex 執行資訊，例如 thread binding 與 workspace mapping，不會變成第二套可以獨立修改的任務資料庫。

## 目前已完成的功能

### Linear 連線與同步

- 使用 Linear Personal API Key 或 OAuth 2.0 連線。
- 可限制同步指定 Team / Project。
- 可設定只同步目前 Linear 使用者負責的 Issue。
- 每個 Linear Project 會投影成一個 Taskboard Project。
- Linear Issue ID，例如 `RIB-123`，會保留在 Taskboard 看板與詳情頁。
- Linear blocker 關係會同步進來，包含跨 Project blocker。
- SQLite 只做快取，不會獨立成為另一份可編輯的 Issue 狀態來源。

### 受控的 Linear Write-through

目前已經會真正寫回 Linear 的操作有：

- Codex claim / review 流程使用的狀態切換；
- Comments；
- 控制 Codex 是否可以自動處理該 Issue 的 `codex-ready` Label。

還沒有完整 write-through 的 Linear 欄位會在 Taskboard 中維持唯讀。

目前不要把 Taskboard 裡的標題、描述、負責人、到期日、Relation、附件等本機編輯視為 Linear 正式編輯入口。

### Codex 專案 / Workspace 綁定

每個 Linear Project 可以綁定目前的 Codex 專案與工作目錄。

沿用原 Taskboard 的資料格式：

- `codexProjectId`
- `codexProjectKind`
- `codexHostId`
- `workspacePath`

Issue 被 Codex claim 後，可以保留完整 thread binding，讓同一個 Codex 對話繼續工作，也避免其他對話默默接手同一張 Issue。

### Dependency-aware Automation

Linear Todo 不是只要看到就會執行。

必須同時符合：

```text
status = Todo
AND 有 codex-ready
AND dependency snapshot 完整
AND 所有 blocker 都已解除
AND claim / continuation binding 狀態合法
AND Linear Project 已綁定可用的 Codex workspace
```

Automation 現在會區分：

```text
有 Todo
```

和：

```text
有可以實際執行的 Todo
```

如果 Todo 全部都被 blocker 擋住、沒有 `codex-ready`，或 dependency 資訊不完整，昂貴的 Codex cron 會暫停，但輕量 policy check 仍會保留。

一旦之後有 Issue 變成可執行，Automation 可以自動恢復。

Codex 預設只做到 **In Review**。

`Done` 仍然保留給人工驗收。

## 系統需求

從原始碼執行時需要：

- Node.js 22.5 以上
- Git
- Linear 帳號即可；專案預設使用內建的公開 OAuth 2.0 應用程式，Personal API Key 僅作為進階備用方式
- 要測試 Codex 內嵌介面時，需要 Codex Desktop App
- 只有要打包 Tauri 桌面版時，才需要 Rust 1.88+ 與各平台 build tools

macOS、Windows、Ubuntu 的打包需求仍沿用原版 Taskboard 的平台需求。

## 從原始碼啟動

請先安裝依賴並建置 Web 資源：

```powershell
npm ci
npm run build
```

接著請依需求選擇下列其中一種啟動方式。兩種方式會使用同一個本機連接埠，請勿同時執行。

### A. 僅啟動瀏覽器版 Web Taskboard

這只會啟動本機 Web 伺服器，不會啟動 Codex Desktop，也不會將 Taskboard 注入 Codex 左側選單。

```powershell
npm start
```

瀏覽器開啟：<http://127.0.0.1:47823>

### B. 讓 Taskboard 出現在 Codex Desktop 左側

Windows 請先使用 PowerShell 7 建立「主 Codex + CDP」捷徑。這樣會保留原本的 Codex 對話、專案與設定，Plugin 才能將 Taskboard 入口注入同一個 Codex 視窗。

```powershell
npm run codex:shortcut
```

指令會在桌面建立 `Codex.lnk`。它會啟動既有的 Launcher / injector，由 injector 以主 Codex 設定檔啟動 Codex、帶入 `127.0.0.1:9231` CDP，並啟動 Taskboard。請將這個捷徑拖曳到工作列一次，再從新的工作列圖示開啟 Codex；不需要再執行 `npm run codex`。Windows 11 可能不提供程式自動釘選工作列的功能，因此第一次需要手動拖曳。

如果要直接執行 Launcher / injector，仍可使用：

```powershell
$env:CODEX_TASKBOARD_HOST="127.0.0.1"
npm run codex
```

只執行 `npm start` 不會產生左側選單入口。Plugin 的 SessionStart hook 會自動確保 resident Launcher 執行中，而且不會自動打開任務面板。

### 安裝 Codex Plugin

本專案也包含一個放在 repository 內的 Codex Plugin。Plugin 的 SessionStart hook 只會確保一個 resident Launcher 正在執行，不會自動打開任務面板；既有 Launcher / injector 會負責建立並修復 Codex 左側的「任務面板」入口。

請從 repository 根目錄註冊 repository 內的本機 marketplace，並安裝 Plugin：

```powershell
codex plugin marketplace add .
codex plugin add linear-taskboard@personal
```

安裝後請開啟新的 Codex 工作階段。Plugin 的 hook 可能需要先經過檢閱與信任，才能確保 Launcher 已啟動。

預設本機資料會放在：

```text
.data/taskboard.sqlite
.data/linear-connection.json
```

Linear API Key 只保存在本機設定檔中；支援的系統會使用較嚴格的檔案權限。

API Key 不會回傳給 React UI。

前端開發模式：

```bash
npm run dev
```

## 連接 Linear

建議直接從 Taskboard UI 操作：

1. 打開 Project 選單。
2. 選擇 **連接 Linear / Linear 設定**。
3. 選擇 **使用 Linear OAuth 連線**；系統會開啟 Linear，並沿用使用者目前的登入狀態。
4. 如有需要，可限制指定 Team ID / Project ID。
5. 選擇是否只同步目前 Linear 使用者負責的 Issue。
6. 執行同步。

Linear API Key 只會由本機 Taskboard Server 用來呼叫 Linear GraphQL API。

OAuth 2.0 是預設連線方式。專案已內建公開 OAuth App 的 Client ID，使用者不需要設定環境變數。完成 Linear 授權後，回到 Taskboard 按 **立即同步**，即可完成連線與資料同步：

```powershell
npm run codex
```

回呼網址已登記在專案使用的公開 Linear OAuth App。Taskboard 使用 Authorization Code + PKCE；OAuth Token 只會儲存在本機設定檔，Access Token 過期時會自動更新，也不會回傳給瀏覽器。請不要把 API Key 或 OAuth Token 貼到對話、Issue、留言或 commit 中。

不會寫進：

- Issue 描述
- Comments
- Codex Prompt
- Git Commit
- 瀏覽器 localStorage

## 使用 `linearctl`

也可以用 CLI 做第一次設定與診斷：

```bash
LINEAR_API_KEY=... npm run linear -- configure
npm run linear -- status
npm run linear -- sync
npm run linear -- clear
```

如果要同步不是只分配給目前使用者的 Issue：

```bash
LINEAR_API_KEY=... npm run linear -- configure --all
```

限制 Team / Project：

```bash
LINEAR_API_KEY=... npm run linear -- configure \
  --team-id <LINEAR_TEAM_ID> \
  --project-id <LINEAR_PROJECT_ID>
```

API Key 刻意只從 `LINEAR_API_KEY` 環境變數讀取，不接受 CLI flag。

## 讓一個 Linear Project 可以交給 Codex

每個要給 Codex 執行的 Linear Project，建議依序做：

1. 在 Taskboard 打開該 Linear Project。
2. 使用 **綁定目前 Codex**，建立 Project ↔ Codex workspace mapping。
3. 把準備執行的 Linear Issue 放到 `Todo`。
4. 打開 Issue 詳情，按 **允許 Codex**。
5. Taskboard 會在 Linear 寫入 `codex-ready` Label。
6. 確認所有 blockers 都已解除。
7. 需要自動執行時，再開啟 Project Automation。

`codex-ready` 是真正存在 Linear 的 Label，不是 Taskboard 本機旗標。

單純連線或同步 Linear **不會自動幫任何 Issue 開啟 Codex 執行權限**。

## Codex Claim 流程

正常流程：

```text
Todo + codex-ready
        ↓
重新確認 eligibility
        ↓
claim → Linear In Progress
        ↓
建立或繼續 Codex thread
        ↓
開發 + 驗證
        ↓
將結果寫回 Linear Comment
        ↓
Linear In Review
        ↓
人工驗收 → Done
```

真正寫入 Linear 前會再次檢查：

- Issue version 是否過期
- dependency snapshot 是否完整
- 是否仍有未解除 blocker
- 是否還有 `codex-ready`
- 是否有衝突的 thread binding

其中任何一項不合法，都會 fail closed，不會先改 Linear 再補救。

## 使用 `taskctl`

原版 `taskctl` 仍然保留，並作為 `manage-taskboard` Skill 的主要執行介面。

例如：

```bash
npm run taskctl -- issue list --project <TASKBOARD_PROJECT_ID> --status todo --json
npm run taskctl -- issue get <ISSUE_IDENTIFIER> --json
```

Linear Issue 的 JSON 會包含像是：

- `linearDependencies`
- `claimEligibility`
- `continuationEligibility`
- thread / workspace binding

Agent 應該直接使用 Server 算好的 eligibility，不要自己重新用本地 relation 猜 Linear dependency。

## 在 Codex 內打開 Taskboard

本 fork 保留原版 CDP / Launcher 整合。

開發測試：

```bash
CODEX_TASKBOARD_HOST=127.0.0.1 npm run codex
```

如果 Codex 已經用 CDP 啟動：

```bash
npm run codex:inject -- --port 9229 --open
```

Launcher 會維持本機 Taskboard Server，並使用既有的 Codex project / thread route 整合。

不會修改 Codex App 的程式檔。

## 桌面版 Build

目前這個 fork 以本機 / CI build 為主，**沒有正式簽章版公開安裝包**。

### Windows x64

```powershell
npm ci
npm run app:build:windows
```

### macOS Universal

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run app:build
```

### Ubuntu 24.04 x64

```bash
npm ci
npm run app:build:linux:x64
```

請不要把原版 `chuspeeism/dashi-taskboard` 的 Releases 當成這個 Linear fork 的正式版本。

## 環境變數

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `CODEX_TASKBOARD_HOST` | `0.0.0.0` | HTTP 綁定位置；只要本機使用可設 `127.0.0.1` |
| `CODEX_TASKBOARD_PORT` | `47823` | 本機 HTTP Port |
| `CODEX_TASKBOARD_TRUSTED_ORIGINS` | 未設定 | 原版 loopback / tunnel 邊界允許的 HTTPS Origin |
| `CODEX_TASKBOARD_DATA_DIR` | `.data` | SQLite 與 Linear 本機設定資料夾 |
| `CODEX_TASKBOARD_URL` | `http://127.0.0.1:47823` | `taskctl` API 位置 |
| `LINEAR_API_KEY` | 未設定 | `linearctl configure` 使用的 Linear credential |

## Cloud Collaboration

原版專案有 Cloudflare / D1 的協作模式，相關程式碼目前仍保留，方便未來同步 upstream。

但對目前的 Linear 模式來說：

- Linear 才是 Project / Issue 的權威資料來源；
- SQLite 只是本機 projection / cache；
- Codex workspace mapping 是 device-local；
- 不應把原版 D1 模式部署成 Linear Issue 的第二套可寫入資料來源。

文件分類請看 [docs/README.md](docs/README.md)。

## 驗證

```bash
npm run check
```

會執行：

- TypeScript typecheck
- Production Web build
- Component tests
- Server / CLI / injection Node tests

GitHub Actions 另外會跑桌面版平台 build。

## 文件

- [Linear 使用與設定指南（繁體中文）](docs/linear-setup.zh-TW.md)
- [Linear 整合架構](docs/linear-integration-architecture.md)
- [Privacy](PRIVACY.md)
- [文件狀態 / 原版沿用文件](docs/README.md)

## Upstream

本專案 fork 自：

[`chuspeeism/dashi-taskboard`](https://github.com/chuspeeism/dashi-taskboard)

我們刻意保留大量原版 Codex Taskboard 架構，降低未來同步 upstream 的成本。

本 fork 最重要的差異只有一句話：

**Linear 管專案與 Issue；Taskboard 負責 Codex 工作介面與本機執行 metadata。**

授權條款請看 [LICENSE](LICENSE)。
