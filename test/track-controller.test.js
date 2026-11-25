const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TrackController,
  buildLyricsSaveSnapshot,
  computeNextTrackIndex,
  applyNavigationHistory,
  computePrevTrackNavigation
} = require("../src/renderer/modules/track-controller");
const { syncShuffleQueue } = require("../src/shared/lyrics-core");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("buildLyricsSaveSnapshot clones state fields and returns null when track/lyrics are missing", () => {
  const track = { cacheKey: "k1", title: "Song A" };
  const lyrics = [{ id: "l1", start: 1, end: 3, text: "hello" }];
  const state = {
    track,
    lyrics,
    syncOffset: 0.4,
    embeddedLyricsLines: ["hello"],
    plainLyricsSource: "txt_plain"
  };

  assert.equal(buildLyricsSaveSnapshot({ track: null, lyrics }), null);
  assert.equal(buildLyricsSaveSnapshot({ track, lyrics: [] }), null);

  const snap = buildLyricsSaveSnapshot(state);
  assert.deepEqual(snap, {
    track: { cacheKey: "k1", title: "Song A" },
    lyrics: [{ id: "l1", start: 1, end: 3, text: "hello" }],
    syncOffset: 0.4,
    embeddedPlainLyrics: ["hello"],
    plainLyricsSource: "txt_plain",
    metadata: { source: "local" }
  });
  // Mutating originals does not affect snapshot
  track.title = "Mutated";
  lyrics[0].text = "Mutated";
  state.embeddedLyricsLines.push("extra");
  assert.equal(snap.track.title, "Song A");
  assert.equal(snap.lyrics[0].text, "hello");
  assert.deepEqual(snap.embeddedPlainLyrics, ["hello"]);
});

test("computeNextTrackIndex and navigation history honor forwardHistory, shuffle deck, and wrap-around", () => {
  const tracks = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const state = {
    playlist: tracks,
    currentIndex: 0,
    track: tracks[0],
    shuffle: false,
    shuffleQueue: [],
    history: [],
    forwardHistory: [2]
  };

  // forwardHistory takes precedence over sequential index
  assert.equal(computeNextTrackIndex(state, syncShuffleQueue).nextIndex, 2);

  // applyNavigationHistory consumes forwardHistory when moving "next" to matching index
  applyNavigationHistory(state, 2, "next");
  assert.deepEqual(state.history, [0]);
  assert.deepEqual(state.forwardHistory, []);

  // Going prev records forwardHistory and pops history
  state.currentIndex = 2;
  assert.equal(computePrevTrackNavigation(state), 0);
  assert.deepEqual(state.forwardHistory, [2]);

  // Wrap-around when forwardHistory empty and shuffle off
  const seqState = { playlist: tracks, currentIndex: 2, track: tracks[2], shuffle: false, shuffleQueue: [], forwardHistory: [] };
  assert.equal(computeNextTrackIndex(seqState, syncShuffleQueue).nextIndex, 0);

  // Shuffle synchronizes deck avoiding current track
  const shufState = { playlist: tracks, currentIndex: 0, track: tracks[0], shuffle: true, shuffleQueue: [], forwardHistory: [] };
  const shufRes = computeNextTrackIndex(shufState, (pl, cur) => syncShuffleQueue(pl, cur, [], () => 0.1));
  assert.notEqual(shufRes.nextIndex, 0);
  assert.ok(shufRes.shuffleQueue.length === 2);
});

test("TrackController manages per-track debounced saves, immediate overrides, and flush", () => {
  const saved = [];
  let nextTimerId = 1;
  const scheduled = new Map();
  const fakeTimers = {
    setTimeout: (fn) => {
      const id = nextTimerId++;
      scheduled.set(id, fn);
      return id;
    },
    clearTimeout: (id) => {
      scheduled.delete(id);
    }
  };

  const trackA = { cacheKey: "track-a", title: "A" };
  const trackB = { cacheKey: "track-b", title: "B" };
  const state = {
    track: trackA,
    lyrics: [{ id: "1", start: 0, end: 2, text: "A1" }],
    syncOffset: 0,
    embeddedLyricsLines: null,
    plainLyricsSource: null
  };

  const controller = new TrackController({
    state,
    api: {
      saveCachedLyrics: async (payload) => {
        saved.push(payload.track.cacheKey + ":" + payload.syncOffset);
      }
    },
    timers: fakeTimers
  });

  controller.persistLyricsSoon();
  state.syncOffset = 0.5;
  controller.persistLyricsSoon(); // replaces pending timer for track-a
  assert.equal(controller.saveTimers.size, 1);
  assert.equal(scheduled.size, 1);

  // Switch to track-b and schedule a debounced save, then immediately override track-a
  state.track = trackB;
  state.lyrics = [{ id: "2", start: 0, end: 2, text: "B1" }];
  state.syncOffset = -0.3;
  controller.persistLyricsSoon();
  assert.equal(controller.saveTimers.size, 2);

  controller.persistLyricsImmediately({
    track: trackA,
    lyrics: [{ id: "1", start: 0, end: 2, text: "A1" }],
    syncOffset: 1.0
  });
  assert.deepEqual(saved, ["track-a:1"]);
  assert.equal(controller.saveTimers.has("track-a"), false);
  assert.equal(controller.saveTimers.has("track-b"), true);

  // Flush remaining pending save
  controller.flushPendingLyricsSaves();
  assert.deepEqual(saved, ["track-a:1", "track-b:-0.3"]);
  assert.equal(controller.saveTimers.size, 0);
});

