const path = require("node:path");
const fs = require("node:fs");
const dotenv = require("dotenv");

const rootDir = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(rootDir, "Config", ".env") });
dotenv.config();

const configFilePath = path.join(rootDir, "Config", "bot.config.json");

let fileConfig = {};
try {
  if (fs.existsSync(configFilePath)) {
    const raw = fs.readFileSync(configFilePath, "utf8");
    fileConfig = JSON.parse(raw);
  }
} catch (err) {
  console.warn(`[config] Impossibile leggere ${configFilePath}: ${err.message}`);
}

function optionalEnv(name) {
  const value = process.env[name];
  return value && value.trim() !== "" && !value.startsWith("metti_qui") ? value.trim() : null;
}

function getFileValue(pathKey) {
  if (!pathKey) return undefined;
  return pathKey.split('.').reduce((obj, key) => (obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined), fileConfig);
}

function envOrFileString(envName, fileKeyPath, required = false, defaultValue = null) {
  const envVal = optionalEnv(envName);
  if (envVal !== null) return envVal;
  const fileVal = getFileValue(fileKeyPath);
  if (fileVal !== undefined && fileVal !== null) return fileVal;
  if (required) {
    throw new Error(`Configurazione mancante: ${envName} o ${fileKeyPath}`);
  }
  return defaultValue;
}

function envOrFileBoolean(envName, fileKeyPath, defaultValue = false) {
  const envVal = optionalEnv(envName);
  if (envVal !== null) {
    return ["1", "true", "yes", "on"].includes(envVal.toLowerCase());
  }
  const fileVal = getFileValue(fileKeyPath);
  if (fileVal !== undefined && fileVal !== null) {
    if (typeof fileVal === 'boolean') return fileVal;
    if (typeof fileVal === 'string') return ["1", "true", "yes", "on"].includes(fileVal.toLowerCase());
    return Boolean(fileVal);
  }
  return defaultValue;
}

function envOrFileNumber(envName, fileKeyPath, defaultValue) {
  const envVal = optionalEnv(envName);
  if (envVal !== null) {
    const parsed = Number(envVal);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  const fileVal = getFileValue(fileKeyPath);
  if (fileVal !== undefined && fileVal !== null) {
    const parsed = Number(fileVal);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  return defaultValue;
}

function parseStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  return [];
}

function envOrFileStringList(envName, fileKeyPath, defaultValue = []) {
  const envVal = optionalEnv(envName);
  if (envVal !== null) return parseStringList(envVal);

  const fileVal = getFileValue(fileKeyPath);
  if (fileVal !== undefined && fileVal !== null) return parseStringList(fileVal);

  return [...defaultValue];
}

function isConfiguredString(value) {
  return typeof value === "string" && value.trim() !== "" && !value.trim().startsWith("metti_qui");
}

function cleanString(value, defaultValue = null) {
  return isConfiguredString(value) ? value.trim() : defaultValue;
}

function cleanBoolean(value, defaultValue = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  if (value === undefined || value === null) return defaultValue;
  return Boolean(value);
}

function resolveConfigPath(value, defaultValue) {
  const selected = cleanString(value, defaultValue);
  if (!selected) return null;
  return path.resolve(rootDir, selected);
}

function mergeObject(base, override) {
  return {
    ...base,
    ...(override && typeof override === "object" && !Array.isArray(override) ? override : {})
  };
}

function cleanStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, cleanString(entry)])
      .filter(([, entry]) => entry)
  );
}

const DEFAULT_TICKET_LABELS = {
  gestione: { label: "Gestione", emoji: "🏢" },
  attivita: { label: "Attività", emoji: "📋" },
  developer: { label: "Developer", emoji: "💻" },
  azioni: { label: "Azioni", emoji: "⚡" },
  convalide: { label: "Convalide", emoji: "✅" },
  permadeath: { label: "Permadeath", emoji: "💀" },
  donazioni: { label: "Donazioni", emoji: "💰" },
  fazioni: { label: "Fazioni", emoji: "🏴" },
  generale: { label: "Generale", emoji: "💬" }
};

