const fs = require("node:fs");
const { AttachmentBuilder } = require("discord.js");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const BASE_WIDTH = 2070;
const AVATAR_TIMEOUT_MS = 8000;
const backgroundCache = new Map();

if (fs.existsSync("C:\\Windows\\Fonts\\arialbd.ttf")) {
  try {
    GlobalFonts.registerFromPath("C:\\Windows\\Fonts\\arialbd.ttf", "Arial Bold");
  } catch {
    // Font registration is best-effort; canvas will fall back to sans-serif.
  }
}

function drawCircleImage(ctx, image, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, x, y, size, size);
  ctx.restore();
}

function drawAvatarFrame(ctx, x, y, size) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 170, 255, 0.55)";
  ctx.shadowBlur = size * 0.08;
  ctx.lineWidth = Math.max(5, size * 0.055);
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function applyNameFont(ctx, fontSize) {
  ctx.font = `900 ${Math.round(fontSize)}px "Arial Bold", Arial, sans-serif`;
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;

  const ellipsis = "...";
  let output = text;

  while (output.length > 1 && ctx.measureText(`${output}${ellipsis}`).width > maxWidth) {
    output = output.slice(0, -1);
  }

  return `${output}${ellipsis}`;
}

function drawNameText(ctx, text, x, y, maxWidth, maxFontSize, minFontSize) {
  let fontSize = maxFontSize;

  while (fontSize > minFontSize) {
    applyNameFont(ctx, fontSize);
    if (ctx.measureText(text).width <= maxWidth) break;
    fontSize -= 2;
  }

  applyNameFont(ctx, fontSize);
  const visibleText = fitText(ctx, text, maxWidth);

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#06131a";
  ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
  ctx.shadowBlur = fontSize * 0.12;
  ctx.lineWidth = Math.max(2, fontSize * 0.045);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.strokeText(visibleText, x, y);
  ctx.fillText(visibleText, x, y);
  ctx.restore();
}

function getUsername(member) {
  return member?.user?.username || member?.displayName || "Utente";
}

function getInitials(member) {
  const username = getUsername(member).trim();
  return (username.slice(0, 2) || "5S").toUpperCase();
}

function drawAvatarFallback(ctx, member, x, y, size) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, "#05aef2");
  gradient.addColorStop(1, "#ffffff");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);

  ctx.fillStyle = "#06202b";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  applyNameFont(ctx, size * 0.36);
  ctx.fillText(getInitials(member), x + size / 2, y + size / 2);
  ctx.restore();
}

async function loadBackground(backgroundPath) {
  let stat;

  try {
    stat = await fs.promises.stat(backgroundPath);
  } catch {
    throw new Error(`Sfondo welcome non trovato: ${backgroundPath}`);
  }

  const cacheKey = `${backgroundPath}:${stat.size}:${stat.mtimeMs}`;
  if (backgroundCache.has(cacheKey)) {
    return backgroundCache.get(cacheKey);
  }

  backgroundCache.clear();
  const image = await loadImage(backgroundPath);
  backgroundCache.set(cacheKey, image);
  return image;
}

async function loadAvatar(member) {
  const avatarUrl = member.user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });

  if (!/^https?:\/\//i.test(avatarUrl)) {
    return loadImage(avatarUrl);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVATAR_TIMEOUT_MS);

  try {
    const response = await fetch(avatarUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return loadImage(Buffer.from(arrayBuffer));
  } finally {
    clearTimeout(timeout);
  }
}

async function createWelcomeAttachment(member, backgroundPath, imageLayout = {}) {
  const background = await loadBackground(backgroundPath);
  const canvas = createCanvas(background.width, background.height);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

  const baseWidth = imageLayout.baseWidth || BASE_WIDTH;
  const scale = canvas.width / baseWidth;
  const accountUsername = getUsername(member);

  const avatarSize = (imageLayout.avatarSize ?? 104) * scale;
  const avatarX = (imageLayout.avatarX ?? 132) * scale;
  const avatarY = (imageLayout.avatarY ?? 458) * scale;
  const nameX = (imageLayout.nameX ?? 278) * scale;
  const nameY = (imageLayout.nameY ?? 511) * scale;
  const nameMaxWidth = (imageLayout.nameMaxWidth ?? 300) * scale;
  const nameFontSize = (imageLayout.nameFontSize ?? 52) * scale;
  const nameMinFontSize = (imageLayout.nameMinFontSize ?? 24) * scale;

  try {
    const avatar = await loadAvatar(member);
    drawCircleImage(ctx, avatar, avatarX, avatarY, avatarSize);
  } catch (error) {
    console.warn(`[welcome] Avatar non caricato per ${member.id}: ${error.message}`);
    drawAvatarFallback(ctx, member, avatarX, avatarY, avatarSize);
  }

  drawAvatarFrame(ctx, avatarX, avatarY, avatarSize);
  drawNameText(ctx, accountUsername, nameX, nameY, nameMaxWidth, nameFontSize, nameMinFontSize);

  const buffer = canvas.toBuffer("image/png");
  return new AttachmentBuilder(buffer, { name: "welcome-5stars.png" });
}

module.exports = { createWelcomeAttachment };
