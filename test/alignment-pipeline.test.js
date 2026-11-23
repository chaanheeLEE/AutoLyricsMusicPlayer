const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSearchQueries,
  calculateBigramSimilarity,
} = require("../src/main/services/lyrics-scraper");
const {
  alignAndInterpolateLyrics,
} = require("../src/main/helpers/lyrics-aligner");

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
