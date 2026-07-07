const { GoogleGenAI } = require("@google/genai");

/**
 * Gemini 3.1 Flash-Lite 모델을 호출하여 공식 가사와 Whisper STT 결과를 정밀 정렬합니다.
 * 공식 Google GenAI SDK를 활용해 스키마 번역 오류를 완벽히 해소하고, Exponential Backoff를 통한 재시도를 수행합니다.
 */
async function callGeminiApiWithRetry(apiKey, contents, systemInstruction, responseSchema, retries = 3, delay = 1000) {
  const ai = new GoogleGenAI({ apiKey: apiKey });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
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
- **엄격한 시간적 오름차순**: 공식 가사의 인덱스(\`official_index\`)가 증가함에 따라, 이에 대응해 배정되는 \`whisper_id\` 역시 시간상 반드시 엄격하게 오름차순(순차적으로 증가하는 ID)으로 매칭되어야 한다. 시간 역행이나 무작위 꼬임 매칭을 완전히 금지한다.
- **시간 정보 피드백 분석**: 입력된 가사 리스트에 동봉된 \`[시작 시간 ~ 종료 시간]\` 범위를 적극 분석하여, 1절과 2절 등 반복 가사가 서로 다른 시간대에 올바르게 독립 할당되도록 싱크 오차를 최종 교정하라.
- 전체 트랙 단위로 한 번에 입력되므로, 곡의 전체적인 맥락을 고려하여 매치하라.

3. [생략 및 오타 강건성]
- Whisper STT 결과는 기계적인 인식 오차로 인해 일부 가사가 누락되었거나(생략), 오타가 섞여 있을 수 있다.
- 항상 공식 가사 원문을 절대적 기준(Ground Truth)으로 삼아야 한다.
- 만약 공식 가사 중 특정 소절에 대응하는 Whisper 결과가 STT 오류로 누락되었거나 도저히 매칭할 수 없는 경우, whisper_id에 null을 부여하여 명시적으로 누락을 반환하라.

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

module.exports = {
  alignLyricsWithGemini
};
