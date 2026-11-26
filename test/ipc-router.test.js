const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { IPC_CHANNELS } = require("../src/main/ipc/channels");
const { registerIpcHandlers } = require("../src/main/core/ipc-router");

function createMockIpcMain() {
  const handleHandlers = new Map();
  const onHandlers = new Map();
  const duplicateRegistrations = [];

  return {
    handleHandlers,
    onHandlers,
    duplicateRegistrations,
    handle(channel, fn) {
      if (handleHandlers.has(channel)) {
        duplicateRegistrations.push(`handle:${channel}`);
      }
      handleHandlers.set(channel, fn);
    },
    on(channel, fn) {
      if (onHandlers.has(channel)) {
        duplicateRegistrations.push(`on:${channel}`);
      }
      onHandlers.set(channel, fn);
    },
    async invoke(channel, ...args) {
      const fn = handleHandlers.get(channel);
      if (!fn) throw new Error(`Missing handle handler for ${channel}`);
      return await fn({}, ...args);
    },
    emitOn(channel, ...args) {
      const fn = onHandlers.get(channel);
      if (!fn) throw new Error(`Missing on listener for ${channel}`);
      return fn({}, ...args);
    }
  };
}

function createMockWindow(initialState = {}) {
  const sent = [];
  let destroyed = Boolean(initialState.destroyed);
  let visible = Boolean(initialState.visible);
  let maximized = Boolean(initialState.maximized);
  let movable = initialState.movable ?? true;
  const ignoreMouseCalls = [];

  return {
    sent,
    ignoreMouseCalls,
    isDestroyed: () => destroyed,
    setDestroyed: (val) => { destroyed = val; },
    showInactive: () => { visible = true; },
    hide: () => { visible = false; },
    isVisible: () => visible,
    setMovable: (val) => { movable = val; },
    isMovable: () => movable,
    setIgnoreMouseEvents: (ignore, options) => { ignoreMouseCalls.push({ ignore, options }); },
    minimize: () => { sent.push({ method: "minimize" }); },
    maximize: () => { maximized = true; },
    unmaximize: () => { maximized = false; },
    isMaximized: () => maximized,
    close: () => { sent.push({ method: "close" }); },
    webContents: {
      send(channel, ...args) {
        sent.push({ channel, args });
      }
    }
  };
}

function createHarness(customOverrides = {}) {
  const ipcMain = createMockIpcMain();
  const mainWindow = customOverrides.mainWindow ?? createMockWindow();
  const floatingWindow = customOverrides.floatingWindow ?? createMockWindow();
  const appliedVisuals = [];

  const windowManager = customOverrides.windowManager || {
    getMainWindow: () => mainWindow,
    getFloatingWindow: () => floatingWindow,
    createFloatingWindow: async () => floatingWindow,
    applyVisualsToFloating: (settings) => {
      appliedVisuals.push(settings);
    }
  };

  const defaults = {
    ipcMain,
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: null })
    },
    app: {
      getPath: (name) => `/mock/${name}`
    },
    fs: {
      stat: async () => ({ size: 1024, mtimeMs: 123456 }),
      writeFile: async () => {}
    },
    cacheManager: {
      getTrackCacheKey: (t) => `key:${t.path}`,
      loadLyricsCache: async () => null,
      saveLyricsCache: async () => ({ ok: true }),
      deleteTrackCache: async () => ({ ok: true }),
      clearLyricsCache: async () => ({ ok: true })
    },
    settingsManager: {
      loadSettings: async () => ({ theme: "lyra" }),
      saveSettings: async (s) => ({ ...s, saved: true })
    },
    mediaHelper: {
      extractTrackMetadata: async () => ({ artist: "Artist", title: "Title", duration: 180 }),
      extractAlbumArt: async () => "data:image/png;base64,AAA",
      clearAlbumArtCache: async () => ({ ok: true })
    },
    lyricsAligner: {
      alignAndInterpolateLyrics: async () => ({ ok: true, lyrics: [] })
    },
    lyricsTagger: {
      embedLyricsToAudio: async () => ({ ok: true })
    },
    modelManager: {
      listModels: async () => [],
      downloadModel: async () => ({ ok: true }),
      cancelDownload: () => ({ ok: true }),
      deleteModel: async () => ({ ok: true })
    },
    cudaManager: {
      getCudaStatus: async () => ({ installed: false }),
      downloadCudaPack: async () => ({ ok: true }),
      cancelCudaDownload: () => ({ ok: true }),
      deleteCudaPack: async () => ({ ok: true })
    },
    vocalModelManager: {
      getVocalModelStatus: async () => ({ installed: false }),
      downloadVocalModel: async () => ({ ok: true }),
      cancelVocalModelDownload: () => ({ ok: true }),
      deleteVocalModel: async () => ({ ok: true })
    },
    startTranscription: () => ({
      promise: Promise.resolve([]),
      cancel() {}
    })
  };

  const overrides = { ...defaults, ...customOverrides, ipcMain };
  const controls = registerIpcHandlers(windowManager, overrides);

  return {
    ipcMain,
    mainWindow,
    floatingWindow,
    windowManager,
    appliedVisuals,
    controls
  };
}

