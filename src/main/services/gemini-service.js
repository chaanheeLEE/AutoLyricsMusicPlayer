const { GoogleGenAI } = require("@google/genai");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const { transcribeSystemInstruction, alignSystemInstruction } = require("./gemini-prompts");

function createCancelledError() {
  const err = new Error("cancelled");
  err.cancelled = true;
  return err;
}

function isNonRetryableGeminiError(err) {
  const status = Number(err?.status || err?.code || 0);
  if ([400, 401, 403, 404].includes(status)) {
    return true;
  }
  const msg = String(err?.message || "");
  return /API_KEY_INVALID|INVALID_ARGUMENT|PERMISSION_DENIED|NOT_FOUND|\b(400|401|403|404)\b/i.test(msg);
}

function sleepWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createCancelledError());
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

async function withAbortAndTimeout(promiseFactory, { signal, timeoutMs = 45000 } = {}) {
  if (signal?.aborted) {
    throw createCancelledError();
  }

  let timer = null;
  let onAbort = null;

  const racePromises = [promiseFactory()];

  if (timeoutMs > 0) {
    racePromises.push(new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Gemini API request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }));
  }

  if (signal) {
    racePromises.push(new Promise((_, reject) => {
      onAbort = () => reject(createCancelledError());
      signal.addEventListener("abort", onAbort, { once: true });
    }));
  }

  try {
    return await Promise.race(racePromises);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Gemini 모델을 호출하여 공식 가사와 Whisper STT 결과를 정밀 정렬합니다.
 * 공식 Google GenAI SDK를 활용해 스키마 번역 오류를 완벽히 해소하고, Exponential Backoff를 통한 재시도를 수행합니다.
 */
async function callGeminiApiWithRetry(apiKey, contents, systemInstruction, responseSchema, geminiModel = "gemini-3.5-flash-lite", retries = 3, delay = 1000, options = {}) {
  const { signal, timeoutMs = 45000 } = options || {};
  const ai = new GoogleGenAI({ apiKey: apiKey });

  for (let attempt = 1; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw createCancelledError();
    }

    try {
      const response = await withAbortAndTimeout(
        () => ai.models.generateContent({
          model: geminiModel,
          contents: contents,
          config: {
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
            responseSchema: responseSchema
          }
        }),
        { signal, timeoutMs }
      );

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty text returned from Gemini API");
      }

      // JSON 파싱 검증
      const parsedJson = JSON.parse(responseText);
      return parsedJson;

    } catch (err) {
      if (err?.cancelled || signal?.aborted) {
        throw createCancelledError();
      }
      if (isNonRetryableGeminiError(err)) {
        throw err;
      }
      console.warn(`Gemini API call attempt ${attempt} failed: ${err.message}`);
      if (attempt === retries) {
        throw new Error(`Gemini API failed after ${retries} attempts: ${err.message}`);
      }
      // Exponential Backoff 대기 (취소 시그널 감지 시 즉시 중단)
      await sleepWithSignal(delay * attempt, signal);
    }
  }
}

/**
 * 공식 가사 라인 배열과 Whisper 분석 결과를 받아 정렬을 수행합니다.
 */
async function alignLyricsWithGemini(apiKey, officialLines, whisperLyrics, geminiModel = "gemini-3.5-flash-lite", duration = null, options = {}) {
  const systemInstruction = alignSystemInstruction;

  const formatTime = (t) => (t !== null && t !== undefined && !isNaN(t)) ? `${t.toFixed(2)}s` : "unknown";
  let durationText = "";
  if (duration && !isNaN(duration) && duration > 0) {
    durationText = `\n[곡의 총 재생 길이]\n- 이 음악 트랙의 총 길이는 정확히 **${Number(duration).toFixed(2)}초**입니다. 모든 매칭 결과의 싱크 타임은 이 시간 한계 내에서 안착되어야 합니다.`;
  }
  const contents = `[공식 가사 텍스트]\n${officialLines.map((line, idx) => `${idx}. ${line}`).join("\n")}\n\n[이전 정합/STT 가사 목록 (타임스탬프 포함)]\n${whisperLyrics.map((item) => `${item.id} [${formatTime(item.start)} ~ ${formatTime(item.end)}]: ${item.text}`).join("\n")}${durationText}`;

  const responseSchema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        official_index: {
          type: "INTEGER",
          description: "공식 가사 배열 내 0부터 시작하는 인덱스 번호"
        },
        whisper_id: {
          type: "STRING",
          nullable: true,
          description: "매칭된 Whisper 가사의 ID (예: line_001). 대응되는 항목이 없거나 누락된 경우 null을 명시적으로 반환"
        }
      },
      required: ["official_index", "whisper_id"]
    }
  };

  return await callGeminiApiWithRetry(apiKey, contents, systemInstruction, responseSchema, geminiModel, 3, 1000, options);
}

