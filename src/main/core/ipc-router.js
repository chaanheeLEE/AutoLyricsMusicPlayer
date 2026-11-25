const { ipcMain, dialog, app } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { serializeLrc, serializeVtt } = require("../../shared/lyrics-core");
const { startTranscription } = require("../services/transcription-worker");

// 서브 모듈 임포트
const cacheManager = require("../helpers/cache-manager");
const settingsManager = require("../helpers/settings-manager");
const mediaHelper = require("../helpers/media-helper");
const lyricsAligner = require("../helpers/lyrics-aligner");
const lyricsTagger = require("../services/lyrics-tagger");
const modelManager = require("../services/model-manager");
const cudaManager = require("../services/cuda-manager");
const vocalModelManager = require("../services/vocal-model-manager");

let activeTranscriptionJob = null;
let activeAlignController = null;

function cancelAllActiveJobs() {
  if (activeTranscriptionJob) {
    activeTranscriptionJob.cancel();
    activeTranscriptionJob = null;
  }
  if (activeAlignController) {
    activeAlignController.abort();
    activeAlignController = null;
  }
}

async function createTrackObject(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const baseTrack = {
      path: filePath,
      url: pathToFileURL(filePath).toString(),
      fileName,
      title: fileName,
      size: stats.size,
      modifiedMs: stats.mtimeMs,
      albumArt: null
    };
    const cacheKey = cacheManager.getTrackCacheKey(baseTrack);
    const metadata = await mediaHelper.extractTrackMetadata(filePath, cacheKey).catch(() => null);
    return {
      ...baseTrack,
      ...(metadata || {}),
      cacheKey
    };
  } catch {
    return null;
  }
}