test("IPC_CHANNELS matches all preload.js channels and registers every invoke/send channel cleanly", async () => {
  const preloadSrc = await fs.readFile(path.join(__dirname, "../src/main/preload.js"), "utf8");
  const invokeChannels = [...preloadSrc.matchAll(/ipcRenderer\.invoke\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const sendChannels = [...preloadSrc.matchAll(/ipcRenderer\.send\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const onChannels = [...preloadSrc.matchAll(/ipcRenderer\.(?:on|removeAllListeners)\(\s*"([^"]+)"/g)].map((m) => m[1]);

  const allPreloadChannels = new Set([...invokeChannels, ...sendChannels, ...onChannels]);
  const constantValues = Object.values(IPC_CHANNELS);

  assert.equal(constantValues.length, new Set(constantValues).size);
  assert.equal(constantValues.length, 45);

  for (const channel of allPreloadChannels) {
    assert.ok(constantValues.includes(channel), `Missing preload channel in IPC_CHANNELS: ${channel}`);
  }

  const { ipcMain } = createHarness();
  assert.deepEqual(ipcMain.duplicateRegistrations, []);

  for (const ch of invokeChannels) {
    assert.ok(ipcMain.handleHandlers.has(ch), `Unregistered ipcMain.handle channel: ${ch}`);
  }
  for (const ch of sendChannels) {
    assert.ok(ipcMain.onHandlers.has(ch), `Unregistered ipcMain.on channel: ${ch}`);
  }
});

test("track-ipc opens multi-selected tracks filtering failed stats and handles string/object metadata & prefetch", async () => {
  const prefetchCalls = [];
  const { ipcMain } = createHarness({
    dialog: {
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: ["/music/ok.mp3", "/music/missing.mp3"]
      })
    },
    fs: {
      stat: async (filePath) => {
        if (filePath.includes("missing")) throw new Error("ENOENT");
        return { size: 4096, mtimeMs: 999 };
      }
    },
    cacheManager: {
      getTrackCacheKey: (t) => `ck:${path.basename(t.path)}`,
      loadLyricsCache: async (t) => { prefetchCalls.push(`cache:${t.path}`); return null; }
    },
    mediaHelper: {
      extractTrackMetadata: async (p, ck) => {
        prefetchCalls.push(`meta:${p}:${ck}`);
        return { title: "Real Title", artist: "Singer", duration: 200 };
      },
      extractAlbumArt: async (p, ck) => {
        prefetchCalls.push(`art:${p}:${ck}`);
        return "art-url";
      }
    }
  });

  const tracks = await ipcMain.invoke(IPC_CHANNELS.TRACK_OPEN);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].title, "Real Title");
  assert.equal(tracks[0].cacheKey, "ck:ok.mp3");

  assert.equal(await ipcMain.invoke(IPC_CHANNELS.TRACK_GET_ALBUM_ART, "/music/a.mp3"), "art-url");
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.TRACK_GET_ALBUM_ART, { path: "/music/b.mp3", cacheKey: "k1" }), "art-url");
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.TRACK_GET_METADATA, {}), null);

  assert.equal(await ipcMain.invoke(IPC_CHANNELS.TRACK_PREFETCH, { path: "/music/p.mp3", cacheKey: "ckp" }), true);
  assert.equal(prefetchCalls.includes("cache:/music/p.mp3"), true);
  assert.equal(prefetchCalls.includes("art:/music/p.mp3:ckp"), true);
  assert.equal(prefetchCalls.includes("meta:/music/p.mp3:ckp"), true);
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.TRACK_PREFETCH, null), false);
});

