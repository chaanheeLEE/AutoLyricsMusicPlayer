/**
 * lyrics-tagger.js
 *
 * ffmpeg 스트림 복사(-c copy)를 이용하여 오디오 재인코딩 없이
 * 음원 파일(MP3, FLAC, M4A 등) 메타데이터에 가사를 비파괴적으로 내장(Embed)합니다.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveFfmpeg } = require("./transcription-worker");
const { serializeLrc } = require("../../shared/lyrics-core");

async function embedLyricsToAudio(filePath, lyrics, syncOffset = 0) {
  if (!filePath || !Array.isArray(lyrics) || lyrics.length === 0) {
    return { ok: false, error: "no_lyrics_to_embed" };
  }

  let ffmpegBin;
  try {
    ffmpegBin = resolveFfmpeg();
  } catch (err) {
    return { ok: false, error: `ffmpeg_not_found: ${err.message}` };
  }

  // LRC 텍스트 직렬화
  const lrcText = serializeLrc(lyrics, syncOffset);
  if (!lrcText || !lrcText.trim()) {
    return { ok: false, error: "empty_lrc_text" };
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const tempFilePath = path.join(dir, `.temp_embed_${Date.now()}${ext}`);

  return new Promise((resolve) => {
    // FFmpeg 명령 실행 (-c copy 오디오 재인코딩 방지)
    // 주요 호환 메타데이터 태그 동시 설정
    const proc = spawn(ffmpegBin, [
      "-y",
      "-i", filePath,
      "-c", "copy",
      "-metadata", `LYRICS=${lrcText}`,
      "-metadata", `lyrics=${lrcText}`,
      "-metadata", `UNSYNCHRONIZEDLYRICS=${lrcText}`,
      tempFilePath
    ], { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", async (code) => {
      if (code === 0) {
        try {
          // 임시 파일으로 원본 파일 교체 (Atomic Swap)
          await fs.unlink(filePath).catch(() => {});
          await fs.rename(tempFilePath, filePath);
          resolve({ ok: true, lrcText });
        } catch (renameErr) {
          try {
            await fs.copyFile(tempFilePath, filePath);
            await fs.unlink(tempFilePath).catch(() => {});
            resolve({ ok: true, lrcText });
          } catch (copyErr) {
            await fs.unlink(tempFilePath).catch(() => {});
            resolve({ ok: false, error: `file_replace_failed: ${copyErr.message}` });
          }
        }
      } else {
        await fs.unlink(tempFilePath).catch(() => {});
        resolve({ ok: false, error: `ffmpeg_failed (code ${code}): ${stderr.slice(-200)}` });
      }
    });

    proc.on("error", async (err) => {
      await fs.unlink(tempFilePath).catch(() => {});
      resolve({ ok: false, error: err.message });
    });
  });
}

module.exports = {
  embedLyricsToAudio
};
