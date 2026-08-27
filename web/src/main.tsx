import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LinearIntegrationExtension } from "./components/LinearIntegrationExtension";
import {
  resolveTaskboardLanguage,
  TaskboardLanguageProvider,
} from "./i18n";
import { initializeTaskboardStorage } from "./storage";
import "./styles.css";
import "./linearIntegration.css";

async function main() {
  await initializeTaskboardStorage();
  const query = new URL(document.baseURI).searchParams;
  const language = resolveTaskboardLanguage(query.get("lang") ?? navigator.language);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
      <TaskboardLanguageProvider language={language}>
        <LinearIntegrationExtension />
      </TaskboardLanguageProvider>
    </StrictMode>,
  );
}

void main();