test("TrackController.selectPlaylistItem discards stale slow cache response after track switch", async () => {
  const trackA = { cacheKey: "a", title: "Song A", path: "/a.mp3" };
  const trackB = { cacheKey: "b", title: "Song B", path: "/b.mp3" };
  const deferredA = createDeferred();
  const deferredB = createDeferred();

  const state = {
    playlist: [trackA, trackB],
    currentIndex: -1,
    track: null,
    lyrics: [],
    lyricsSource: null,
    embeddedLyricsLines: null,
    plainLyricsSource: null,
    syncOffset: 0,
    activeLineId: null,
    alignSuggestedTrackKey: null,
    shuffle: false,
    shuffleQueue: [],
    history: [],
    forwardHistory: [],
    isTranscribing: false,
    settings: { autoAnalyzeMode: "off", geminiApiKey: "" }
  };

  const offsets = [];
  const statuses = [];
  const controller = new TrackController({
    state,
    player: { loadTrack: () => {}, getCurrentTime: () => 0, isPlaying: () => false },
    playlist: { saveCache: () => {}, render: () => {} },
    lyricsViewer: {
      setOffset: (o) => offsets.push(o),
      render: () => {},
      updateActive: () => {}
    },
    lyricsJobManager: { cancelActiveJob: async () => {} },
    embedManager: { updateHighlight: () => {} },
    callbacks: {
      setTrackStatusText: (msg) => statuses.push(msg),
      updateTrackStatusBadge: () => {},
      updateActionButtonsState: () => {},
      updateDeleteCacheButtonState: () => {}
    },
    api: {
      loadCachedLyrics: (track) => (track.cacheKey === "a" ? deferredA.promise : deferredB.promise)
    }
  });

  const pA = controller.selectPlaylistItem(0, true, "manual");
  const pB = controller.selectPlaylistItem(1, true, "manual");

  deferredB.resolve({
    lyrics: [{ id: "b1", start: 0, end: 2, text: "B line" }],
    syncOffset: 0.2,
    metadata: { source: "whisper" }
  });
  await pB;

  deferredA.resolve({
    lyrics: [{ id: "a1", start: 0, end: 2, text: "Stale A line" }],
    syncOffset: 9.9,
    metadata: { source: "lrc" }
  });
  await pA;

  assert.equal(state.track, trackB);
  assert.equal(state.lyrics[0].text, "B line");
  assert.equal(state.lyricsSource, "whisper");
  assert.equal(offsets.includes(9.9), false);
});

test("TrackController.selectPlaylistItem sets txt_plain state and runs auto-analyze after cancelPromise", async () => {
  const track = { cacheKey: "txt-1", title: "Txt Song", path: "/song.mp3" };
  const cancelDeferred = createDeferred();
  const analyzeCalls = [];
  let timerIdSeq = 1;
  const scheduledTimers = [];

  const state = {
    playlist: [track],
    currentIndex: -1,
    track: null,
    lyrics: [],
    lyricsSource: null,
    embeddedLyricsLines: null,
    plainLyricsSource: null,
    syncOffset: 0,
    activeLineId: null,
    alignSuggestedTrackKey: null,
    shuffle: false,
    shuffleQueue: [],
    history: [],
    forwardHistory: [],
    isTranscribing: false,
    settings: { autoAnalyzeMode: "align", geminiApiKey: "key-123" }
  };

  let statusText = "";
  const controller = new TrackController({
    state,
    player: { loadTrack: () => {}, getCurrentTime: () => 0, isPlaying: () => false },
    playlist: { saveCache: () => {}, render: () => {} },
    lyricsViewer: { setOffset: () => {}, render: () => {}, updateActive: () => {} },
    lyricsJobManager: {
      cancelActiveJob: () => cancelDeferred.promise,
      handleAnalyzeClick: (opts) => analyzeCalls.push(opts)
    },
    embedManager: { updateHighlight: () => {} },
    callbacks: {
      setTrackStatusText: (msg) => { statusText = msg; },
      updateTrackStatusBadge: () => {},
      updateActionButtonsState: () => {},
      updateDeleteCacheButtonState: () => {}
    },
    api: {
      loadCachedLyrics: async () => ({
        lyrics: [
          { id: "txt_001", start: 0, end: 0, text: "Line 1" },
          { id: "txt_002", start: 0, end: 0, text: "Line 2" },
          { id: "txt_003", start: 0, end: 0, text: "Line 3" }
        ],
        hasEmbeddedLyrics: false,
        embeddedPlainLyrics: ["Line 1", "Line 2", "Line 3"],
        plainLyricsSource: "txt_plain",
        metadata: { source: "txt_plain" }
      })
    },
    timers: {
      setTimeout: (fn) => {
        scheduledTimers.push(fn);
        return timerIdSeq++;
      },
      clearTimeout: () => {}
    }
  });

  await controller.selectPlaylistItem(0, true, "manual");
  assert.deepEqual(state.embeddedLyricsLines, ["Line 1", "Line 2", "Line 3"]);
  assert.equal(state.plainLyricsSource, "txt_plain");
  assert.equal(state.lyrics.length, 0);
  assert.match(statusText, /로컬 텍스트\(\.txt\) 가사 3줄 감지됨/);
  assert.equal(scheduledTimers.length, 1);

  const pendingAuto = scheduledTimers[0]();
  assert.equal(analyzeCalls.length, 0); // waits for cancelPromise first
  cancelDeferred.resolve();
  await pendingAuto;
  assert.deepEqual(analyzeCalls, [{ isAuto: true, expectedTrackKey: "txt-1" }]);
});
