const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LyricsJobManager,
  normalizeDeviceLabel,
  isProgressMessageForJob,
  formatProgressMessage,
  formatAlignFallbackMessage,
  buildOpeningPromptHint,
  resolveAdaptiveBeamSize,
  resolvePersistedPlainLyrics
} = require("../src/renderer/modules/lyrics-job-manager");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeEl() {
  const classes = new Set();
  return {
    style: {},
    disabled: false,
    textContent: "",
    classList: {
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    addEventListener: () => {}
  };
}

function createTestHarness(track = { cacheKey: "k1", title: "Song 1", duration: 180 }) {
  let progressListener = null;
  const elements = {
    "#trackStatus": createFakeEl(),
    "#transcriptionProgress": createFakeEl(),
    "#progressLabel": createFakeEl(),
    "#progressBar": createFakeEl(),
    "#mainTranscriptionProgress": createFakeEl(),
    "#mainProgressLabel": createFakeEl(),
    "#mainProgressBar": createFakeEl()
  };

  const state = {
    track,
    lyrics: [],
    lyricsSource: null,
    embeddedLyricsLines: null,
    plainLyricsSource: null,
    isTranscribing: false,
    isAutoAnalyzing: false,
    alignSuggestedTrackKey: null,
    settings: {
      sttEngine: "whisper",
      model: "base",
      geminiApiKey: "api-key",
      autoAnalyzeMode: "off"
    }
  };

  const persisted = [];
  const startCalls = [];
  const alignCalls = [];
  let cancelCount = 0;

  let nextStartHandler = async () => ({ ok: true, lyrics: [] });
  let nextAlignHandler = async () => ({ ok: true, lyrics: [] });

  const api = {
    onTranscriptionProgress: (fn) => {
      progressListener = fn;
    },
    startTranscription: (targetTrack, options) => {
      startCalls.push({ track: targetTrack, options });
      return nextStartHandler(targetTrack, options);
    },
    alignLyrics: (payload) => {
      alignCalls.push(payload);
      return nextAlignHandler(payload);
    },
    cancelTranscription: async () => {
      cancelCount += 1;
    },
    saveCachedLyrics: async (payload) => {
      persisted.push(payload);
    }
  };

  const manager = new LyricsJobManager(
    state,
    { getDuration: () => track.duration || 180, getCurrentTime: () => 0, isPlaying: () => false },
    { setOffset: () => {}, render: () => {}, updateActive: () => {} },
    { open: () => {} },
    {
      persistLyricsImmediately: async (payload) => {
        persisted.push(payload);
      },
      updateAnalyzeButtonState: () => {},
      updateAlignButtonState: () => {},
      updateVocalIsolationChipUI: () => {},
      updateTrackStatusBadge: () => {},
      updateDeleteCacheButtonState: () => {}
    },
    {
      doc: { querySelector: (sel) => elements[sel] || null },
      api
    }
  );

  return {
    state,
    elements,
    persisted,
    startCalls,
    alignCalls,
    getCancelCount: () => cancelCount,
    emitProgress: (msg) => progressListener?.(msg),
    setStartHandler: (fn) => { nextStartHandler = fn; },
    setAlignHandler: (fn) => { nextAlignHandler = fn; },
    manager
  };
}

test("pure job helpers normalize devices, filter jobIds, format progress/errors, and resolve beamSize & hints", () => {
  assert.equal(normalizeDeviceLabel("CUDAExecutionProvider"), "GPU");
  assert.equal(normalizeDeviceLabel("DmlExecutionProvider"), "GPU");
  assert.equal(normalizeDeviceLabel("cpu"), "CPU");
  assert.equal(normalizeDeviceLabel(null), "");

  assert.equal(isProgressMessageForJob({ jobId: 2 }, 0), false);
  assert.equal(isProgressMessageForJob({ jobId: 2 }, 2), true);
  assert.equal(isProgressMessageForJob({ jobId: 1 }, 2), false);
  assert.equal(isProgressMessageForJob({ type: "progress", stage: "converting" }, 2), true);

  assert.deepEqual(
    formatProgressMessage({ type: "progress", stage: "isolating_vocals", deviceLabel: "dml", percent: 0.4 }),
    { kind: "progress", label: "보컬 분리 중… [GPU]", percent: 0.4 }
  );
  assert.deepEqual(
    formatProgressMessage({ type: "segment", id: "line_005" }),
    { kind: "progress", label: "가사 수신 중… (line_005)", percent: 0.9 }
  );
  assert.deepEqual(
    formatProgressMessage({ type: "error", message: "boom" }),
    { kind: "error", message: "boom" }
  );

  assert.match(formatAlignFallbackMessage({ errorCode: "gemini_overloaded" }), /503/);
  assert.equal(formatAlignFallbackMessage({ errorMessage: "custom failure" }), "AI Alignment Failed: custom failure");

  assert.equal(
    buildOpeningPromptHint(["[Verse 1]", "  First line ", "(chorus)", "Second line", "Third line", "Fourth line", "Fifth"]),
    "First line Second line Third line Fourth line"
  );
  assert.equal(buildOpeningPromptHint([]), null);

  assert.equal(resolveAdaptiveBeamSize({ explicitBeamSize: 5, isAuto: true, autoAnalyzeMode: "align", geminiApiKey: "k" }), 5);
  assert.equal(resolveAdaptiveBeamSize({ isAuto: true, autoAnalyzeMode: "align", geminiApiKey: "k", hasPlainLyrics: false }), 2);
  assert.equal(resolveAdaptiveBeamSize({ isAuto: false, autoAnalyzeMode: "off", geminiApiKey: "", hasPlainLyrics: true }), 2);
  assert.equal(resolveAdaptiveBeamSize({ isAuto: false, autoAnalyzeMode: "off", geminiApiKey: "", hasPlainLyrics: false }), 3);

  assert.deepEqual(
    resolvePersistedPlainLyrics(["a", "b"], "txt_plain", ["x"]),
    { lines: ["a", "b"], source: "txt_plain" }
  );
  assert.deepEqual(
    resolvePersistedPlainLyrics(null, null, ["x", "y"]),
    { lines: ["x", "y"], source: "lrclib_cached" }
  );
  assert.deepEqual(resolvePersistedPlainLyrics(null, null, null), { lines: null, source: null });
});

test("handleAnalyzeClick completes manual transcription, saves cache, and suggests AI alignment", async () => {
  const h = createTestHarness({ cacheKey: "trk-1", title: "Track 1", duration: 200 });
  const generatedLyrics = [{ id: "line_001", start: 1, end: 4, text: "Hello world" }];
  h.setStartHandler(async () => ({ ok: true, lyrics: generatedLyrics }));

  await h.manager.handleAnalyzeClick({ isAuto: false });

  assert.equal(h.startCalls[0].options.beamSize, 3);
  assert.equal(h.state.lyricsSource, "whisper");
  assert.equal(h.state.alignSuggestedTrackKey, "trk-1");
  assert.equal(h.state.isTranscribing, false);
  assert.equal(h.persisted.length, 1);
  assert.equal(h.persisted[0].metadata.source, "whisper");
  assert.match(h.elements["#trackStatus"].textContent, /1차 분석 완료 \(1줄\)/);
});

test("auto-analyze chains into AI alignment, sets beamSize 2, and preserves lrclib_cached source", async () => {
  const h = createTestHarness({ cacheKey: "trk-auto", title: "Auto Song", duration: 190 });
  h.state.settings.autoAnalyzeMode = "align";
  const whisperLines = [{ id: "line_001", start: 1, end: 3, text: "rough line" }];
  const alignedLines = [{ id: "align_001", start: 1, end: 3, text: "Official Line" }];
  const scrapedLines = ["Official Line", "Line 2", "Line 3"];

  h.setStartHandler(async () => ({ ok: true, lyrics: whisperLines }));
  h.setAlignHandler(async () => ({
    ok: true,
    source: "gemini",
    lyricsSource: "lrclib",
    lyrics: alignedLines,
    officialLyricsLines: scrapedLines
  }));

  await h.manager.handleAnalyzeClick({ isAuto: true, expectedTrackKey: "trk-auto" });

  assert.equal(h.startCalls[0].options.beamSize, 2);
  assert.equal(h.alignCalls.length, 1);
  assert.equal(h.state.lyricsSource, "gemini_align");
  assert.deepEqual(h.state.embeddedLyricsLines, scrapedLines);
  assert.equal(h.state.plainLyricsSource, "lrclib_cached");
  assert.equal(h.persisted.length, 2);
  assert.equal(h.persisted[1].plainLyricsSource, "lrclib_cached");
  assert.match(h.elements["#trackStatus"].textContent, /웹 공식 가사 기준/);
});

test("alignment fallback preserves whisper lyrics, suggests retry, and caches newly scraped plain lyrics", async () => {
  const h = createTestHarness({ cacheKey: "trk-fb", title: "Fallback Song", duration: 160 });
  h.state.lyrics = [{ id: "line_001", start: 1, end: 4, text: "whisper text" }];
  h.setAlignHandler(async () => ({
    ok: true,
    source: "whisper",
    warning: "fallback_to_whisper",
    failureStage: "gemini",
    errorCode: "gemini_overloaded",
    lyrics: [{ id: "line_001", start: 1, end: 4, text: "whisper text" }],
    officialLyricsLines: ["Official 1", "Official 2"]
  }));

  await h.manager.handleAlignClick();

  assert.equal(h.state.lyricsSource, "whisper");
  assert.equal(h.state.alignSuggestedTrackKey, "trk-fb");
  assert.equal(h.state.plainLyricsSource, "lrclib_cached");
  assert.match(h.elements["#trackStatus"].textContent, /503/);
  assert.equal(h.persisted.length, 1);
  assert.equal(h.persisted[0].plainLyricsSource, "lrclib_cached");
});

test("switching track mid-job saves stale result safely to original track without polluting new track or job", async () => {
  const trackA = { cacheKey: "track-a", title: "Song A", duration: 150 };
  const trackB = { cacheKey: "track-b", title: "Song B", duration: 210 };
  const h = createTestHarness(trackA);
  const deferredA = createDeferred();
  const deferredB = createDeferred();

  let callIdx = 0;
  h.setStartHandler(() => (callIdx++ === 0 ? deferredA.promise : deferredB.promise));

  // Start Job 1 on track A
  const jobA = h.manager.handleAnalyzeClick({ isAuto: false });
  const jobIdA = h.manager.activeJobId;

  // Cancel & switch to track B, start Job 2
  await h.manager.cancelActiveJob({ silent: true });
  h.state.track = trackB;
  const jobB = h.manager.handleAnalyzeClick({ isAuto: false });
  const jobIdB = h.manager.activeJobId;
  assert.notEqual(jobIdA, jobIdB);

  // Stale progress/error for jobIdA is ignored
  h.emitProgress({ type: "error", jobId: jobIdA, message: "stale A error" });
  assert.equal(h.elements["#trackStatus"].textContent, "Analyzing…");

  // Stale completion for Track A saves to Track A cache, does NOT overwrite active Track B UI/job
  deferredA.resolve({
    ok: true,
    lyrics: [{ id: "line_001", start: 1, end: 3, text: "Track A lyrics" }]
  });
  await jobA;

  assert.equal(h.manager.activeJobId, jobIdB);
  assert.equal(h.state.isTranscribing, true);
  assert.equal(h.state.lyrics.length, 0);
  assert.equal(h.persisted.length, 1);
  assert.equal(h.persisted[0].track.cacheKey, "track-a");

  // Complete Job 2 on Track B
  deferredB.resolve({
    ok: true,
    lyrics: [{ id: "line_001", start: 2, end: 5, text: "Track B lyrics" }]
  });
  await jobB;

  assert.equal(h.manager.activeJobId, null);
  assert.equal(h.state.lyrics[0].text, "Track B lyrics");
  assert.equal(h.persisted.length, 2);
  assert.equal(h.persisted[1].track.cacheKey, "track-b");
});
