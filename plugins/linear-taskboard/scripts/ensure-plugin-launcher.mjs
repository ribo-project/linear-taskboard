import { spawn } from "node:child_process";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryMarker = path.join("scripts", "codex-injector.mjs");
const runtimeName = ".data/launcher-runtime.json";
const lockName = ".data/launcher-ensure.lock";
const injectorPort = "9231";

async function findRepositoryRoot(startDirectory) {
  let directory = path.resolve(
    process.env.LINEAR_TASKBOARD_REPOSITORY?.trim() || startDirectory,
  );
  while (true) {
    try {
      await stat(path.join(directory, repositoryMarker));
      return directory;
    } catch {}
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

async function launcherIsHealthy(repositoryRoot) {
  try {
    const runtime = JSON.parse(await readFile(path.join(repositoryRoot, runtimeName), "utf8"));
    if (!Number.isInteger(runtime.pid)) return false;
    process.kill(runtime.pid, 0);
    const response = await fetch(`${runtime.url}/?host=codex`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function acquireLock(lockPath, repositoryRoot) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await open(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await launcherIsHealthy(repositoryRoot)) return null;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > 30_000) await unlink(lockPath);
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("等待 Taskboard Launcher ensure lock 逾時");
}

async function main() {
  const repositoryRoot = await findRepositoryRoot(process.cwd());
  if (!repositoryRoot || await launcherIsHealthy(repositoryRoot)) return;

  const lockPath = path.join(repositoryRoot, lockName);
  const lock = await acquireLock(lockPath, repositoryRoot);
  if (!lock) return;

  try {
    if (await launcherIsHealthy(repositoryRoot)) return;
    const child = spawn(
      process.execPath,
      [
        path.join(repositoryRoot, repositoryMarker),
        "--daemon",
        "--launch",
        "--port",
        injectorPort,
      ],
      {
        cwd: repositoryRoot,
        env: { ...process.env, CODEX_TASKBOARD_HOST: "127.0.0.1" },
        stdio: "ignore",
        detached: true,
        windowsHide: process.platform === "win32",
      },
    );
    child.once("error", (error) => {
      console.error(`Taskboard Launcher ensure 啟動失敗：${error.message}`);
    });
    child.unref();
  } finally {
    await lock.close();
    try {
      await unlink(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

await main();