function slugifyTicketKey(value, fallback = "ticket") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function normalizeTicketCategorySettings(ticketCategories = {}, settings = {}) {
  const rawSettings = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  const keys = [...new Set([...Object.keys(ticketCategories || {}), ...Object.keys(rawSettings)])];

  return Object.fromEntries(
    keys.map((rawKey) => {
      const key = slugifyTicketKey(rawKey);
      const entry = rawSettings[rawKey] && typeof rawSettings[rawKey] === "object" ? rawSettings[rawKey] : {};
      const fallback = DEFAULT_TICKET_LABELS[key] || {};
      const categoryId = cleanString(entry.categoryId, cleanString(ticketCategories?.[rawKey], null));
      return [key, {
        key,
        label: cleanString(entry.label, fallback.label || rawKey),
        emoji: cleanString(entry.emoji, fallback.emoji || "🎫"),
        description: cleanString(entry.description, "Descrivi la tua richiesta e attendi lo staff."),
        categoryId,
        logChannelId: cleanString(entry.logChannelId, null),
        transcriptChannelId: cleanString(entry.transcriptChannelId, null)
      }];
    }).filter(([, entry]) => entry.categoryId)
  );
}

const config = {
  discordToken: envOrFileString("DISCORD_TOKEN", "discordToken", true),
  clientId: envOrFileString("CLIENT_ID", "clientId", false, null),
  guildId: envOrFileString("GUILD_ID", "guildId", true),
  welcomeChannelId: envOrFileString("WELCOME_CHANNEL_ID", "welcomeChannelId", false, null),
  logChannelId: envOrFileString("LOG_CHANNEL_ID", "logChannelId", false, null),
  roleLogChannelId: envOrFileString("ROLE_LOG_CHANNEL_ID", "roleLogChannelId", false, "1499812967502581953"),
  memberCounterChannelId: envOrFileString("MEMBER_COUNTER_CHANNEL_ID", "memberCounterChannelId", false, "1499812965581328458"),
  dashboard: {
    enabled: envOrFileBoolean("DASHBOARD_ENABLED", "dashboard.enabled", false),
    host: envOrFileString("DASHBOARD_HOST", "dashboard.host", false, "0.0.0.0"),
    port: envOrFileNumber("DASHBOARD_PORT", "dashboard.port", 3000),
    baseUrl: envOrFileString("DASHBOARD_BASE_URL", "dashboard.baseUrl", false, "http://localhost:3000"),
    redirectUri: envOrFileString("DISCORD_OAUTH_REDIRECT_URI", "dashboard.redirectUri", false, "http://localhost:3000/auth/discord/callback"),
    clientSecret: envOrFileString("DISCORD_CLIENT_SECRET", "dashboard.clientSecret", false, null),
    sessionSecret: envOrFileString("DASHBOARD_SESSION_SECRET", "dashboard.sessionSecret", false, "dev-dashboard-session-secret"),
    sessionMaxAgeDays: envOrFileNumber("DASHBOARD_SESSION_MAX_AGE_DAYS", "dashboard.sessionMaxAgeDays", 30),
    applicationLogChannelId: envOrFileString("DASHBOARD_APPLICATION_LOG_CHANNEL_ID", "dashboard.applicationLogChannelId", false, "1499812969704329389"),
    outcomeLogChannelId: envOrFileString("DASHBOARD_OUTCOME_LOG_CHANNEL_ID", "dashboard.outcomeLogChannelId", false, "1499812969704329390"),
    announcementChannelId: envOrFileString("DASHBOARD_ANNOUNCEMENT_CHANNEL_ID", "dashboard.announcementChannelId", false, "1499812969276772377"),
    seedSamples: envOrFileBoolean("DASHBOARD_SEED_SAMPLES", "dashboard.seedSamples", false),
    discordInviteUrl: envOrFileString("DASHBOARD_DISCORD_INVITE_URL", "dashboard.discordInviteUrl", false, "https://discord.gg/bFDCgEdgeD"),
    contactEmail: envOrFileString("DASHBOARD_CONTACT_EMAIL", "dashboard.contactEmail", false, "privacy@5starsrp.it"),
    fivemServerAddress: envOrFileString("DASHBOARD_FIVEM_SERVER_ADDRESS", "dashboard.fivemServerAddress", false, "5.175.169.224"),
    fivemJoinUrl: envOrFileString("DASHBOARD_FIVEM_JOIN_URL", "dashboard.fivemJoinUrl", false, null),
    fivemStatusUrl: envOrFileString("DASHBOARD_FIVEM_STATUS_URL", "dashboard.fivemStatusUrl", false, null),
    socialLinks: {
      discord: envOrFileString("DASHBOARD_SOCIAL_DISCORD_URL", "dashboard.socialLinks.discord", false, null),
      tiktok: envOrFileString("DASHBOARD_SOCIAL_TIKTOK_URL", "dashboard.socialLinks.tiktok", false, null),
      youtube: envOrFileString("DASHBOARD_SOCIAL_YOUTUBE_URL", "dashboard.socialLinks.youtube", false, null),
      fivem: envOrFileString("DASHBOARD_SOCIAL_FIVEM_URL", "dashboard.socialLinks.fivem", false, null),
      instagram: envOrFileString("DASHBOARD_SOCIAL_INSTAGRAM_URL", "dashboard.socialLinks.instagram", false, null),
      contact: envOrFileString("DASHBOARD_SOCIAL_CONTACT_URL", "dashboard.socialLinks.contact", false, null)
    },
    rulesUrl: envOrFileString("DASHBOARD_RULES_URL", "dashboard.rulesUrl", false, null),
    loreUrl: envOrFileString("DASHBOARD_LORE_URL", "dashboard.loreUrl", false, null),
    lspdUrl: envOrFileString("DASHBOARD_LSPD_URL", "dashboard.lspdUrl", false, null),
    clandestiniUrl: envOrFileString("DASHBOARD_CLANDESTINI_URL", "dashboard.clandestiniUrl", false, null),
    backgroundAcceptedRoleId: envOrFileString("DASHBOARD_BACKGROUND_ACCEPTED_ROLE_ID", "dashboard.backgroundAcceptedRoleId", false, "1502677650433642616"),
    backgroundRejectedRoleId: envOrFileString("DASHBOARD_BACKGROUND_REJECTED_ROLE_ID", "dashboard.backgroundRejectedRoleId", false, "1499812964696330366"),
    trailerUrl: envOrFileString("DASHBOARD_TRAILER_URL", "dashboard.trailerUrl", false, null),
    loreTitle: envOrFileString("DASHBOARD_LORE_TITLE", "dashboard.loreTitle", false, "THE AMERICAN FRACTURE"),
    loreText: envOrFileString(
      "DASHBOARD_LORE_TEXT",
      "dashboard.loreText",
      false,
      "5STARS prende forma dentro una frattura americana: una Los Santos notturna, instabile e viva, divisa tra istituzioni sotto pressione, economie parallele, quartieri che cambiano volto e cittadini costretti a scegliere da che parte stare. Ogni personaggio entra in un ecosistema sociale dove reputazione, lavoro, debiti, ambizioni e conseguenze costruiscono davvero la sua storia."
    ),
    storagePath: path.resolve(rootDir, envOrFileString("DASHBOARD_STORAGE_PATH", "dashboard.storagePath", false, "Dati/dashboard.json")),
    sessionStorePath: path.resolve(rootDir, envOrFileString("DASHBOARD_SESSION_STORE_PATH", "dashboard.sessionStorePath", false, "Dati/dashboard-sessions.json"))
  },
  roles: {
    attesaWhitelist: envOrFileString("ROLE_ATTESA_WHITELIST_ID", "roles.attesaWhitelist", true),
    cittadino: envOrFileString("ROLE_CITTADINO_ID", "roles.cittadino", true),
    whitelisted: envOrFileString("ROLE_WHITELISTED_ID", "roles.whitelisted", true)
  },
  ticketCategories: {
    gestione: envOrFileString("TICKET_GESTIONE_ID", "ticketCategories.gestione", false, "1499812965581328461"),
    attivita: envOrFileString("TICKET_ATTIVITA_ID", "ticketCategories.attivita", false, "1520105942044250152"),
    azioni: envOrFileString("TICKET_AZIONI_ID", "ticketCategories.azioni", false, "1499812965581328463"),
    convalide: envOrFileString("TICKET_CONVALIDA_ID", "ticketCategories.convalide", false, "1499812965938106450"),
    permadeath: envOrFileString("TICKET_PERMADEATH_ID", "ticketCategories.permadeath", false, "1499812965938106451"),
    donazioni: envOrFileString("TICKET_DONAZIONI_ID", "ticketCategories.donazioni", false, "1499812965938106454"),
    fazioni: envOrFileString("TICKET_FAZIONI_ID", "ticketCategories.fazioni", false, "1499812967103860941"),
    generale: envOrFileString("TICKET_GENERALE_ID", "ticketCategories.generale", false, "1499812967103860945")
  },
  ticketLogChannelId: envOrFileString("TICKET_LOG_CHANNEL_ID", "ticketLogChannelId", false, "1499812967502581952"),
  ticketTranscriptChannelId: envOrFileString("TICKET_TRANSCRIPT_CHANNEL_ID", "ticketTranscriptChannelId", false, "1502070206799810671"),
  defaultJoinRoles: (() => {
    const env = optionalEnv("DEFAULT_JOIN_ROLES");
    if (env !== null) return env.split(",").map((s) => s.trim()).filter(Boolean);
    const fileVal = getFileValue("defaultJoinRoles");
    if (Array.isArray(fileVal)) return fileVal;
    if (typeof fileVal === 'string') return fileVal.split(",").map((s) => s.trim()).filter(Boolean);
    return ["1499812964637736977", "1499812964637736976"];
  })(),
  staffRoleId: envOrFileString("STAFF_ROLE_ID", "staffRoleId", false, "1499812964440604729"),
  staffRoleIds: envOrFileStringList("STAFF_ROLE_IDS", "staffRoleIds", []),
  ownerUserIds: envOrFileStringList("BOT_OWNER_USER_IDS", "ownerUserIds", []),
  restoreRolesOnJoin: envOrFileBoolean("RESTORE_ROLES_ON_JOIN", "restoreRolesOnJoin", false),
  linkCitizenToWhitelisted: envOrFileBoolean("LINK_CITIZEN_TO_WHITELISTED", "linkCitizenToWhitelisted", false),
  removeWaitingOnWhitelisted: envOrFileBoolean("REMOVE_WAITING_ON_WHITELISTED", "removeWaitingOnWhitelisted", true),
  welcomeBackgroundPath: path.resolve(
    rootDir,
    envOrFileString("WELCOME_BACKGROUND_PATH", "welcomeBackgroundPath", false, "Sito/assets/welcome-5stars.jpg")
  ),
  welcomeImage: {
    baseWidth: envOrFileNumber("WELCOME_IMAGE_BASE_WIDTH", "welcomeImage.baseWidth", 2070),
    avatarX: envOrFileNumber("WELCOME_AVATAR_X", "welcomeImage.avatarX", 132),
    avatarY: envOrFileNumber("WELCOME_AVATAR_Y", "welcomeImage.avatarY", 458),
    avatarSize: envOrFileNumber("WELCOME_AVATAR_SIZE", "welcomeImage.avatarSize", 104),
    nameX: envOrFileNumber("WELCOME_NAME_X", "welcomeImage.nameX", 278),
    nameY: envOrFileNumber("WELCOME_NAME_Y", "welcomeImage.nameY", 511),
    nameMaxWidth: envOrFileNumber("WELCOME_NAME_MAX_WIDTH", "welcomeImage.nameMaxWidth", 300),
    nameFontSize: envOrFileNumber("WELCOME_NAME_FONT_SIZE", "welcomeImage.nameFontSize", 52),
    nameMinFontSize: envOrFileNumber("WELCOME_NAME_MIN_FONT_SIZE", "welcomeImage.nameMinFontSize", 24)
  },
  roleStoragePath: path.resolve(rootDir, envOrFileString("ROLE_STORAGE_PATH", "roleStoragePath", false, "Dati/member-roles.json"))
};

