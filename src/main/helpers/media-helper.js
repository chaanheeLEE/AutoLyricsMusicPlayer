const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");
const { resolveFfmpeg } = require("../services/transcription-worker");
const { parseFfmetadata } = require("../services/lyrics-sources");

// RAM 인메모리 캐시 (Key: cacheKey 또는 hash of audioPath)
const albumArtRamCache = new Map();
const metadataRamCache = new Map();

function getAlbumArtCacheDir() {
  return path.join(app.getPath("userData"), "album-art-cache");
}

function getMetadataCacheDir() {
  return path.join(app.getPath("userData"), "metadata-cache");
}

async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {}
}

function getCacheKey(audioPath, providedKey) {
  if (providedKey) return providedKey;
  return crypto.createHash("sha1").update(audioPath).digest("hex");
}

function getCacheFilePath(key) {
  return path.join(getAlbumArtCacheDir(), `${key}.data`);
}

function getMetadataCacheFilePath(key) {
  return path.join(getMetadataCacheDir(), `${key}.json`);
}

function parseFractionTag(rawValue) {
  if (!rawValue) return { num: null, total: null };
  const str = String(rawValue).trim();
  const match = str.match(/^(\d+)(?:\s*\/\s*(\d+))?/);
  if (!match) return { num: null, total: null };
  return {
    num: parseInt(match[1], 10),
    total: match[2] ? parseInt(match[2], 10) : null
  };
}

function parseYearTag(rawValue) {
  if (!rawValue) return "";
  const str = String(rawValue).trim();
  const yearMatch = str.match(/\b(\d{4})\b/);
  return yearMatch ? yearMatch[1] : str;
}

function parseFilenameFallback(fileName) {
  const clean = (fileName || "").replace(/\.(mp3|flac|m4a|wav|ogg|aac|opus|webm)$/i, "").trim();
  if (clean.includes(" - ")) {
    const parts = clean.split(" - ");
    return {
      artist: parts[0].trim() || "",
      title: parts.slice(1).join(" - ").trim() || clean
    };
  }
  return { artist: "", title: clean || fileName || "" };
}

function pickTag(lowerTags, candidates) {
  for (const key of candidates) {
    if (lowerTags[key] && lowerTags[key].trim()) {
      return lowerTags[key].trim();
    }
  }
  return "";
}

