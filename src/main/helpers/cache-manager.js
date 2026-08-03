const { app } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { loadLyricsFromSources } = require("../services/lyrics-sources");

// 가사 RAM 인메모리 캐시
const lyricsRamCache = new Map();

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

  // 0순위: RAM 캐시 확인 (0ms)
  if (lyricsRamCache.has(track.cacheKey)) {
    return lyricsRamCache.get(track.cacheKey);
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
    if (typeof cached.hasEmbeddedLyrics !== "boolean") {
      // 불리언 플래그가 없으면 1회 판별하여 보존
      const source = cached.metadata?.source;
      if (source === "embedded_lrc" || source === "embedded_plain") {
        cached.hasEmbeddedLyrics = true;
      } else if (track.path) {
        try {
          const emb = await loadLyricsFromSources(track.path);
          cached.hasEmbeddedLyrics = Boolean(emb && (emb.source === "embedded_lrc" || emb.source === "embedded_plain"));
        } catch {
          cached.hasEmbeddedLyrics = false;
        }
      } else {
        cached.hasEmbeddedLyrics = false;
      }
    }
    lyricsRamCache.set(track.cacheKey, cached);
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
    const isEmbeddedSource = embeddedInfo.source === "embedded_lrc" || embeddedInfo.source === "embedded_plain";
    const result = {
      lyrics: embeddedInfo.lyrics,
      syncOffset: 0,
      hasEmbeddedLyrics: isEmbeddedSource,
      metadata: { source: embeddedInfo.source }
    };
    if (embeddedInfo.source === "embedded_plain") {
      result.embeddedPlainLyrics = embeddedInfo.lyrics.map(l => l.text);
    }
    lyricsRamCache.set(track.cacheKey, result);
    return result;
  }

  return null;
}

async function saveLyricsCache(payload) {
  if (!payload?.track?.cacheKey) {
    return { ok: false, error: "missing_track_identity" };
  }

  await ensureCacheDir();
  const existing = lyricsRamCache.get(payload.track.cacheKey);
  const isEmbeddedSource = payload.metadata?.source === "embedded_lrc" || payload.metadata?.source === "embedded_plain";
  const hasEmbeddedLyrics = typeof payload.hasEmbeddedLyrics === "boolean"
    ? payload.hasEmbeddedLyrics
    : (typeof existing?.hasEmbeddedLyrics === "boolean" ? existing.hasEmbeddedLyrics : isEmbeddedSource);

  const cachePayload = {
    version: 1,
    track: payload.track,
    lyrics: payload.lyrics || [],
    syncOffset: Number(payload.syncOffset) || 0,
    embeddedPlainLyrics: payload.embeddedPlainLyrics || null,
    hasEmbeddedLyrics: hasEmbeddedLyrics,
    metadata: {
      source: payload.metadata?.source || "mock",
      updatedAt: new Date().toISOString()
    }
  };

  // RAM 캐시 실시간 업데이트
  lyricsRamCache.set(payload.track.cacheKey, cachePayload);

  // 축소된 JSON 포맷으로 저장하여 파일 용량 및 파싱 시간 절감
  await fs.writeFile(getCachePath(payload.track.cacheKey), JSON.stringify(cachePayload), "utf8");
  return { ok: true };
}

async function deleteTrackCache(track) {
  if (!track?.cacheKey) {
    return { ok: false, error: "missing_track_identity" };
  }

  lyricsRamCache.delete(track.cacheKey);
  const cachePath = getCachePath(track.cacheKey);
  try {
    await fs.unlink(cachePath);
    return { ok: true };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ok: true }; // 캐시 파일이 이미 존재하지 않으면 성공으로 간주
    }
    return { ok: false, error: err.message };
  }
}

async function clearLyricsCache() {
  lyricsRamCache.clear();
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
  deleteTrackCache,
  clearLyricsCache
};