function buildPrimaryGuildConfig() {
  const ticketCategorySettings = normalizeTicketCategorySettings(config.ticketCategories, getFileValue("ticketCategorySettings"));
  return {
    label: "1",
    guildId: config.guildId,
    welcomeChannelId: config.welcomeChannelId,
    logChannelId: config.logChannelId,
    roleLogChannelId: config.roleLogChannelId,
    memberCounterChannelId: config.memberCounterChannelId,
    dashboard: config.dashboard,
    roles: { ...config.roles },
    ticketCategories: { ...config.ticketCategories },
    ticketCategorySettings,
    ticketLogChannelId: config.ticketLogChannelId,
    ticketTranscriptChannelId: config.ticketTranscriptChannelId,
    defaultJoinRoles: [...config.defaultJoinRoles],
    staffRoleId: config.staffRoleId,
    staffRoleIds: config.staffRoleIds.length > 0 ? [...config.staffRoleIds] : [config.staffRoleId].filter(Boolean),
    ownerUserIds: [...config.ownerUserIds],
    restoreRolesOnJoin: config.restoreRolesOnJoin,
    linkCitizenToWhitelisted: config.linkCitizenToWhitelisted,
    removeWaitingOnWhitelisted: config.removeWaitingOnWhitelisted,
    welcomeBackgroundPath: config.welcomeBackgroundPath,
    welcomeImage: { ...config.welcomeImage },
    roleStoragePath: config.roleStoragePath
  };
}

