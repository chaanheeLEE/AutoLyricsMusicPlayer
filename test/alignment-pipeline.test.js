const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSearchQueries,
  calculateBigramSimilarity,
} = require("../src/main/services/lyrics-scraper");
const {
  alignAndInterpolateLyrics,
} = require("../src/main/helpers/lyrics-aligner");
const {
  GEMINI_FALLBACK_MODELS,
  buildModelFallbackChain,
  buildTranscriptionPrompt,
  callGeminiApiWithRetry,
} = require("../src/main/services/gemini-service");

test("calculateBigramSimilarity supports Korean, English, and Japanese scripts", () => {
  const koA = "오늘 밤 별빛 아래서 너와 함께 걸어가네";
  const koB = "오늘 밤 별빛 아래서 너와 함께 걸어가";
  assert.ok(calculateBigramSimilarity(koA, koB) > 0.7);

  const jaA = "夜空に輝く星を見上げて君を想う";
  const jaB = "夜空に輝く星を見上げて君を思う";
  assert.ok(calculateBigramSimilarity(jaA, jaB) > 0.6);

  const enA = "Dancing under the neon lights tonight";
  assert.ok(calculateBigramSimilarity(jaA, enA) < 0.15);
});

test("buildSearchQueries builds deduplicated priority queries from artist, title, and customQuery", () => {
  assert.deepEqual(
    buildSearchQueries({ title: "Song.mp3", artist: "Artist" }, "  Manual Query  "),
    ["Manual Query"]
  );

  assert.deepEqual(
    buildSearchQueries({ title: "Spring Day (Official MV).flac", artist: "BTS" }),
    ["BTS Spring Day", "Spring Day"]
  );

  assert.deepEqual(
    buildSearchQueries({ title: "IU - Blueming [Live].mp3", artist: "IU" }),
    ["IU - Blueming", "Blueming"]
  );
});

test("alignAndInterpolateLyrics returns cancelled result when AbortSignal is aborted", async () => {
  const controller = new AbortController();
  controller.abort();

  const res = await alignAndInterpolateLyrics(
    {
      track: { title: "Test Song", duration: 180 },
      whisperLyrics: [{ id: "line_001", start: 1, end: 4, text: "hello world" }],
      settings: { geminiApiKey: "dummy-key" },
      embeddedLyricsLines: ["hello world", "second line"]
    },
    { signal: controller.signal }
  );

  assert.equal(res.ok, false);
  assert.equal(res.cancelled, true);
  assert.equal(res.error, "cancelled");
});

test("alignAndInterpolateLyrics falls back cleanly when Gemini returns zero valid matches", async () => {
  const whisperLyrics = [
    { id: "line_001", start: 1.0, end: 3.5, text: "first whisper line" },
    { id: "line_002", start: 4.0, end: 7.0, text: "second whisper line" }
  ];

  const res = await alignAndInterpolateLyrics(
    {
      track: { title: "Test Song", duration: 120 },
      whisperLyrics,
      settings: { geminiApiKey: "dummy-key" },
      embeddedLyricsLines: ["official line 1", "official line 2"]
    },
    {
      deps: {
        alignLyricsWithGemini: async () => [
          { official_index: 0, whisper_id: null },
          { official_index: 1, whisper_id: "non_existent" }
        ]
      }
    }
  );

  assert.equal(res.ok, true);
  assert.equal(res.source, "whisper");
  assert.equal(res.warning, "fallback_to_whisper");
  assert.equal(res.failureStage, "matching");
  assert.equal(res.errorCode, "no_valid_matches");
  assert.equal(res.lyrics.length, 2);
  assert.equal(res.lyrics[0].text, "first whisper line");
});

test("alignAndInterpolateLyrics classifies scrape failures and preserves Whisper fallback", async () => {
  const whisperLyrics = [
    { id: "line_001", start: 2.0, end: 5.0, text: "some lyric line" }
  ];

  const res = await alignAndInterpolateLyrics(
    {
      track: { title: "Unknown Song", duration: 150 },
      whisperLyrics,
      settings: { geminiApiKey: "dummy-key" }
    },
    {
      deps: {
        scrapeLyrics: async () => {
          throw new Error("LRCLIB request timed out after 12000ms");
        }
      }
    }
  );

  assert.equal(res.ok, true);
  assert.equal(res.source, "whisper");
  assert.equal(res.warning, "fallback_to_whisper");
  assert.equal(res.failureStage, "scrape");
  assert.equal(res.errorCode, "scrape_timeout");
  assert.equal(res.lyrics[0].text, "some lyric line");
});