test("lyrics-ipc handles export LRC/VTT formats and embed-to-file cache updates", async () => {
  const written = [];
  const savedCaches = [];
  let saveDialogResult = { canceled: false, filePath: "/out/song.vtt" };

  const { ipcMain } = createHarness({
    dialog: {
      showSaveDialog: async () => saveDialogResult
    },
    fs: {
      writeFile: async (filePath, content) => {
        written.push({ filePath, content });
      }
    },
    lyricsTagger: {
      embedLyricsToAudio: async (trackPath) => (
        trackPath.includes("fail") ? { ok: false, error: "ffmpeg_fail" } : { ok: true }
      )
    },
    cacheManager: {
      loadLyricsCache: async () => null,
      saveLyricsCache: async (payload) => { savedCaches.push(payload); return { ok: true }; },
      deleteTrackCache: async () => ({ ok: true })
    }
  });

  assert.deepEqual(
    await ipcMain.invoke(IPC_CHANNELS.LYRICS_EXPORT, { lyrics: [] }),
    { ok: false, error: "no_lyrics" }
  );

  const exportRes = await ipcMain.invoke(IPC_CHANNELS.LYRICS_EXPORT, {
    lyrics: [{ start: 1, end: 2, text: "Hello" }],
    format: "vtt",
    syncOffset: 0.5,
    trackTitle: "Song"
  });
  assert.deepEqual(exportRes, { ok: true, filePath: "/out/song.vtt" });
  assert.match(written[0].content, /^WEBVTT/);
  assert.match(written[0].content, /Hello/);

  saveDialogResult = { canceled: true, filePath: null };
  assert.deepEqual(
    await ipcMain.invoke(IPC_CHANNELS.LYRICS_EXPORT, { lyrics: [{ start: 0, end: 1, text: "A" }] }),
    { ok: false, cancelled: true }
  );

  assert.deepEqual(
    await ipcMain.invoke(IPC_CHANNELS.LYRICS_EMBED_TO_FILE, { lyrics: [{ text: "A" }] }),
    { ok: false, error: "no_track_path" }
  );

  const track = { path: "/music/song.mp3" };
  await ipcMain.invoke(IPC_CHANNELS.LYRICS_EMBED_TO_FILE, {
    track,
    lyrics: [{ start: 0, end: 2, text: "Line 1" }],
    syncOffset: 0
  });
  assert.equal(savedCaches.length, 1);
  assert.equal(savedCaches[0].metadata.source, "embedded_lrc");
  assert.equal(savedCaches[0].hasEmbeddedLyrics, true);

  await ipcMain.invoke(IPC_CHANNELS.LYRICS_EMBED_TO_FILE, {
    trackPath: "/music/fail.mp3",
    track,
    lyrics: [{ start: 0, end: 2, text: "Line 1" }]
  });
  assert.equal(savedCaches.length, 1);
});

