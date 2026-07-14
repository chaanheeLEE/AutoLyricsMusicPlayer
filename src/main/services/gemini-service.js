const { GoogleGenAI } = require("@google/genai");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");

/**
 * Gemini 3.1 Flash-Lite 모델을 호출하여 공식 가사와 Whisper STT 결과를 정밀 정렬합니다.
 * 공식 Google GenAI SDK를 활용해 스키마 번역 오류를 완벽히 해소하고, Exponential Backoff를 통한 재시도를 수행합니다.
 */
async function callGeminiApiWithRetry(apiKey, contents, systemInstruction, responseSchema, retries = 3, delay = 1000) {
  const ai = new GoogleGenAI({ apiKey: apiKey });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
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
async function alignLyricsWithGemini(apiKey, officialLines, whisperLyrics) {
  const systemInstruction = `너는 노래의 공식 가사 리스트와 음성인식(Whisper STT) 결과 리스트를 서로 대조하여 정밀하게 싱크 시간을 매칭하는 가사 정렬 전문가(Lyrics Alignment Expert)이다.
너의 유일한 역할은 공식 가사의 각 라인(index 번호로 구분됨)에 대응하는 Whisper STT 라인(id로 구분됨)을 매칭하여 매핑 테이블을 생성하는 것이다.

다음 규칙들을 반드시 준수해야 한다:

1. [다국어 음성학적 및 시맨틱 매핑]
- 너는 발음(phonetic)과 의미(semantic) 유사성을 기준으로 서로 다른 언어 표현을 매칭한다.
- 단순히 문자열이 완전히 일치하지 않더라도, 문맥상 동일한 의미 또는 발음으로 판단되면 적극적으로 매칭하라.
- Few-shot 예시:
  * 예시 A (영어 발음 한글 표기): 공식 가사의 "I love you"와 Whisper 결과의 "아이 러브 유"는 발음상 완벽히 일치하므로 매칭한다.
  * 예시 B (번역/의미 일치): 공식 가사의 "사랑해"와 Whisper 결과의 "I love you" 또는 "아이시테루"는 의미가 상통하며 해당 소절의 음성 타임라인이 일치하므로 매칭한다.
  * 예시 C (한자-독음): 공식 가사의 "愛"와 Whisper 결과의 "あい" 또는 "아이"는 한자와 독음 관계이므로 매칭한다.

2. [시퀀셜 문맥 추론 및 중복 매칭 절대 금지]
- 가사는 항상 위에서 아래로(시간이 흐르는 순서대로) 순차적으로 진행된다. (배열 인덱스 순서 유지)
- **1대1 매핑 원칙**: 하나의 \`whisper_id\`는 전체 매핑 결과 내에서 단 한 번만 배정되어야 한다. 1절 후렴과 2절 후렴 등 가사 텍스트가 완전히 동일하더라도, 각각 다른 시간대의 고유한 \`whisper_id\`를 독립적으로 할당해야 하며, 하나의 동일한 \`whisper_id\`를 여러 공식 가사 인덱스에 중복 매칭하는 것을 강력히 금지한다.
- **엄격한 시간적 오름차순 (단조 증가 보장)**: 공식 가사의 인덱스(\`official_index\`)가 증가함에 따라, 이에 대응해 배정되는 \`whisper_id\` 역시 시간상 반드시 엄격하게 오름차순(순차적으로 증가하는 ID 및 타임스탬프)으로 매칭되어야 한다. **시간 역행이나 무작위 꼬임 매칭은 완전히 금지한다.**
- **시간 정보 피드백 분석**: 입력된 가사 리스트에 동봉된 \`[시작 시간 ~ 종료 시간]\` 범위를 적극 분석하여, 1절과 2절 등 반복 가사가 서로 다른 시간대에 올바르게 독립 할당되도록 싱크 오차를 최종 교정하라.
- 전체 트랙 단위로 한 번에 입력되므로, 곡의 전체적인 맥락을 고려하여 매치하라.

3. [내장 공식 가사의 절대적 신뢰 및 강건성]
- 입력된 공식 가사는 가사의 원문이자 시간적 순서가 완벽하게 보장된 절대적 기준(Ground Truth)이다. Whisper STT 결과의 일부 라인 순서가 엉뚱하게 인식되었더라도, 공식 가사의 인덱스 흐름을 해쳐서는 안 된다.
- 만약 특정 공식 가사 항목에 대응하는 Whisper 결과가 STT 오류로 누락되었거나, 시간 순서가 꼬여서 역전될 우려가 있는 경우, 억지로 매칭하지 말고 해당 공식 가사 항목의 \`whisper_id\`는 반드시 \`null\`로 지정하여 안전하게 누락을 반환해야 한다.

4. [구조화된 출력]
- 지시된 JSON 스키마를 철저히 지켜 응답하라. 부가적인 부연 설명, 마크다운 코드 블록(예: \`\`\`json ...) 등을 절대 출력하지 말고 순수 JSON 배열만 반환해야 한다.`;

  const formatTime = (t) => (t !== null && t !== undefined && !isNaN(t)) ? `${t.toFixed(2)}s` : "unknown";
  const contents = `[공식 가사 텍스트]\n${officialLines.map((line, idx) => `${idx}. ${line}`).join("\n")}\n\n[이전 정합/STT 가사 목록 (타임스탬프 포함)]\n${whisperLyrics.map((item) => `${item.id} [${formatTime(item.start)} ~ ${formatTime(item.end)}]: ${item.text}`).join("\n")}`;

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

  return await callGeminiApiWithRetry(apiKey, contents, systemInstruction, responseSchema);
}

/**
 * Gemini File API와 GenerateContent를 활용하여 로컬 오디오 파일을 텍스트(STT)로 변환합니다.
 * 타임스탬프 정보를 정확하게 JSON 형식으로 반환받습니다.
 */
async function transcribeAudioWithGemini(apiKey, filePath, duration = null) {
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

    const systemInstruction = `너는 오디오 파일의 음성 인식을 수행하고, 노래 가사 및 텍스트의 정밀한 자막 타임라인을 생성하는 음성 인식 및 자막 전문가(STT & Subtitle Expert)이다.

오디오 파일을 듣고 가사를 텍스트로 인식한 뒤, 각 소절(segment)에 해당하는 시작 시간(start)과 종료 시간(end)을 초(second) 단위로 매우 정확하게 추출해야 한다.

다음 규칙들을 엄격히 준수하여 응답하라:

1. [텍스트 및 타임라인 추출 강건성]
- 한국어, 영어, 또는 기타 언어로 된 노래 가사를 발음대로 정확하게 전사한다.
- 음악 소리가 없는 전반부 간주나 후반부 아웃트로, 혹은 간주 구간에는 가사를 생성하거나 타임스탬프를 잡지 않아야 한다. 즉, 실제 보컬(목소리)이 들리는 구간만 정확히 텍스트와 시간대로 추출하라.

2. [적절한 세그먼트 크기 분할]
- 가사의 한 줄(소절)에 맞추어 적절한 길이로 세그먼트를 나누어라.
- 하나의 세그먼트는 보통 2초에서 7초 사이가 적당하며, 문장이나 소절 단위가 끊어지지 않도록 흐름을 보장하라.

3. [시간적 단조 증가 보장]
- 자막 세그먼트의 시간 정보는 절대로 역행하거나 겹치지 않아야 한다. 즉, 이전 세그먼트의 종료 시간(end)보다 다음 세그먼트의 시작 시간(start)이 시간상 뒤에 위치해야 한다.
- 모든 시간 정보는 오름차순으로 단조 증가해야 한다.

4. [구조화된 출력 규칙]
- 제시된 JSON 스키마를 철저히 준수하여 결과를 반환하라.
- 마크다운 백틱(\`\`\`)이나 설명적 텍스트를 절대 포함하지 마라. 오직 스키마에 정의된 순수 JSON 배열만 반환해야 한다.`;

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

    console.log(`[Gemini STT] Calling generateContent with model: gemini-3.5-flash`);
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
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
