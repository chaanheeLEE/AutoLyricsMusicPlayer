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

let activeJob = null;

async function createTrackObject(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const track = {
      path: filePath,
      url: pathToFileURL(filePath).toString(),
      title: path.basename(filePath),
      size: stats.size,
      modifiedMs: stats.mtimeMs,
      albumArt: null
    };
    return {
      ...track,
      cacheKey: cacheManager.getTrackCacheKey(track)
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

  ipcMain.handle("track:prefetch", async (_event, track) => {
    if (!track?.path) return false;
    try {
      await Promise.all([
        cacheManager.loadLyricsCache(track),
        mediaHelper.extractAlbumArt(track.path, track.cacheKey)
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
    if (activeJob) {
      activeJob.cancel();
      activeJob = null;
    }

    const track = payload?.track;
    const options = payload?.options || {};

    if (!track?.path) {
      return { ok: false, error: "missing_track_path" };
    }

    if (options.sttEngine === "gemini") {
      const apiKey = options.geminiApiKey;
      if (!apiKey || !apiKey.trim()) {
        return { ok: false, error: "missing_api_key" };
      }

      let cancelled = false;
      activeJob = {
        cancel() {
          cancelled = true;
        }
      };

      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("transcription:progress", {
            type: "progress",
            stage: "gemini_uploading",
            percent: 0.2
          });
        }

        if (cancelled) throw new Error("cancelled");

        const { transcribeAudioWithGemini } = require("../services/gemini-service");

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("transcription:progress", {
            type: "progress",
            stage: "gemini_transcribing",
            percent: 0.5
          });
        }

        if (cancelled) throw new Error("cancelled");

        const lines = await transcribeAudioWithGemini(apiKey, track.path, track.duration, options.geminiModel || "gemini-3.1-flash-lite");

        if (cancelled) throw new Error("cancelled");

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("transcription:progress", {
            type: "progress",
            stage: "saving",
            percent: 1.0
          });
        }

        activeJob = null;
        return { ok: true, lyrics: lines };
      } catch (err) {
        activeJob = null;
        if (err.message === "cancelled") {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("transcription:progress", {
              type: "progress",
              stage: "cancelled"
            });
          }
          return { ok: false, error: "cancelled" };
        }
        return { ok: false, error: err.message };
      }
    }

    return new Promise((resolve) => {
      const job = startTranscription(track, options, (msg) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("transcription:progress", msg);
        }
      });

      activeJob = job;

      job.promise
        .then((lines) => {
          activeJob = null;
          resolve({ ok: true, lyrics: lines });
        })
        .catch((err) => {
          activeJob = null;
          resolve({ ok: false, error: err.message });
        });
    });
  });

  ipcMain.handle("transcription:cancel", () => {
    if (activeJob) {
      activeJob.cancel();
      activeJob = null;
    }
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
    return await lyricsAligner.alignAndInterpolateLyrics(payload);
  });
}

module.exports = {
  registerIpcHandlers
};