test("alignAndInterpolateLyrics invalidates time reversals, splits duplicates, and interpolates gaps", async () => {
  const whisperLyrics = [
    { id: "line_001", start: 1.0, end: 5.0, text: "가나다라마바사" },
    { id: "line_002", start: 10.0, end: 13.0, text: "마지막 가사" }
  ];

  const res = await alignAndInterpolateLyrics(
    {
      track: { title: "Test Song", duration: 20 },
      whisperLyrics,
      settings: { geminiApiKey: "dummy-key" },
      embeddedLyricsLines: ["첫 번째 줄", "두 번째 줄", "중간 공백 가사", "네 번째 줄"]
    },
    {
      deps: {
        alignLyricsWithGemini: async () => [
          { official_index: 0, whisper_id: "line_001" },
          { official_index: 1, whisper_id: "line_001" }, // duplicate split
          { official_index: 2, whisper_id: "line_002" },
          { official_index: 3, whisper_id: "line_001" }  // time reversal -> invalidated & interpolated after 13.0
        ]
      }
    }
  );

  assert.equal(res.ok, true);
  assert.equal(res.source, "gemini");
  assert.equal(res.lyricsSource, "embedded");
  assert.equal(res.matchedCount, 3);
  assert.equal(res.totalCount, 4);
  assert.equal(res.lyrics.length, 4);
  assert.ok(res.lyrics[0].start === 1.0 && res.lyrics[0].end > 1.0);
  assert.ok(res.lyrics[1].start >= res.lyrics[0].end && res.lyrics[1].end <= 5.0);
  assert.equal(res.lyrics[2].start, 10.0);
  assert.equal(res.lyrics[3].start, 13.0);
  assert.equal(res.lyrics[3].end, 20);
});

test("buildModelFallbackChain preserves primary model first and deduplicates fallback models", () => {
  assert.deepEqual(GEMINI_FALLBACK_MODELS, [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
  ]);
  assert.deepEqual(buildModelFallbackChain("gemini-3.5-flash-lite"), [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
  ]);
  assert.deepEqual(buildModelFallbackChain("gemini-3.1-flash-lite"), [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
  ]);
  assert.deepEqual(buildModelFallbackChain("gemini-3.8-flash"), [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
  ]);
});

test("callGeminiApiWithRetry falls back to gemini-3.1-flash-lite on 503 high demand", async () => {
  const calledModels = [];
  const fallbacks = [];

  const result = await callGeminiApiWithRetry(
    "dummy-key",
    "contents",
    "sys",
    { type: "ARRAY" },
    "gemini-3.5-flash-lite",
    2,
    1,
    {
      generateContentFn: async ({ model }) => {
        calledModels.push(model);
        if (model === "gemini-3.5-flash-lite") {
          const err = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
          err.status = 503;
          throw err;
        }
        return { text: JSON.stringify([{ official_index: 0, whisper_id: "line_001" }]) };
      },
      onFallback: (info) => fallbacks.push(info)
    }
  );

  assert.deepEqual(calledModels, [
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
  ]);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].fromModel, "gemini-3.5-flash-lite");
  assert.equal(fallbacks[0].toModel, "gemini-3.1-flash-lite");
  assert.deepEqual(result, [{ official_index: 0, whisper_id: "line_001" }]);
});

test("callGeminiApiWithRetry fails fast on 401 API_KEY_INVALID without fallback", async () => {
  const calledModels = [];

  await assert.rejects(
    () =>
      callGeminiApiWithRetry(
        "bad-key",
        "contents",
        "sys",
        { type: "ARRAY" },
        "gemini-3.5-flash-lite",
        2,
        1,
        {
          generateContentFn: async ({ model }) => {
            calledModels.push(model);
            const err = new Error("API_KEY_INVALID");
            err.status = 401;
            throw err;
          }
        }
      ),
    /API_KEY_INVALID/
  );

  assert.deepEqual(calledModels, ["gemini-3.5-flash-lite"]);
});