function registerIpcHandlers(windowManager) {
  ipcMain.handle("track:open", async () => {
    const mainWindow = windowManager.getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open audio file(s)",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    const tracks = (await Promise.all(
      result.filePaths.map((filePath) => createTrackObject(filePath))
    )).filter(Boolean);

    return tracks;
  });

  ipcMain.handle("track:get-album-art", async (_event, payload) => {
    const filePath = typeof payload === "string" ? payload : payload?.path;
    const cacheKey = typeof payload === "object" ? payload?.cacheKey : null;
    if (!filePath) return null;
    try {
      return await mediaHelper.extractAlbumArt(filePath, cacheKey);
    } catch {
      return null;
    }
  });

  ipcMain.handle("track:get-metadata", async (_event, payload) => {
    const filePath = typeof payload === "string" ? payload : payload?.path;
    const cacheKey = typeof payload === "object" ? payload?.cacheKey : null;
    if (!filePath) return null;
    try {
      return await mediaHelper.extractTrackMetadata(filePath, cacheKey);
    } catch {
      return null;
    }
  });

  ipcMain.handle("track:prefetch", async (_event, track) => {
    if (!track?.path) return false;
    try {
      await Promise.all([
        cacheManager.loadLyricsCache(track),
        mediaHelper.extractAlbumArt(track.path, track.cacheKey),
        mediaHelper.extractTrackMetadata(track.path, track.cacheKey)
      ]);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("lyrics-cache:load", async (_event, track) => {
    return await cacheManager.loadLyricsCache(track);
  });

  ipcMain.handle("lyrics-cache:save", async (_event, payload) => {
    return await cacheManager.saveLyricsCache(payload);
  });

  ipcMain.handle("lyrics-cache:delete-track", async (_event, track) => {
    return await cacheManager.deleteTrackCache(track);
  });

  ipcMain.handle("lyrics:export", async (_event, payload) => {
    const mainWindow = windowManager.getMainWindow();
    const lyrics = payload?.lyrics || [];
    const format = payload?.format;
    const syncOffset = Number(payload?.syncOffset) || 0;

    if (lyrics.length === 0) {
      return { ok: false, error: "no_lyrics" };
    }

    const extension = format === "vtt" ? "vtt" : "lrc";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Export ${extension.toUpperCase()}`,
      defaultPath: `${payload.trackTitle || "lyrics"}.${extension}`,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, cancelled: true };
    }

    const contents = extension === "vtt" ? serializeVtt(lyrics, syncOffset) : serializeLrc(lyrics, syncOffset);
    await fs.writeFile(result.filePath, contents, "utf8");
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("lyrics:embed-to-file", async (_event, payload) => {
    const trackPath = payload?.trackPath || payload?.track?.path;
    const lyrics = payload?.lyrics || [];
    const syncOffset = Number(payload?.syncOffset) || 0;

    if (!trackPath) {
      return { ok: false, error: "no_track_path" };
    }
    if (!Array.isArray(lyrics) || lyrics.length === 0) {
      return { ok: false, error: "no_lyrics" };
    }

    const res = await lyricsTagger.embedLyricsToAudio(trackPath, lyrics, syncOffset);
    if (res.ok && payload?.track) {
      await cacheManager.saveLyricsCache({
        track: payload.track,
        lyrics,
        syncOffset,
        hasEmbeddedLyrics: true,
        embeddedPlainLyrics: lyrics.map(l => typeof l === "string" ? l : l.text),
        metadata: { source: "embedded_lrc", updatedAt: new Date().toISOString() }
      });
    }
    return res;
  });

  ipcMain.handle("floating:toggle", async (_event, shouldShow) => {
    const win = await windowManager.createFloatingWindow();

    if (shouldShow) {
      win.showInactive();
    } else {
      win.hide();
    }

    return win.isVisible();
  });

  ipcMain.on("floating:update-line", (_event, payload) => {
    const floatingWindow = windowManager.getFloatingWindow();
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.webContents.send("floating:line", payload);
    }
  });

  ipcMain.on("floating:set-locked", (_event, locked) => {
    const floatingWindow = windowManager.getFloatingWindow();
    if (!floatingWindow || floatingWindow.isDestroyed()) {
      return;
    }

    floatingWindow.setMovable(!locked);
    floatingWindow.webContents.send("floating:locked", locked);
  });

  ipcMain.on("floating:set-ignore-mouse", (_event, ignore, options) => {
    const floatingWindow = windowManager.getFloatingWindow();
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.setIgnoreMouseEvents(ignore, options);
    }
  });

  ipcMain.on("playback:command", (_event, command) => {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("playback:command", command);
    }
  });

  ipcMain.handle("transcription:start", async (event, payload) => {
    const mainWindow = windowManager.getMainWindow();
    cancelAllActiveJobs();

    const track = payload?.track;
    const options = payload?.options || {};
    const jobId = options.jobId ?? null;

    const sendJobProgress = (jobRef, msg) => {
      if (activeTranscriptionJob === jobRef && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("transcription:progress", { ...msg, jobId });
      }
    };

    if (!track?.path) {
      return { ok: false, error: "missing_track_path" };
    }

    if (options.sttEngine === "gemini") {
      const apiKey = options.geminiApiKey;
      if (!apiKey || !apiKey.trim()) {
        return { ok: false, error: "missing_api_key" };
      }

      const abortController = new AbortController();
      const jobRef = {
        cancel() {
          abortController.abort();
        }
      };
      activeTranscriptionJob = jobRef;

      try {
        sendJobProgress(jobRef, {
          type: "progress",
          stage: "gemini_uploading",
          percent: 0.2
        });

        if (abortController.signal.aborted) {
          return { ok: false, cancelled: true, error: "cancelled" };
        }

        const { transcribeAudioWithGemini } = require("../services/gemini-service");

        sendJobProgress(jobRef, {
          type: "progress",
          stage: "gemini_transcribing",
          percent: 0.5
        });

        const lines = await transcribeAudioWithGemini(
          apiKey,
          track.path,
          track.duration,
          options.geminiModel || "gemini-3.5-flash-lite",
          {
            signal: abortController.signal,
            language: options.language || null
          }
        );

        if (abortController.signal.aborted) {
          return { ok: false, cancelled: true, error: "cancelled" };
        }

        sendJobProgress(jobRef, {
          type: "progress",
          stage: "saving",
          percent: 1.0
        });

        return { ok: true, lyrics: lines };
      } catch (err) {
        if (err?.cancelled || err?.message === "cancelled" || abortController.signal.aborted) {
          return { ok: false, cancelled: true, error: "cancelled" };
        }
        return { ok: false, error: err.message };
      } finally {
        if (activeTranscriptionJob === jobRef) {
          activeTranscriptionJob = null;
        }
      }
    }

    const workerOptions = { ...options };
    if (workerOptions.vocalIsolation) {
      const vocalStatus = await vocalModelManager.getVocalModelStatus();
      if (vocalStatus.installed) {
        workerOptions.vocalModelPath = vocalStatus.modelPath;
      } else {
        workerOptions.vocalIsolation = false;
      }
    }

    return new Promise((resolve) => {
      let jobCancelled = false;
      const jobHolder = {
        job: null,
        cancel() {
          jobCancelled = true;
          if (this.job) {
            this.job.cancel();
          }
        }
      };
      activeTranscriptionJob = jobHolder;

      jobHolder.job = startTranscription(track, workerOptions, (msg) => {
        if (!jobCancelled) {
          sendJobProgress(jobHolder, msg);
        }
      });

      jobHolder.job.promise
        .then((lines) => {
          if (activeTranscriptionJob === jobHolder) {
            activeTranscriptionJob = null;
          }
          if (jobCancelled) {
            resolve({ ok: false, cancelled: true, error: "cancelled" });
            return;
          }
          resolve({ ok: true, lyrics: lines });
        })
        .catch((err) => {
          if (activeTranscriptionJob === jobHolder) {
            activeTranscriptionJob = null;
          }
          if (jobCancelled || err?.cancelled || err?.message === "cancelled") {
            resolve({ ok: false, cancelled: true, error: "cancelled" });
            return;
          }
          resolve({ ok: false, error: err.message });
        });
    });
  });

  ipcMain.handle("transcription:cancel", () => {
    cancelAllActiveJobs();
    return { ok: true };
  });

  ipcMain.handle("settings:load", () => {
    return settingsManager.loadSettings();
  });

  ipcMain.handle("settings:save", async (_event, settings) => {
    const safe = await settingsManager.saveSettings(settings);
    windowManager.applyVisualsToFloating(safe);
    return safe;
  });

  ipcMain.handle("cache:clear", async () => {
    const res1 = await cacheManager.clearLyricsCache();
    const res2 = await mediaHelper.clearAlbumArtCache();
    return { ok: res1.ok && res2.ok };
  });

  ipcMain.handle("app:get-data-path", () => {
    return app.getPath("userData");
  });

  ipcMain.handle("lyrics:align", async (_event, payload) => {
    const mainWindow = windowManager.getMainWindow();
    if (activeAlignController) {
      activeAlignController.abort();
      activeAlignController = null;
    }

    const abortController = new AbortController();
    activeAlignController = abortController;
    const jobId = payload?.jobId ?? null;

    try {
      return await lyricsAligner.alignAndInterpolateLyrics(payload, {
        signal: abortController.signal,
        onProgress: (msg) => {
          if (
            !abortController.signal.aborted &&
            activeAlignController === abortController &&
            mainWindow &&
            !mainWindow.isDestroyed()
          ) {
            mainWindow.webContents.send("transcription:progress", { ...msg, jobId });
          }
        }
      });
    } finally {
      if (activeAlignController === abortController) {
        activeAlignController = null;
      }
    }
  });

  // Whisper 모델 관리 IPC
  ipcMain.handle("models:list", async () => {
    return await modelManager.listModels();
  });

  ipcMain.handle("models:download", async (_event, modelId) => {
    const mainWindow = windowManager.getMainWindow();
    return await modelManager.downloadModel(modelId, (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("models:download-progress", msg);
      }
    });
  });

  ipcMain.handle("models:cancel-download", () => {
    return modelManager.cancelDownload();
  });

  ipcMain.handle("models:delete", async (_event, modelId) => {
    return await modelManager.deleteModel(modelId);
  });

  // CUDA GPU 가속 팩 관리 IPC
  ipcMain.handle("cuda:status", async () => {
    return await cudaManager.getCudaStatus();
  });

  ipcMain.handle("cuda:download", async () => {
    const mainWindow = windowManager.getMainWindow();
    return await cudaManager.downloadCudaPack((msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("cuda:download-progress", msg);
      }
    });
  });

  ipcMain.handle("cuda:cancel-download", () => {
    return cudaManager.cancelCudaDownload();
  });

  ipcMain.handle("cuda:delete", async () => {
    return await cudaManager.deleteCudaPack();
  });

  // ONNX 보컬 분리 모델 관리 IPC
  ipcMain.handle("vocal-model:status", async () => {
    return await vocalModelManager.getVocalModelStatus();
  });

  ipcMain.handle("vocal-model:download", async () => {
    const mainWindow = windowManager.getMainWindow();
    return await vocalModelManager.downloadVocalModel((msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("vocal-model:download-progress", msg);
      }
    });
  });

  ipcMain.handle("vocal-model:cancel-download", () => {
    return vocalModelManager.cancelVocalModelDownload();
  });

  ipcMain.handle("vocal-model:delete", async () => {
    return await vocalModelManager.deleteVocalModel();
  });

  // 커스텀 윈도우 제어 IPC
  ipcMain.handle("window:minimize", () => {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.handle("window:toggle-maximize", () => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return { isMaximized: false };
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { isMaximized: mainWindow.isMaximized() };
  });

  ipcMain.handle("window:close", () => {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
}

module.exports = {
  registerIpcHandlers
};
