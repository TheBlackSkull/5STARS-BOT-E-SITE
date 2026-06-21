const fs = require("node:fs");
const path = require("node:path");

function readLockPid(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8").trim();
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      return Number.isInteger(parsed.pid) ? parsed.pid : null;
    } catch {
      const pid = Number.parseInt(raw, 10);
      return Number.isInteger(pid) ? pid : null;
    }
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function acquireProcessLock(lockPath, label) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        fd,
        `${JSON.stringify({
          label,
          pid: process.pid,
          startedAt: new Date().toISOString()
        })}\n`,
        "utf8"
      );
      fs.closeSync(fd);

      let released = false;
      const release = () => {
        if (released) return;
        released = true;

        const lockPid = readLockPid(lockPath);
        if (lockPid !== process.pid) return;

        try {
          fs.unlinkSync(lockPath);
        } catch {
          // The process is exiting; a stale lock can be cleaned on next boot.
        }
      };

      process.once("exit", release);
      return { acquired: true, lockPath, pid: process.pid, release };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }

      const lockPid = readLockPid(lockPath);
      if (isProcessAlive(lockPid)) {
        return { acquired: false, lockPath, pid: lockPid, release: () => {} };
      }

      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      }
    }
  }
}

module.exports = { acquireProcessLock, isProcessAlive, readLockPid };
