const fs = require("node:fs/promises");
const path = require("node:path");

class RoleStorage {
  constructor(filePath, legacyGuildId = null) {
    this.filePath = filePath;
    this.legacyGuildId = legacyGuildId;
    this.cache = {};
    this.writeQueue = Promise.resolve();
    this.ready = this.load();
  }

  async load() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.cache = JSON.parse(raw);
    } catch (error) {
      if (error.code !== "ENOENT") {
        if (error instanceof SyntaxError) {
          const backupPath = `${this.filePath}.broken-${Date.now()}`;
          await fs.rename(this.filePath, backupPath).catch(() => null);
          console.warn(`[storage] JSON ruoli corrotto, creato backup: ${backupPath}`);
          this.cache = {};
          await this.save();
          return;
        }

        throw error;
      }

      this.cache = {};
      await this.save();
    }

    await this.migrateLegacyCache();
  }

  async migrateLegacyCache() {
    if (!this.legacyGuildId || !this.cache || typeof this.cache !== "object" || Array.isArray(this.cache)) {
      return;
    }

    const legacyEntries = Object.entries(this.cache).filter(([, value]) => Array.isArray(value));
    if (legacyEntries.length === 0) {
      return;
    }

    this.cache = {
      [this.legacyGuildId]: Object.fromEntries(legacyEntries)
    };
    await this.save();
  }

  async save() {
    const data = JSON.stringify(this.cache, null, 2);
    const tempPath = `${this.filePath}.tmp`;
    const write = async () => {
      await fs.writeFile(tempPath, `${data}\n`, "utf8");
      await fs.rename(tempPath, this.filePath);
    };

    this.writeQueue = this.writeQueue.then(write, write);
    await this.writeQueue;
  }

  async get(guildId, userId) {
    await this.ready;
    return this.cache[guildId]?.[userId] || [];
  }

  async set(guildId, userId, roleIds) {
    await this.ready;
    if (!this.cache[guildId] || typeof this.cache[guildId] !== "object" || Array.isArray(this.cache[guildId])) {
      this.cache[guildId] = {};
    }

    this.cache[guildId][userId] = [...new Set(roleIds)];
    await this.save();
  }
}

module.exports = { RoleStorage };
