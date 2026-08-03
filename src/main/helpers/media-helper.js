const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");
const { resolveFfmpeg } = require("../services/transcription-worker");

// RAM 인메모리 캐시 (Key: cacheKey 또는 hash of audioPath)
const albumArtRamCache = new Map();

function getAlbumArtCacheDir() {
  return path.join(app.getPath("userData"), "album-art-cache");
}

async function ensureAlbumArtCacheDir() {
  try {
    await fs.mkdir(getAlbumArtCacheDir(), { recursive: true });
  } catch {}
}

function getCacheKey(audioPath, providedKey) {
  if (providedKey) return providedKey;
  return crypto.createHash("sha1").update(audioPath).digest("hex");
}

function getCacheFilePath(key) {
  return path.join(getAlbumArtCacheDir(), `${key}.data`);
}

async function extractAlbumArt(audioPath, providedCacheKey) {
  if (!audioPath) return null;
  const cacheKey = getCacheKey(audioPath, providedCacheKey);

  // 1. RAM 캐시 확인 (0ms)
  if (albumArtRamCache.has(cacheKey)) {
    return albumArtRamCache.get(cacheKey);
  }

  // 2. 디스크 캐시 확인
  try {
    const cachePath = getCacheFilePath(cacheKey);
    const cachedData = await fs.readFile(cachePath, "utf8");
    if (cachedData) {
      albumArtRamCache.set(cacheKey, cachedData);
      return cachedData;
    }
  } catch (err) {
    // 디스크 캐시가 없으면 통과
  }

  // 3. FFmpeg 추출
  return new Promise((resolve) => {
    let ffmpegBin;
    try {
      ffmpegBin = resolveFfmpeg();
    } catch {
      return resolve(null);
    }

    const proc = spawn(ffmpegBin, [
      "-y",
      "-i", audioPath,
      "-an",
      "-c:v", "copy",
      "-f", "image2pipe",
      "-"
    ], { stdio: ["ignore", "pipe", "ignore"] });

    let chunks = [];
    proc.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });

    proc.on("close", async (code) => {
      if (code === 0 && chunks.length > 0) {
        const buffer = Buffer.concat(chunks);
        let mime = "image/jpeg";
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
          mime = "image/png";
        }
        const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
        
        // RAM 캐시 저장
        albumArtRamCache.set(cacheKey, dataUrl);

        // 비동기 디스크 캐시 저장
        try {
          await ensureAlbumArtCacheDir();
          await fs.writeFile(getCacheFilePath(cacheKey), dataUrl, "utf8");
        } catch (e) {
          console.warn(`[AlbumArt Cache] Save failed: ${e.message}`);
        }

        resolve(dataUrl);
      } else {
        // 이미지 없는 경우 null을 RAM에 저장하여 반복 시도 방지
        albumArtRamCache.set(cacheKey, null);
        resolve(null);
      }
    });

    proc.on("error", () => {
      resolve(null);
    });
  });
}

async function clearAlbumArtCache() {
  albumArtRamCache.clear();
  try {
    const dir = getAlbumArtCacheDir();
    const files = await fs.readdir(dir).catch(() => []);
    await Promise.all(files.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})));
    return { ok: true, cleared: files.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  extractAlbumArt,
  clearAlbumArtCache
};

