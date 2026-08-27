---
name: linear-taskboard-plugin
description: 當使用者要在 Codex 中查看、同步或處理 Linear Taskboard 任務時使用；先確認本機 Taskboard 啟動器與左側入口，再使用專案既有的 Linear 與 Taskboard 流程。
---

# Linear Taskboard

使用本 Plugin 時：

1. 優先從 Codex 左側選單開啟「任務面板」。
2. 如果入口不存在，確認 Plugin 的 SessionStart ensure 啟動器仍在執行，再檢查 `.data/launcher-runtime.json`。
3. Linear 是專案、Issue、狀態、標籤與相依性的唯一權威來源；SQLite 只作為本機快取與 Codex 執行資訊。
4. 不要把 Linear API Key 貼到對話、Issue 描述、留言或 commit；只在 Taskboard 的 Linear 設定入口輸入。
5. 目前版本同時支援 Linear Personal API Key 與 OAuth 2.0；若使用 OAuth，請在本機設定 OAuth App 的 Client ID，並在 Taskboard 的 Linear 設定入口完成授權。
6. 使用專案既有的 `linearctl` 與 `taskctl` 指令，不要自行猜測 Linear 欄位或依賴關係。

本 Plugin 只確保既有 Launcher 常駐；左側入口由專案既有 injector 建立，Taskboard 不會因 Plugin 啟動而自動打開。