test("alignAndInterpolateLyrics classifies 503 high demand errors as gemini_overloaded", async () => {
  const res = await alignAndInterpolateLyrics(
    {
      track: { title: "Test Song", duration: 120 },
      whisperLyrics: [{ id: "line_001", start: 1.0, end: 3.5, text: "test lyric" }],
      settings: { geminiApiKey: "dummy-key" },
      embeddedLyricsLines: ["official test lyric"]
    },
    {
      deps: {
        alignLyricsWithGemini: async () => {
          throw new Error("Gemini API failed across models: 503 This model is currently experiencing high demand (UNAVAILABLE)");
        }
      }
    }
  );

  assert.equal(res.ok, true);
  assert.equal(res.source, "whisper");
  assert.equal(res.warning, "fallback_to_whisper");
  assert.equal(res.failureStage, "gemini");
  assert.equal(res.errorCode, "gemini_overloaded");
});

test("buildTranscriptionPrompt omits language hint for auto/null and includes it for explicit languages", () => {
  const autoDefault = buildTranscriptionPrompt(180, null);
  const autoExplicit = buildTranscriptionPrompt(180, "auto");
  assert.doesNotMatch(autoDefault, /언어 힌트/);
  assert.doesNotMatch(autoExplicit, /언어 힌트/);
  assert.match(autoDefault, /180\.00초/);

  const jaPrompt = buildTranscriptionPrompt(210, "ja");
  assert.match(jaPrompt, /언어 힌트/);
  assert.match(jaPrompt, /일본어\(ja\)/);
  assert.match(jaPrompt, /210\.00초/);
});

test("callGeminiApiWithRetry configures temperature 0 for deterministic alignment", async () => {
  let seenConfig = null;
  await callGeminiApiWithRetry(
    "dummy-key",
    "contents",
    "sys",
    { type: "ARRAY" },
    "gemini-3.5-flash-lite",
    1,
    1,
    {
      generateContentFn: async ({ config }) => {
        seenConfig = config;
        return { text: JSON.stringify([{ official_index: 0, whisper_id: "line_001" }]) };
      }
    }
  );
  assert.equal(seenConfig.temperature, 0);
});

test("alignAndInterpolateLyrics guards non-contiguous duplicate whisper_id and anchors leading nulls before first match", async () => {
  const whisperLyrics = [
    { id: "line_001", start: 10.0, end: 13.0, text: "First matched chorus" },
    { id: "line_002", start: 20.0, end: 23.0, text: "Closing verse line" }
  ];

  const res = await alignAndInterpolateLyrics(
    {
      track: { title: "Intro & Chorus Test", duration: 30 },
      whisperLyrics,
      settings: { geminiApiKey: "dummy-key" },
      embeddedLyricsLines: [
        "Opening line after long intro",
        "First matched chorus",
        "Bridge line gap",
        "Repeated chorus mistakenly reusing line_001",
        "Closing verse line"
      ]
    },
    {
      deps: {
        alignLyricsWithGemini: async () => [
          { official_index: 0, whisper_id: null },
          { official_index: 1, whisper_id: "line_001" },
          { official_index: 2, whisper_id: null },
          { official_index: 3, whisper_id: "line_001" }, // non-contiguous duplicate -> should NOT steal split from index 1
          { official_index: 4, whisper_id: "line_002" }
        ]
      }
    }
  );

  assert.equal(res.ok, true);
  assert.equal(res.source, "gemini");
  assert.equal(res.matchedCount, 2);
  // Leading null line is anchored just before 10.0s rather than 0.0s
  assert.ok(res.lyrics[0].start >= 7.0 && res.lyrics[0].end === 10.0);
  // Index 1 retains full [10.0, 13.0] window
  assert.equal(res.lyrics[1].start, 10.0);
  assert.equal(res.lyrics[1].end, 13.0);
  // Indices 2 & 3 interpolate monotonically inside 13.0..20.0
  assert.equal(res.lyrics[2].start, 13.0);
  assert.ok(res.lyrics[3].start > 13.0 && res.lyrics[3].end === 20.0);
  assert.equal(res.lyrics[4].start, 20.0);
});