test("transcription-ipc forwards progress with jobId, isolates vocal path, and blocks stale cancelled events", async () => {
  const capturedWorkerOptions = [];
  let lateProgressEmit = null;
  let resolveSlowJob = null;

  const { ipcMain, mainWindow } = createHarness({
    vocalModelManager: {
      getVocalModelStatus: async () => ({ installed: true, modelPath: "/models/vocal.onnx" })
    },
    transcribeAudioWithGemini: async (_key, _path, _dur, _model, opts) => {
      assert.equal(opts.language, "ko");
      return [{ start: 0, end: 2, text: "가사" }];
    },
    startTranscription: (_track, workerOpts, onProgress) => {
      capturedWorkerOptions.push(workerOpts);
      lateProgressEmit = onProgress;
      return {
        promise: new Promise((resolve) => {
          resolveSlowJob = resolve;
        }),
        cancel() {}
      };
    }
  });

  // 1. Gemini missing api key & happy path
  assert.deepEqual(
    await ipcMain.invoke(IPC_CHANNELS.TRANSCRIPTION_START, { track: { path: "/a.mp3" }, options: { sttEngine: "gemini" } }),
    { ok: false, error: "missing_api_key" }
  );

  const geminiRes = await ipcMain.invoke(IPC_CHANNELS.TRANSCRIPTION_START, {
    track: { path: "/a.mp3", duration: 120 },
    options: { sttEngine: "gemini", geminiApiKey: "secret", language: "ko", jobId: 77 }
  });
  assert.equal(geminiRes.ok, true);
  assert.equal(mainWindow.sent[0].channel, IPC_CHANNELS.TRANSCRIPTION_PROGRESS);
  assert.equal(mainWindow.sent[0].args[0].jobId, 77);

  // 2. Whisper vocalIsolation + cancellation blocks late progress
  mainWindow.sent.length = 0;
  const whisperPromise = ipcMain.invoke(IPC_CHANNELS.TRANSCRIPTION_START, {
    track: { path: "/b.mp3" },
    options: { vocalIsolation: true, jobId: 88 }
  });

  // Give microtask a turn so startTranscription runs after awaiting getVocalModelStatus
  await new Promise((r) => setImmediate(r));
  assert.equal(capturedWorkerOptions[0].vocalModelPath, "/models/vocal.onnx");

  await ipcMain.invoke(IPC_CHANNELS.TRANSCRIPTION_CANCEL);
  lateProgressEmit({ type: "progress", percent: 0.9 });
  assert.equal(mainWindow.sent.length, 0);

  resolveSlowJob([{ start: 0, end: 1, text: "late" }]);
  const cancelledRes = await whisperPromise;
  assert.deepEqual(cancelledRes, { ok: false, cancelled: true, error: "cancelled" });
});

test("transcription-ipc aborts superseded lyrics:align call and cleans up active controller", async () => {
  const signals = [];
  const callbacks = [];
  let resolvers = [];

  const { ipcMain, mainWindow } = createHarness({
    lyricsAligner: {
      alignAndInterpolateLyrics: (_payload, opts) => {
        signals.push(opts.signal);
        callbacks.push(opts.onProgress);
        return new Promise((resolve) => resolvers.push(resolve));
      }
    }
  });

  const p1 = ipcMain.invoke(IPC_CHANNELS.LYRICS_ALIGN, { jobId: 1 });
  const p2 = ipcMain.invoke(IPC_CHANNELS.LYRICS_ALIGN, { jobId: 2 });

  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);

  // Stale progress from aborted p1 is ignored; p2 progress is delivered
  callbacks[0]({ stage: "matching" });
  callbacks[1]({ stage: "matching" });
  assert.equal(mainWindow.sent.length, 1);
  assert.equal(mainWindow.sent[0].args[0].jobId, 2);

  resolvers[0]({ ok: false, cancelled: true });
  resolvers[1]({ ok: true, lyrics: [] });
  await Promise.all([p1, p2]);
});