function buildEmptyGuildConfig(guildId) {
  return {
    label: guildId,
    guildId,
    welcomeChannelId: null,
    logChannelId: null,
    roleLogChannelId: null,
    memberCounterChannelId: null,
    dashboard: config.dashboard,
    roles: {
      attesaWhitelist: null,
      cittadino: null,
      whitelisted: null
    },
    ticketCategories: {},
    ticketCategorySettings: {},
    ticketLogChannelId: null,
    ticketTranscriptChannelId: null,
    defaultJoinRoles: [],
    staffRoleId: null,
    staffRoleIds: [],
    ownerUserIds: [],
    restoreRolesOnJoin: false,
    linkCitizenToWhitelisted: false,
    removeWaitingOnWhitelisted: false,
    welcomeBackgroundPath: config.welcomeBackgroundPath,
    welcomeImage: { ...config.welcomeImage },
    roleStoragePath: config.roleStoragePath
  };
}

function applyGuildOverrides(baseGuildConfig, overrides = {}) {
  const overrideTicketCategories = mergeObject(baseGuildConfig.ticketCategories, cleanStringMap(overrides.ticketCategories));
  const ticketCategorySettings = normalizeTicketCategorySettings(
    overrideTicketCategories,
    mergeObject(baseGuildConfig.ticketCategorySettings, overrides.ticketCategorySettings)
  );
  const merged = {
    ...baseGuildConfig,
    label: cleanString(overrides.label, baseGuildConfig.label),
    welcomeChannelId: cleanString(overrides.welcomeChannelId, baseGuildConfig.welcomeChannelId),
    logChannelId: cleanString(overrides.logChannelId, baseGuildConfig.logChannelId),
    roleLogChannelId: cleanString(overrides.roleLogChannelId, baseGuildConfig.roleLogChannelId),
    memberCounterChannelId: cleanString(overrides.memberCounterChannelId, baseGuildConfig.memberCounterChannelId),
    roles: mergeObject(baseGuildConfig.roles, cleanStringMap(overrides.roles)),
    ticketCategories: Object.fromEntries(Object.entries(ticketCategorySettings).map(([key, entry]) => [key, entry.categoryId])),
    ticketCategorySettings,
    ticketLogChannelId: cleanString(overrides.ticketLogChannelId, baseGuildConfig.ticketLogChannelId),
    ticketTranscriptChannelId: cleanString(overrides.ticketTranscriptChannelId, baseGuildConfig.ticketTranscriptChannelId),
    defaultJoinRoles: overrides.defaultJoinRoles !== undefined
      ? parseStringList(overrides.defaultJoinRoles)
      : [...baseGuildConfig.defaultJoinRoles],
    staffRoleId: cleanString(overrides.staffRoleId, baseGuildConfig.staffRoleId),
    staffRoleIds: overrides.staffRoleIds !== undefined
      ? parseStringList(overrides.staffRoleIds)
      : [...baseGuildConfig.staffRoleIds],
    ownerUserIds: overrides.ownerUserIds !== undefined
      ? parseStringList(overrides.ownerUserIds)
      : [...baseGuildConfig.ownerUserIds],
    restoreRolesOnJoin: overrides.restoreRolesOnJoin !== undefined
      ? cleanBoolean(overrides.restoreRolesOnJoin, baseGuildConfig.restoreRolesOnJoin)
      : baseGuildConfig.restoreRolesOnJoin,
    linkCitizenToWhitelisted: overrides.linkCitizenToWhitelisted !== undefined
      ? cleanBoolean(overrides.linkCitizenToWhitelisted, baseGuildConfig.linkCitizenToWhitelisted)
      : baseGuildConfig.linkCitizenToWhitelisted,
    removeWaitingOnWhitelisted: overrides.removeWaitingOnWhitelisted !== undefined
      ? cleanBoolean(overrides.removeWaitingOnWhitelisted, baseGuildConfig.removeWaitingOnWhitelisted)
      : baseGuildConfig.removeWaitingOnWhitelisted,
    welcomeBackgroundPath: resolveConfigPath(overrides.welcomeBackgroundPath, baseGuildConfig.welcomeBackgroundPath),
    welcomeImage: mergeObject(baseGuildConfig.welcomeImage, overrides.welcomeImage)
  };

  if (merged.staffRoleIds.length === 0 && merged.staffRoleId) {
    merged.staffRoleIds = [merged.staffRoleId];
  }

  return merged;
}