/**
 * Gemini 모델의 텍스트/JSON 출력을 안전하게 자막 세그먼트 배열로 파싱합니다.
 * JSON 스키마뿐만 아니라 마크다운 코드블록, 타임스탬프 텍스트 출력도 유연하게 파싱합니다.
 */
function parseTranscriptionResponse(rawText) {
  if (!rawText) return [];

  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }

  // 1. JSON 파싱 시도
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((item, idx) => ({
        id: `line_${String(idx + 1).padStart(3, "0")}`,
        start: Number(item.start || item.startTime || 0),
        end: Number(item.end || item.endTime || (item.start ? Number(item.start) + 2 : 0)),
        text: String(item.text || item.sentence || "").trim(),
        confidence: 0.9
      })).filter(s => s.text.length > 0);
    }
  } catch {
    // JSON 형식이 아닌 경우 정규식 파서로 fallback
  }

  // 2. [start ~ end] text 또는 [mm:ss.xx] text 라인별 파싱
  const lines = cleaned.split(/\r?\n/);
  const segments = [];
  let segIdx = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 패턴 A: [0.0 ~ 2.5] 가사 또는 [0:12.34 ~ 0:15.60] 가사
    const rangeMatch = trimmed.match(/\[?\s*(\d+(?::\d+)?(?:\.\d+)?)\s*(?:~|-|-->)\s*(\d+(?::\d+)?(?:\.\d+)?)\s*\]?\s*:?\s*(.+)/);
    if (rangeMatch) {
      const parseSec = (str) => {
        if (str.includes(":")) {
          const parts = str.split(":");
          return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
        }
        return parseFloat(str);
      };
      const start = parseSec(rangeMatch[1]);
      const end = parseSec(rangeMatch[2]);
      const text = rangeMatch[3].trim();
      if (text) {
        segments.push({
          id: `line_${String(segIdx++).padStart(3, "0")}`,
          start: isNaN(start) ? 0 : start,
          end: isNaN(end) ? (start + 2) : end,
          text,
          confidence: 0.9
        });
        continue;
      }
    }

    // 패턴 B: [mm:ss.xx] 일반 LRC 타임스탬프
    const lrcMatch = trimmed.match(/\[(\d{2}):(\d{2}(?:\.\d{2,3})?)\](.*)/);
    if (lrcMatch) {
      const min = parseInt(lrcMatch[1], 10);
      const sec = parseFloat(lrcMatch[2]);
      const start = min * 60 + sec;
      const text = lrcMatch[3].trim();
      if (text) {
        segments.push({
          id: `line_${String(segIdx++).padStart(3, "0")}`,
          start,
          end: start + 2.5,
          text,
          confidence: 0.9
        });
      }
    }
  }

  // 인접 세그먼트 시간 보정
  for (let i = 0; i < segments.length; i++) {
    if (i < segments.length - 1 && segments[i].end > segments[i + 1].start) {
      segments[i].end = segments[i + 1].start;
    }
  }

  return segments;
}

/**
 * Gemini File API와 GenerateContent를 활용하여 로컬 오디오 파일을 텍스트(STT)로 변환합니다.
 * 타임스탬프 정보를 정확하게 JSON 형식으로 반환받습니다.
 */