function parseStreamTechnicalInfo(stderrText) {
  let duration = null;
  const durMatch = stderrText.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (durMatch) {
    duration = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
    if (!Number.isFinite(duration) || duration <= 0) duration = null;
  }

  let bitrate = "";
  const brMatch = stderrText.match(/bitrate:\s*(\d+)\s*kb\/s/i);
  if (brMatch) {
    bitrate = `${brMatch[1]} kbps`;
  }

  let codec = "";
  let sampleRate = "";
  const audioMatch = stderrText.match(/Stream\s+#\d+:\d+[^:]*:\s*Audio:\s*([^,\s]+)(?:[^\n]*?,\s*(\d+)\s*Hz)?/i);
  if (audioMatch) {
    codec = audioMatch[1].toUpperCase();
    if (audioMatch[2]) {
      sampleRate = `${(Number(audioMatch[2]) / 1000).toFixed(1).replace(/\.0$/, "")} kHz`;
    }
  }

  return { duration, bitrate, codec, sampleRate };
}

async function extractTrackMetadata(audioPath, providedCacheKey) {
  if (!audioPath) return null;
  const cacheKey = getCacheKey(audioPath, providedCacheKey);

  // 1. RAM 캐시 확인
  if (metadataRamCache.has(cacheKey)) {
    return metadataRamCache.get(cacheKey);
  }

  // 2. 디스크 캐시 확인
  try {
    const raw = await fs.readFile(getMetadataCacheFilePath(cacheKey), "utf8");
    const cached = JSON.parse(raw);
    if (cached && cached.metadataLoaded) {
      metadataRamCache.set(cacheKey, cached);
      return cached;
    }
  } catch {
    // 디스크 캐시 없으면 추출 진행
  }

  const fileName = path.basename(audioPath);
  const fallback = parseFilenameFallback(fileName);

  const buildFallbackResult = (tech = {}) => ({
    fileName,
    title: fallback.title,
    artist: fallback.artist || "-",
    album: "",
    albumArtist: "",
    trackNumber: null,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    year: "",
    genre: "",
    duration: tech.duration ?? null,
    bitrate: tech.bitrate || "",
    codec: tech.codec || "",
    sampleRate: tech.sampleRate || "",
    metadataLoaded: true
  });

  // 3. FFmpeg 메타데이터 및 스트림 정보 추출
  return new Promise((resolve) => {
    let ffmpegBin;
    try {
      ffmpegBin = resolveFfmpeg();
    } catch {
      const fb = buildFallbackResult();
      metadataRamCache.set(cacheKey, fb);
      return resolve(fb);
    }

    const proc = spawn(ffmpegBin, [
      "-hide_banner",
      "-i", audioPath,
      "-f", "ffmetadata",
      "-"
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stdoutText = "";
    let stderrText = "";
    proc.stdout.on("data", (chunk) => { stdoutText += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk) => { stderrText += chunk.toString("utf8"); });

    proc.on("close", async () => {
      const tech = parseStreamTechnicalInfo(stderrText);
      const rawTags = parseFfmetadata(stdoutText);
      const lowerTags = {};
      for (const [k, v] of Object.entries(rawTags)) {
        lowerTags[k.toLowerCase()] = v;
      }

      const tagTitle = pickTag(lowerTags, ["title", "tit2", "\u00a9nam"]);
      const tagArtist = pickTag(lowerTags, ["artist", "tpe1", "\u00a9art", "author"]);
      const tagAlbum = pickTag(lowerTags, ["album", "talb", "\u00a9alb"]);
      const tagAlbumArtist = pickTag(lowerTags, ["album_artist", "albumartist", "tpe2", "aart"]);
      const tagTrack = pickTag(lowerTags, ["track", "trck", "trkn", "tracknumber"]);
      const tagDisc = pickTag(lowerTags, ["disc", "tpos", "disk", "discnumber"]);
      const tagDate = pickTag(lowerTags, ["date", "year", "tdrc", "tyer", "\u00a9day"]);
      const tagGenre = pickTag(lowerTags, ["genre", "tcon", "\u00a9gen"]);

      const trackParsed = parseFractionTag(tagTrack);
      const discParsed = parseFractionTag(tagDisc);

      const metadata = {
        fileName,
        title: tagTitle || fallback.title,
        artist: tagArtist || fallback.artist || "-",
        album: tagAlbum,
        albumArtist: tagAlbumArtist,
        trackNumber: trackParsed.num,
        totalTracks: trackParsed.total,
        discNumber: discParsed.num,
        totalDiscs: discParsed.total,
        year: parseYearTag(tagDate),
        genre: tagGenre,
        duration: tech.duration,
        bitrate: tech.bitrate,
        codec: tech.codec,
        sampleRate: tech.sampleRate,
        metadataLoaded: true
      };

      metadataRamCache.set(cacheKey, metadata);
      try {
        await ensureDir(getMetadataCacheDir());
        await fs.writeFile(getMetadataCacheFilePath(cacheKey), JSON.stringify(metadata), "utf8");
      } catch (e) {
        console.warn(`[Metadata Cache] Save failed: ${e.message}`);
      }

      resolve(metadata);
    });

    proc.on("error", () => {
      const fb = buildFallbackResult();
      metadataRamCache.set(cacheKey, fb);
      resolve(fb);
    });
  });
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
          await ensureDir(getAlbumArtCacheDir());
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

async function clearDirFiles(dir) {
  const files = await fs.readdir(dir).catch(() => []);
  await Promise.all(files.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})));
  return files.length;
}

async function clearAlbumArtCache() {
  albumArtRamCache.clear();
  metadataRamCache.clear();
  try {
    const artCleared = await clearDirFiles(getAlbumArtCacheDir());
    const metaCleared = await clearDirFiles(getMetadataCacheDir());
    return { ok: true, cleared: artCleared + metaCleared };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  extractAlbumArt,
  extractTrackMetadata,
  clearAlbumArtCache
};
