const { app } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { loadLyricsFromSources } = require("../services/lyrics-sources");

function getTrackCacheKey(track) {
  const identity = `${track.path}|${track.size}|${track.modifiedMs}`;
  return crypto.createHash("sha1").update(identity).digest("hex");
}

function getCacheDir() {
  return path.join(app.getPath("userData"), "lyrics-cache");
}

async function ensureCacheDir() {
  await fs.mkdir(getCacheDir(), { recursive: true });
}

function getCachePath(cacheKey) {
  return path.join(getCacheDir(), `${cacheKey}.json`);
}

async function loadLyricsCache(track) {
  if (!track?.cacheKey) {
    return null;
  }

  let cached = null;
  // 1순위: JSON 캐시
  try {
    const raw = await fs.readFile(getCachePath(track.cacheKey), "utf8");
    cached = JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`[Cache] Cache read error: ${err.message}`);
    }
  }

  // 캐시가 이미 존재하고 유효하다면 로드 작업을 건너뛰고 즉시 반환
  if (cached?.lyrics?.length > 0) {
    return cached;
  }

  // 캐시가 없으면 음원 파일 내장 가사(LRC 또는 평문) 및 외부 .lrc 파일 확인
  let embeddedInfo = null;
  if (track.path) {
    try {
      embeddedInfo = await loadLyricsFromSources(track.path);
    } catch (err) {
      console.log(`[Cache] loadLyricsFromSources failed: ${err.message}`);
    }
  }

  // 내장/외부 가사 소스 활용
  if (embeddedInfo) {
    console.log(`[Cache] Lyrics loaded from source: ${embeddedInfo.source}`);
    const result = {
      lyrics: embeddedInfo.lyrics,
      syncOffset: 0,
      metadata: { source: embeddedInfo.source }
    };
    if (embeddedInfo.source === "embedded_plain") {
      result.embeddedPlainLyrics = embeddedInfo.lyrics.map(l => l.text);
    }
    return result;
  }

  return null;
}

async function saveLyricsCache(payload) {
  if (!payload?.track?.cacheKey) {
    return { ok: false, error: "missing_track_identity" };
  }

  await ensureCacheDir();
  const cachePayload = {
    version: 1,
    track: payload.track,
    lyrics: payload.lyrics || [],
    syncOffset: Number(payload.syncOffset) || 0,
    embeddedPlainLyrics: payload.embeddedPlainLyrics || null,
    metadata: {
      source: payload.metadata?.source || "mock",
      updatedAt: new Date().toISOString()
    }
  };

  await fs.writeFile(getCachePath(payload.track.cacheKey), JSON.stringify(cachePayload, null, 2), "utf8");
  return { ok: true };
}

async function clearLyricsCache() {
  try {
    const dir = getCacheDir();
    const files = await fs.readdir(dir).catch(() => []);
    await Promise.all(files.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})));
    return { ok: true, cleared: files.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getTrackCacheKey,
  getCacheDir,
  ensureCacheDir,
  getCachePath,
  loadLyricsCache,
  saveLyricsCache,
  clearLyricsCache
};