test("models-ipc forwards download progress only when mainWindow is alive", async () => {
  const { ipcMain, mainWindow } = createHarness({
    modelManager: {
      listModels: async () => [{ id: "base" }],
      downloadModel: async (_id, onProgress) => {
        onProgress({ percent: 0.5 });
        return { ok: true };
      },
      cancelDownload: () => ({ ok: true }),
      deleteModel: async () => ({ ok: true })
    },
    cudaManager: {
      getCudaStatus: async () => ({ installed: true }),
      downloadCudaPack: async (onProgress) => {
        onProgress({ percent: 0.7 });
        return { ok: true };
      },
      cancelCudaDownload: () => ({ ok: true }),
      deleteCudaPack: async () => ({ ok: true })
    },
    vocalModelManager: {
      getVocalModelStatus: async () => ({ installed: true }),
      downloadVocalModel: async (onProgress) => {
        onProgress({ percent: 0.9 });
        return { ok: true };
      },
      cancelVocalModelDownload: () => ({ ok: true }),
      deleteVocalModel: async () => ({ ok: true })
    }
  });

  await ipcMain.invoke(IPC_CHANNELS.MODELS_DOWNLOAD, "base");
  await ipcMain.invoke(IPC_CHANNELS.CUDA_DOWNLOAD);
  await ipcMain.invoke(IPC_CHANNELS.VOCAL_MODEL_DOWNLOAD);

  assert.deepEqual(
    mainWindow.sent.map((entry) => entry.channel),
    [
      IPC_CHANNELS.MODELS_DOWNLOAD_PROGRESS,
      IPC_CHANNELS.CUDA_DOWNLOAD_PROGRESS,
      IPC_CHANNELS.VOCAL_MODEL_DOWNLOAD_PROGRESS
    ]
  );

  mainWindow.setDestroyed(true);
  await ipcMain.invoke(IPC_CHANNELS.MODELS_DOWNLOAD, "base");
  assert.equal(mainWindow.sent.length, 3);
});

test("window-settings-ipc toggles floating state, updates lock/visuals, clears caches, and toggles maximize", async () => {
  const { ipcMain, mainWindow, floatingWindow, appliedVisuals } = createHarness();

  assert.equal(await ipcMain.invoke(IPC_CHANNELS.FLOATING_TOGGLE, true), true);
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.FLOATING_TOGGLE, false), false);

  ipcMain.emitOn(IPC_CHANNELS.FLOATING_SET_LOCKED, true);
  assert.equal(floatingWindow.isMovable(), false);
  assert.equal(floatingWindow.sent[0].channel, IPC_CHANNELS.FLOATING_LOCKED);
  assert.deepEqual(floatingWindow.sent[0].args, [true]);

  ipcMain.emitOn(IPC_CHANNELS.FLOATING_UPDATE_LINE, { text: "Line" });
  assert.equal(floatingWindow.sent[1].channel, IPC_CHANNELS.FLOATING_LINE);

  ipcMain.emitOn(IPC_CHANNELS.FLOATING_SET_IGNORE_MOUSE, true, { forward: true });
  assert.deepEqual(floatingWindow.ignoreMouseCalls[0], { ignore: true, options: { forward: true } });

  ipcMain.emitOn(IPC_CHANNELS.PLAYBACK_COMMAND, "toggle");
  assert.equal(mainWindow.sent[0].channel, IPC_CHANNELS.PLAYBACK_COMMAND);

  const saved = await ipcMain.invoke(IPC_CHANNELS.SETTINGS_SAVE, { floatingOpacity: 0.9 });
  assert.equal(saved.saved, true);
  assert.equal(appliedVisuals.length, 1);

  assert.deepEqual(await ipcMain.invoke(IPC_CHANNELS.CACHE_CLEAR), { ok: true });
  assert.equal(await ipcMain.invoke(IPC_CHANNELS.APP_GET_DATA_PATH), "/mock/userData");

  assert.deepEqual(await ipcMain.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE), { isMaximized: true });
  assert.deepEqual(await ipcMain.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE), { isMaximized: false });

  mainWindow.setDestroyed(true);
  assert.deepEqual(await ipcMain.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE), { isMaximized: false });
});
