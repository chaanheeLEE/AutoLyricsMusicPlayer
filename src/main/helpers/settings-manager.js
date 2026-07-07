const { app } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_SETTINGS = {
  model: "base",
  language: null,
  geminiApiKey: "",
  autoAnalyzeMode: "off",
  floatingFontSize: 18,
  floatingOpacity: 0.85,
  floatingBgColor: "#0b0d11",
  floatingFontColor: "#ffffff",
  floatingAlign: "center",
};

function getFloatingBoundsPath() {
  return path.join(app.getPath("userData"), "floating-bounds.json");
}

async function loadFloatingBounds() {
  try {
    const raw = await fs.readFile(getFloatingBoundsPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveFloatingBounds(bounds) {
  await fs.writeFile(getFloatingBoundsPath(), JSON.stringify(bounds), "utf8");
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

async function loadSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    
    // 하위 호환성 유지: 기존 boolean autoAnalyze를 autoAnalyzeMode로 승격 컨버팅
    if (parsed.autoAnalyzeMode === undefined && parsed.autoAnalyze !== undefined) {
      parsed.autoAnalyzeMode = parsed.autoAnalyze ? "analyze" : "off";
    }

    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(settings) {
  const fontSizeVal = Number(settings.floatingFontSize);
  const opacityVal = Number(settings.floatingOpacity);

  const safe = {
    model: settings.model || DEFAULT_SETTINGS.model,
    language: settings.language || null,
    geminiApiKey: settings.geminiApiKey || "",
    autoAnalyzeMode: settings.autoAnalyzeMode || "off",
    floatingFontSize: isNaN(fontSizeVal) ? DEFAULT_SETTINGS.floatingFontSize : fontSizeVal,
    floatingOpacity: isNaN(opacityVal) ? DEFAULT_SETTINGS.floatingOpacity : opacityVal,
    floatingBgColor: settings.floatingBgColor || DEFAULT_SETTINGS.floatingBgColor,
    floatingFontColor: settings.floatingFontColor || DEFAULT_SETTINGS.floatingFontColor,
    floatingAlign: settings.floatingAlign || DEFAULT_SETTINGS.floatingAlign,
  };
  await fs.writeFile(getSettingsPath(), JSON.stringify(safe, null, 2), "utf8");
  return safe;
}

module.exports = {
  DEFAULT_SETTINGS,
  loadFloatingBounds,
  saveFloatingBounds,
  loadSettings,
  saveSettings
};
