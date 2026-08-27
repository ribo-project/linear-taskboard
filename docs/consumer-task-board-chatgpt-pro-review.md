# 個人使用者三欄 Issue 工作台：ChatGPT Pro 協作與驗收紀錄

> **歷史文件 / upstream 紀錄**：本文件記錄原版 Codex Taskboard 過去一次 UI 改版的協作與驗收過程，不是目前 Linear-backed fork 的產品規格。現行架構請以 [`linear-integration-architecture.md`](linear-integration-architecture.md) 與 [`../README.zh-TW.md`](../README.zh-TW.md) 為準。

## 協作資訊

- ChatGPT Pro 對話：https://chatgpt.com/c/6a6b2b0e-9dc0-83ea-a57e-3addec457e70
- 原始碼基線：`677b54451db707ae6132486b6593b7be11e4ee09`
- 提交給 ChatGPT Pro 的原始碼 ZIP：
  - 檔案：`codex-taskboard-pro-677b544.zip`
  - 位元組數：`1,645,317`
  - SHA-256：`a1a96179554d69cb2770910c7857981fa2a14fb39afcaa6e6fcfc0b07a17fef6`
- ChatGPT Pro 交付 ZIP：
  - 檔案：`codex-taskboard-pro-3col-board.zip`
  - 位元組數：`1,635,271`
  - SHA-256：`a3cca47873283f4eec2a4710fb46f7cd5427bdc310318494598b7db3ca6cf14e`
- ChatGPT Pro 主要 patch：
  - 檔案：`codex-taskboard-pro-3col-board.patch`
  - 位元組數：`67,714`
  - SHA-256：`5393f54db5c5e2dca8071f2a999dda49a39da4058076945320455b223f7b832a`
- ChatGPT Pro 修正 patch：
  - 檔案：`codex-taskboard-pro-3col-board-fix.patch`
  - 位元組數：`3,035`
  - SHA-256：`091df00ba8e1d9304f86109f731564de06f5301f574b7a90ece4f1a0353f1044`

## 當時實作範圍

- 主工作台固定顯示 `todo`、`in_progress`、`in_review` 三欄。
- 三欄文案改為「待處理」「處理中」「等你確認」。
- `backlog`、`blocked`、`done`、`canceled` 收進右側「其他任務」面板。
- 側邊面板支援四個狀態 Tab、計數、詳情入口、篩選同步與既有任務卡操作。
- 保留七狀態領域模型、API、CLI、資料庫與即時同步流程。
- 全域新增 Issue 預設進入 `todo`；欄內新增仍使用所在欄狀態。
- 移除舊的空欄顯示、手動隱藏欄位與「隱藏欄位」執行路徑。
- 流程看板入口仍保持隱藏。

## 當時要求 ChatGPT Pro 修正的問題

首次交付為了讓目標測試全部通過，順帶修改了留言附件與自動認領功能的舊測試斷言，超出該次範圍。之後要求並取得最小修正 patch：

- 恢復留言附件測試的基線斷言。
- 恢復自動認領測試的基線斷言。
- 只保留刪除 `BoardSettingsMenu.tsx` 所需的兩處測試修改。
- 未修改 runtime 程式碼、相依套件、lock file 或其他測試。

## 當時獨立驗收結果

- 原始碼 ZIP 解壓後密鑰掃描：`0` 筆。
- ZIP 與主要 patch 套用後的原始碼：逐檔一致。
- 主要 patch 與修正 patch：`git apply --check` 通過。
- `package.json` 與 `package-lock.json`：與基線逐位元組一致。
- `npm run typecheck`：通過。
- `npm run build:web`：通過。
- 當時工作樹相關 contract tests：`22/22` 通過。
- 當時工作樹 production build：通過。
- Codex 注入刷新：port `9231`，`refreshed: true`。
- 當時本機管理面板：已確認顯示三欄與「其他任務」入口。

完整 `npm test` 在安裝 lock file 完整相依套件後執行：

- 基線：`349` 項，`332` 通過，`17` 失敗。
- 修改後：`350` 項，`333` 通過，`17` 失敗。
- 失敗項目集合與基線一致，該次修改沒有新增失敗。

隔離資料目錄中的實際頁面當時已驗證：

- 三個主要狀態欄固定顯示。
- 「其他任務」面板預設關閉，可開啟與關閉。
- 四個狀態 Tab、計數與內容正確。
- 面板任務可進入詳情，返回後保留目前 Tab。
- 搜尋同時套用到主欄與側邊面板。
- 面板任務移到主欄後，重新整理頁面仍保留新狀態。

當時未自動執行原生 pointer drag。瀏覽器 driver 沒有提供拖曳動作；當時只檢查實際 drag path 仍沿用 `TaskCard` 的 `dataTransfer` 與 `BoardColumn` 原有 `onDrop`、排序與持久化流程。

## 歷史狀態

- 當時修改只存在於本機 `feature/consumer-task-board` branch 工作樹。
- 當時尚未 commit、push、建立 PR 或部署。
- 當時未遷移資料庫、修改正式環境設定或操作真實使用者資料。

## 與目前 Linear fork 的關係

目前 fork 已在這套 upstream UI/launcher 基礎上加入 Linear projection、`codex-ready`、dependency-aware claim、Codex workspace mapping 與 Linear write-through。

因此本文件只能作為 upstream UI 演進的歷史背景，不應拿來判斷目前 Linear Taskboard 的功能是否完成或如何操作。