const configuredGuildOverrides = fileConfig.guilds && typeof fileConfig.guilds === "object" && !Array.isArray(fileConfig.guilds)
  ? fileConfig.guilds
  : {};
const configuredGuildIds = [
  config.guildId,
  ...envOrFileStringList("GUILD_IDS", "guildIds", []),
  ...Object.keys(configuredGuildOverrides)
].filter(Boolean);
const guildConfigs = new Map();

for (const guildId of [...new Set(configuredGuildIds)]) {
  const base = guildId === config.guildId ? buildPrimaryGuildConfig() : buildEmptyGuildConfig(guildId);
  guildConfigs.set(guildId, applyGuildOverrides(base, configuredGuildOverrides[guildId] || {}));
}

function getGuildConfig(guildId) {
  const id = cleanString(guildId);
  if (!id) return buildPrimaryGuildConfig();

  if (!guildConfigs.has(id)) {
    guildConfigs.set(id, buildEmptyGuildConfig(id));
    config.guilds[id] = guildConfigs.get(id);
  }

  return guildConfigs.get(id);
}

function getConfiguredGuildIds() {
  return [...guildConfigs.keys()];
}

config.guilds = Object.fromEntries(guildConfigs.entries());
config.getGuildConfig = getGuildConfig;
config.getConfiguredGuildIds = getConfiguredGuildIds;

module.exports = { config, configFilePath, getGuildConfig, getConfiguredGuildIds };
