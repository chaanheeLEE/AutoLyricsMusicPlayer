const { GoogleGenAI } = require("@google/genai");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");

/**
 * Gemini 3.1 Flash-Lite 모델을 호출하여 공식 가사와 Whisper STT 결과를 정밀 정렬합니다.
 * 공식 Google GenAI SDK를 활용해 스키마 번역 오류를 완벽히 해소하고, Exponential Backoff를 통한 재시도를 수행합니다.
 */
async function callGeminiApiWithRetry(apiKey, contents, systemInstruction, responseSchema, geminiModel = "gemini-3.1-flash-lite", retries = 3, delay = 1000) {
  const ai = new GoogleGenAI({ apiKey: apiKey });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: geminiModel,
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("Empty text returned from Gemini API");
      }

      // JSON 파싱 검증
      const parsedJson = JSON.parse(responseText);
      return parsedJson;

    } catch (err) {
      console.warn(`Gemini API call attempt ${attempt} failed: ${err.message}`);
      if (attempt === retries) {
        throw new Error(`Gemini API failed after ${retries} attempts: ${err.message}`);
      }
      // Exponential Backoff 대기
      await new Promise((r) => setTimeout(r, delay * attempt));
    }
  }
}

/**
 * 공식 가사 라인 배열과 Whisper 분석 결과를 받아 정렬을 수행합니다.
 */
async function alignLyricsWithGemini(apiKey, officialLines, whisperLyrics, geminiModel = "gemini-3.1-flash-lite", duration = null) {
  const systemInstruction = `너는 노래의 공식 가사 리스트와 음성인식(Whisper STT) 결과를 정밀하게 싱크 맞춤 매핑하는 가사 정렬 전문가이다.
공식 가사 배열의 각 라인(index)에 가장 적합한 STT 라인(id)을 골라 매핑 테이블을 출력해야 한다.

[매칭 핵심 규칙]
1. 시간 순서 준수 (단조 증가)
   - 공식 가사 인덱스가 올라감에 따라 매칭되는 STT 결과의 타임스탬프 역시 반드시 시간 순서대로 증가해야 한다. (시간 역행 절대 금지)
2. 1대1 매핑 엄수
   - 하나의 STT 라인은 오직 하나의 공식 가사 라인에만 매핑되어야 한다. (중복 매핑 절대 금지. 1, 2절 후렴 등 동일한 텍스트 가사가 있어도 각각 독립된 시간대의 다른 STT ID를 고유하게 연결하라.)
3. 다국어 의미/음성학적 매칭
   - 공식 가사와 STT 가사가 완전히 일치하지 않더라도 번역된 단어, 유사 발음(예: I love you - 아이 러브 유), 한자와 독음 관계는 유사성으로 판단하여 적극 매칭한다.
4. 신뢰성 보장 및 보간 위임 (null 허용)
   - 공식 가사의 모든 인덱스는 출력에 포함되어야 한다.
   - 단, STT 결과 중 해당 가사 라인에 부합하는 타임라인이 전혀 없거나 시간 순서가 심하게 꼬이는 경우, 억지로 잡지 말고 whisper_id를 null로 반환하라.
5. 곡 재생 시간 한계 엄수
   - 제공된 음악의 총 재생 시간을 절대로 초과하여 매칭하거나 생성하지 않는다.

[출력 스펙]
- 제공된 JSON 스키마를 철저히 지키며, 설명 텍스트나 마크다운 백틱(\`\`\`json ...) 없이 순수한 JSON 배열만 반환하라.`;

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

  return await callGeminiApiWithRetry(apiKey, contents, systemInstruction, responseSchema, geminiModel);
}

/**
 * Gemini File API와 GenerateContent를 활용하여 로컬 오디오 파일을 텍스트(STT)로 변환합니다.
 * 타임스탬프 정보를 정확하게 JSON 형식으로 반환받습니다.
 */
async function transcribeAudioWithGemini(apiKey, filePath, duration = null, geminiModel = "gemini-3.1-flash-lite") {
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

    console.log(`[Gemini STT] Uploading file to Gemini File API: ${tempFilePath} (${mimeType})`);
    
    uploadResult = await ai.files.upload({
      file: tempFilePath,
      mimeType: mimeType
    });
    
    console.log(`[Gemini STT] Upload complete. File URI: ${uploadResult.uri}`);

    // File API 업로드 후 ACTIVE 상태 대기
    let fileState = uploadResult.state;
    let fileInfo = uploadResult;
    let attempts = 0;
    while (fileState === "PROCESSING" && attempts < 15) {
      console.log(`[Gemini STT] File is processing, waiting 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      fileInfo = await ai.files.get({ name: uploadResult.name });
      fileState = fileInfo.state;
      attempts++;
    }

    if (fileState !== "ACTIVE") {
      throw new Error(`File upload failed to reach ACTIVE state (current: ${fileState})`);
    }

    const systemInstruction = `너는 노래 음원을 받아 정확한 가사를 전사하고 소절별 시작(start) 및 종료(end) 시간을 초(second) 단위로 정밀하게 잡는 자막/STT 전문가이다.

[음성 인식 및 타임라인 생성 규칙]
1. 정밀 전사 및 구간 제외
   - 가사 언어(한국어, 영어 등)를 청각적으로 들리는 발음 그대로 정밀하게 전사한다.
   - 보컬이 없는 간주, 전주, 아웃트로 등 무음 구간은 가사 텍스트를 잡거나 시간을 할당하지 말라. (실제 보컬이 들어있는 구간만 추출)
2. 소절 분할
   - 한 줄 단위(보통 2~7초 분량)로 자연스럽게 세그먼트를 분할하고 문장이 끊어지지 않도록 흐름을 보장하라.
3. 시간적 오름차순 (단조 증가)
   - 자막 시간은 겹치거나 뒤바뀌지 않아야 한다. 이전 세그먼트의 end 시간보다 다음 세그먼트의 start 시간이 항상 뒤에 위치해야 한다.
4. 곡의 총 재생시간 준수
   - 안내되는 오디오 총 길이(초)를 절대 초과하지 말라. 모든 세그먼트의 시간은 곡 길이 이내에서 안전하게 완료되어야 한다.
5. JSON 출력 포맷 엄수
   - 제시된 JSON 스키마 구조를 완벽하게 유지하여 반환하며, 마크다운 백틱이나 서술형 대화체는 일절 없이 순수 JSON 배열 데이터만 출력하라.`;

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

    console.log(`[Gemini STT] Calling generateContent with model: ${geminiModel}`);
    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              fileData: {
                fileUri: uploadResult.uri,
                mimeType: uploadResult.mimeType
              }
            }
          ]
        }
      ],
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: responseSchema
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("No transcription returned from Gemini");
    }

    const segments = JSON.parse(text);
    console.log(`[Gemini STT] Successfully transcribed ${segments.length} segments`);

    return segments.map((seg, idx) => ({
      id: `line_${String(idx + 1).padStart(3, "0")}`,
      start: Number(seg.start),
      end: Number(seg.end),
      text: String(seg.text).trim(),
      confidence: 0.9
    }));

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