async function transcribeAudioWithGemini(apiKey, filePath, duration = null, geminiModel = "gemini-3.5-flash-lite", options = {}) {
  const { signal, timeoutMs = 90000 } = options || {};
  if (signal?.aborted) {
    throw createCancelledError();
  }

  const ai = new GoogleGenAI({ apiKey: apiKey });

  const ext = path.extname(filePath).toLowerCase();
  let mimeType = "audio/mpeg";
  if (ext === ".wav") mimeType = "audio/wav";
  else if (ext === ".m4a") mimeType = "audio/m4a";
  else if (ext === ".ogg") mimeType = "audio/ogg";
  else if (ext === ".flac") mimeType = "audio/flac";
  else if (ext === ".aac") mimeType = "audio/aac";

  // 한글 경로/파일명 우회를 위한 임시 영문 파일 복사본 생성
  const tmpId = crypto.randomBytes(6).toString("hex");
  const tempFilePath = path.join(os.tmpdir(), `alp_gemini_stt_${tmpId}${ext}`);

  let uploadResult;
  try {
    console.log(`[Gemini STT] Copying file to temp path to bypass non-ASCII path issues: ${tempFilePath}`);
    await fs.copyFile(filePath, tempFilePath);
    if (signal?.aborted) {
      throw createCancelledError();
    }

    console.log(`[Gemini STT] Uploading file to Gemini File API: ${tempFilePath} (${mimeType})`);

    uploadResult = await withAbortAndTimeout(
      () => ai.files.upload({
        file: tempFilePath,
        mimeType: mimeType
      }),
      { signal, timeoutMs }
    );

    console.log(`[Gemini STT] Upload complete. File URI: ${uploadResult.uri}`);

    // File API 업로드 후 ACTIVE 상태 대기
    let fileState = uploadResult.state;
    let fileInfo = uploadResult;
    let attempts = 0;
    while (fileState === "PROCESSING" && attempts < 15) {
      if (signal?.aborted) {
        throw createCancelledError();
      }
      console.log(`[Gemini STT] File is processing, waiting 2s...`);
      await sleepWithSignal(2000, signal);
      if (signal?.aborted) {
        throw createCancelledError();
      }
      fileInfo = await withAbortAndTimeout(
        () => ai.files.get({ name: uploadResult.name }),
        { signal, timeoutMs: 15000 }
      );
      fileState = fileInfo.state;
      attempts++;
    }

    if (signal?.aborted) {
      throw createCancelledError();
    }

    if (fileState !== "ACTIVE") {
      throw new Error(`File upload failed to reach ACTIVE state (current: ${fileState})`);
    }

    const systemInstruction = transcribeSystemInstruction;

    let durationGuide = "";
    if (duration && !isNaN(duration) && duration > 0) {
      durationGuide = `\n\n* [중요] 이 음악의 실제 총 길이는 정확히 **${Number(duration).toFixed(2)}초**이다. 따라서 모든 자막 세그먼트의 시작 시간(start)과 종료 시간(end)은 절대로 이 ${Number(duration).toFixed(2)}초를 초과해서는 안 된다. 마지막 세그먼트의 종료 시간 역시 이 값 이내에서 안전하게 닫혀야 한다.`;
    }

    const prompt = `오디오 데이터를 분석하여 각 소절별 자막/가사 세그먼트 배열을 타임스탬프(시작 및 종료 시간, 초 단위)와 함께 추출하라.
각 세그먼트는 실제 노래 가사 한 줄 단위에 조응해야 하며, 정확한 보컬 싱크 타이밍을 유지해야 한다.${durationGuide}`;

    const responseSchema = {
      type: "ARRAY",
      description: "List of transcribed audio segments with timestamps",
      items: {
        type: "OBJECT",
        properties: {
          start: {
            type: "NUMBER",
            description: "Start time of the segment in seconds"
          },
          end: {
            type: "NUMBER",
            description: "End time of the segment in seconds"
          },
          text: {
            type: "STRING",
            description: "Transcribed text for this segment"
          }
        },
        required: ["start", "end", "text"]
      }
    };

    const response = await withAbortAndTimeout(
      () => ai.models.generateContent({
        model: geminiModel || "gemini-3.5-flash-lite",
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType } }
          ]
        }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema
        }
      }),
      { signal, timeoutMs }
    );

    if (signal?.aborted) {
      throw createCancelledError();
    }

    const text = response.text;
    if (!text) {
      throw new Error("No transcription returned from Gemini");
    }

    const segments = parseTranscriptionResponse(text);
    console.log(`[Gemini STT] Successfully transcribed ${segments.length} segments`);

    return segments;

  } finally {
    // 1. 로컬 임시 파일 제거
    try {
      await fs.unlink(tempFilePath);
      console.log(`[Gemini STT] Cleaned up local temp file: ${tempFilePath}`);
    } catch (err) {
      // 무시
    }

    // 2. 클라우드 업로드 파일 제거
    if (uploadResult && uploadResult.name) {
      try {
        console.log(`[Gemini STT] Cleaning up Gemini file: ${uploadResult.name}`);
        await ai.files.delete({ name: uploadResult.name });
      } catch (err) {
        console.error(`[Gemini STT] Failed to delete Gemini file: ${err.message}`);
      }
    }
  }
}

module.exports = {
  alignLyricsWithGemini,
  transcribeAudioWithGemini
};
