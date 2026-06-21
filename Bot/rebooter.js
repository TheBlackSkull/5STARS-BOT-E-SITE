const { spawn } = require("node:child_process");
const path = require("node:path");
const { acquireProcessLock } = require("./processLock");

const rootDir = path.resolve(__dirname, "..");
const rebooterLock = acquireProcessLock(path.join(rootDir, "Dati", "rebooter.lock"), "5stars-rebooter");

if (!rebooterLock.acquired) {
  console.error(`[rebooter] Rebooter gia in esecuzione con pid=${rebooterLock.pid}. Avvio annullato.`);
  process.exit(0);
}

const baseDelay = 1000;
const maxDelay = 60000;
const stableRunMs = 60000;
const shutdownTimeoutMs = 8000;

let restartDelay = baseDelay;
let child = null;
let childStartedAt = 0;
let restartTimer = null;
let shuttingDown = false;

function clearRestartTimer() {
  if (!restartTimer) return;
  clearTimeout(restartTimer);
  restartTimer = null;
}

function scheduleRestart(code, signal) {
  if (shuttingDown) return;

  clearRestartTimer();
  console.error(`[rebooter] Child terminato code=${code} signal=${signal}. Restart in ${restartDelay}ms.`);
  restartTimer = setTimeout(startChild, restartDelay);
}

function updateBackoff() {
  const runTime = Date.now() - childStartedAt;
  if (runTime >= stableRunMs) {
    restartDelay = baseDelay;
    return;
  }

  restartDelay = Math.min(maxDelay, Math.max(baseDelay, restartDelay * 2));
}

function startChild() {
  if (shuttingDown || child) return;

  clearRestartTimer();
  const childPath = path.join(__dirname, "index.js");
  childStartedAt = Date.now();

  child = spawn(process.execPath, [childPath], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      BOT_REBOOTER: "1"
    }
  });

  console.log(`[rebooter] Child avviato pid=${child.pid}`);

  child.once("error", (error) => {
    console.error("[rebooter] Impossibile avviare il child:", error);
    child = null;
    updateBackoff();
    scheduleRestart(null, "spawn_error");
  });

  child.once("exit", (code, signal) => {
    child = null;

    if (shuttingDown) {
      console.log("[rebooter] Child chiuso durante shutdown. Esco.");
      process.exit(code ?? 0);
      return;
    }

    if (code === 0 && !signal) {
      console.log("[rebooter] Child chiuso pulitamente con code=0. Nessun restart.");
      process.exit(0);
      return;
    }

    updateBackoff();
    scheduleRestart(code, signal);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearRestartTimer();

  console.log(`[rebooter] ${signal} ricevuto, chiusura child in corso.`);

  if (!child) {
    process.exit(0);
    return;
  }

  child.kill(signal);

  const timeout = setTimeout(() => {
    if (child) {
      console.warn("[rebooter] Child non chiuso in tempo, forzo kill.");
      child.kill("SIGKILL");
    }
    process.exit(0);
  }, shutdownTimeoutMs);

  if (typeof timeout.unref === "function") {
    timeout.unref();
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (error) => {
  console.error("[rebooter] Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[rebooter] Unhandled rejection:", reason);
  process.exit(1);
});

startChild();
