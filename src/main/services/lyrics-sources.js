/**
 * lyrics-sources.js
 *
 * 가사를 다양한 소스에서 로드하는 우선순위 파이프라인.
 *
 * 우선순위:
 *   1순위: 음원 파일과 동일 경로의 .lrc 파일 (완벽한 타임스탬프 싱크)
 *   2순위: 음원 파일의 내장 ID3/MP4 태그 가사 메타데이터 (ffmpeg ffmetadata 활용)
 *   3순위: 음원 파일과 동일 경로의 .txt 평문 가사 사이드카 파일
 *   4순위 이하: 저장된 가사 캐시 및 Whisper/AI 분석
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveFfmpeg } = require("./transcription-worker");

// ─────────────────────────────────────────────────────────────────────────────
// LRC 파서: [mm:ss.xx] 형식 타임스탬프 가사를 파싱합니다.
// ─────────────────────────────────────────────────────────────────────────────
function parseLrc(lrcText) {
  const lines = lrcText.split("\n");
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const timestamps = [];
    let match;
    while ((match = timeRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const ms = match[3].length === 2
        ? parseInt(match[3], 10) * 10
        : parseInt(match[3], 10);
      timestamps.push(minutes * 60 + seconds + ms / 1000);
    }
    timeRegex.lastIndex = 0;

    // 타임스탬프를 모두 제거한 순수 가사 텍스트
    const text = trimmed.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "").trim();
    if (!text || timestamps.length === 0) continue;

    // 같은 텍스트에 여러 타임스탬프가 붙을 수 있음 (멀티 타임스탬프 지원)
    for (const startTime of timestamps) {
      result.push({ start: startTime, text });
    }
  }

  // 시간 순 정렬
  result.sort((a, b) => a.start - b.start);

  // end 시간 계산 (다음 라인의 start - 0.1초, 마지막은 start + 5초)
  return result.map((item, i) => ({
    id: `lrc_${String(i + 1).padStart(3, "0")}`,
    start: item.start,
    end: i + 1 < result.length
      ? Math.max(item.start + 0.5, result[i + 1].start - 0.1)
      : item.start + 5.0,
    text: item.text
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1순위: 같은 폴더의 .lrc 파일 로드
// ─────────────────────────────────────────────────────────────────────────────
async function loadLrcFile(trackPath) {
  const dir = path.dirname(trackPath);
  const base = path.basename(trackPath, path.extname(trackPath));
  const lrcPath = path.join(dir, `${base}.lrc`);

  try {
    const content = await fs.readFile(lrcPath, "utf8");
    const lyrics = parseLrc(content);
    if (lyrics.length > 0) {
      console.log(`[LyricsSources] LRC file loaded: ${lrcPath} (${lyrics.length} lines)`);
      return { lyrics, source: "lrc" };
    }
  } catch {
    // LRC 파일 없거나 파싱 실패 → 다음 소스로
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2순위: 음원 내장 가사 메타데이터 추출 (ffmpeg ffmetadata 활용)
//   - MP3의 USLT/SYLT 태그, MP4의 ©lyr 태그 등을 읽어옵니다.
//   - 별도의 ffprobe 바이너리 없이 ffmpeg 하나로 처리하여 번들 용량 절감
// ─────────────────────────────────────────────────────────────────────────────
function unescapeFfmetadata(str) {
  return str
    .replace(/\\=/g, "=")
    .replace(/\\;/g, ";")
    .replace(/\\#/g, "#")
    .replace(/\\\\/g, "\\");
}

function parseFfmetadata(rawOutput) {
  const tags = {};
  const lines = rawOutput.split(/\r?\n/);
  let currentKey = null;
  let currentValue = "";

  for (const line of lines) {
    if (line.startsWith(";") || line.startsWith("#")) continue;

    if (!currentKey) {
      const eqIdx = line.indexOf("=");
      if (eqIdx !== -1) {
        currentKey = line.slice(0, eqIdx).trim();
        const valPart = line.slice(eqIdx + 1);
        if (valPart.endsWith("\\")) {
          currentValue = valPart.slice(0, -1) + "\n";
        } else {
          tags[currentKey] = unescapeFfmetadata(valPart);
          currentKey = null;
          currentValue = "";
        }
      }
    } else {
      if (line.endsWith("\\")) {
        currentValue += line.slice(0, -1) + "\n";
      } else {
        currentValue += line;
        tags[currentKey] = unescapeFfmetadata(currentValue);
        currentKey = null;
        currentValue = "";
      }
    }
  }

  if (currentKey && currentValue) {
    tags[currentKey] = unescapeFfmetadata(currentValue);
  }

  return tags;
}

function readEmbeddedLyricsViaFfmpeg(trackPath) {
  return new Promise((resolve) => {
    let ffmpegBin;
    try {
      ffmpegBin = resolveFfmpeg();
    } catch {
      return resolve(null);
    }

    const proc = spawn(ffmpegBin, [
      "-v", "error",
      "-i", trackPath,
      "-f", "ffmetadata",
      "-"
    ], { stdio: ["ignore", "pipe", "ignore"] });

    let output = "";
    proc.stdout.on("data", (chunk) => { output += chunk; });

    proc.on("close", () => {
      try {
        const tags = parseFfmetadata(output);

        for (const key of Object.keys(tags)) {
          const lk = key.toLowerCase();
          if (
            lk === "lyrics" ||
            lk === "\u00a9lyr" ||
            lk === "uslt" ||
            lk === "unsyncedlyrics" ||
            lk.startsWith("lyrics-")
          ) {
            const rawLyrics = tags[key];
            if (rawLyrics && rawLyrics.trim().length > 0) {
              return resolve(rawLyrics.trim());
            }
          }
        }
        resolve(null);
      } catch {
        resolve(null);
      }
    });

    proc.on("error", () => resolve(null));
  });
}

function parseRawLyricsText(rawText, {
  lrcSource = "lrc",
  plainSource = "embedded_plain",
  plainIdPrefix = "emb",
  minPlainLines = 3
} = {}) {
  const content = String(rawText || "").replace(/^\uFEFF/, "").trim();
  if (!content) return null;

  if (/\[\d{2}:\d{2}\.\d{2,3}\]/.test(content)) {
    const lrcLyrics = parseLrc(content);
    if (lrcLyrics.length > 0) {
      return { lyrics: lrcLyrics, source: lrcSource };
    }
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length >= minPlainLines) {
    const lyrics = lines.map((text, i) => ({
      id: `${plainIdPrefix}_${String(i + 1).padStart(3, "0")}`,
      start: 0,
      end: 0,
      text
    }));
    return { lyrics, source: plainSource };
  }

  return null;
}

async function loadEmbeddedLyrics(trackPath) {
  const rawText = await readEmbeddedLyricsViaFfmpeg(trackPath);
  if (!rawText) return null;

  const parsed = parseRawLyricsText(rawText, {
    lrcSource: "embedded_lrc",
    plainSource: "embedded_plain",
    plainIdPrefix: "emb"
  });
  if (!parsed) return null;

  if (parsed.source === "embedded_lrc") {
    console.log(`[LyricsSources] Embedded LRC lyrics extracted (${parsed.lyrics.length} lines)`);
  } else {
    console.log(`[LyricsSources] Embedded plain lyrics extracted (${parsed.lyrics.length} lines, no timestamps)`);
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3순위: 같은 폴더의 .txt 평문 가사 사이드카 파일 로드
// ─────────────────────────────────────────────────────────────────────────────
async function loadPlainTextFile(trackPath) {
  const dir = path.dirname(trackPath);
  const base = path.basename(trackPath, path.extname(trackPath));
  const txtPath = path.join(dir, `${base}.txt`);

  try {
    const rawContent = await fs.readFile(txtPath, "utf8");
    const parsed = parseRawLyricsText(rawContent, {
      lrcSource: "lrc",
      plainSource: "txt_plain",
      plainIdPrefix: "txt"
    });
    if (!parsed) return null;

    if (parsed.source === "lrc") {
      console.log(`[LyricsSources] LRC-formatted .txt file loaded: ${txtPath} (${parsed.lyrics.length} lines)`);
    } else {
      console.log(`[LyricsSources] Plain .txt sidecar loaded: ${txtPath} (${parsed.lyrics.length} lines)`);
    }
    return parsed;
  } catch {
    // .txt 파일 없거나 읽기 실패 → 다음 소스로
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 멀티 소스 통합 로더: 우선순위대로 순차 탐색
// ─────────────────────────────────────────────────────────────────────────────
async function loadLyricsFromSources(trackPath) {
  // 1순위: .lrc 파일
  const lrcResult = await loadLrcFile(trackPath);
  if (lrcResult) return lrcResult;

  // 2순위: 음원 내장 메타데이터
  const embeddedResult = await loadEmbeddedLyrics(trackPath);
  if (embeddedResult) return embeddedResult;

  // 3순위: 같은 폴더의 .txt 평문 가사 파일
  const txtResult = await loadPlainTextFile(trackPath);
  if (txtResult) return txtResult;

  // 4순위 이하(캐시, Whisper, AI)는 기존 앱 흐름이 담당
  return null;
}

module.exports = { loadLyricsFromSources, loadPlainTextFile, parseLrc, parseFfmetadata, parseRawLyricsText };
