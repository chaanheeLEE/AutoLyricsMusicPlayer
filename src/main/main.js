const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { serializeLrc, serializeVtt } = require("../shared/lyrics-core");
const { startTranscription } = require("./services/transcription-worker");

// 서브 모듈 임포트
const cacheManager = require("./helpers/cache-manager");
const settingsManager = require("./helpers/settings-manager");
const mediaHelper = require("./helpers/media-helper");
const lyricsAligner = require("./helpers/lyrics-aligner");

let mainWindow;
let floatingWindow;
let activeJob = null;

function applyVisualsToFloating(settings) {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.webContents.send("floating:apply-visuals", {
      fontSize: settings.floatingFontSize,
      opacity: settings.floatingOpacity,
      bgColor: settings.floatingBgColor,
      fontColor: settings.floatingFontColor,
      align: settings.floatingAlign,
    });
  }
}

function createMainWindow() {
  Menu.setApplicationMenu(null);
  
  const isWindows = process.platform === "win32";
  const iconPath = path.join(__dirname, "../assets/icon.png");

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 700,
    minWidth: 940,
    minHeight: 620,
    title: "Auto Lyrics Player",
    icon: iconPath,
    backgroundColor: "#101216",
    titleBarStyle: "hidden",
    titleBarOverlay: isWindows ? {
      color: "#0b0d10",
      symbolColor: "#f4f2eb",
      height: 40
    } : false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.close();
    }
  });
}

async function createFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    return floatingWindow;
  }

  const savedBounds = await settingsManager.loadFloatingBounds();

  floatingWindow = new BrowserWindow({
    width: savedBounds?.width ?? 620,
    height: savedBounds?.height ?? 170,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 360,
    minHeight: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: "Floating Lyrics",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  floatingWindow.setAlwaysOnTop(true, "screen-saver");

  floatingWindow.loadFile(path.join(__dirname, "../renderer/floating.html"));

  floatingWindow.webContents.on("did-finish-load", async () => {
    const settings = await settingsManager.loadSettings();
    applyVisualsToFloating(settings);
  });

  let boundsTimer = null;
  function scheduleBoundsSave() {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (floatingWindow && !floatingWindow.isDestroyed()) {
        settingsManager.saveFloatingBounds(floatingWindow.getBounds()).catch(() => {});
      }
    }, 400);
  }
  floatingWindow.on("moved", scheduleBoundsSave);
  floatingWindow.on("resized", scheduleBoundsSave);

  floatingWindow.on("closed", () => {
    clearTimeout(boundsTimer);
    floatingWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("floating:closed");
    }
  });

  return floatingWindow;
}

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// IPC 핸들러 등록
ipcMain.handle("track:open", async () => {
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

  const tracks = [];
  for (const filePath of result.filePaths) {
    try {
      const stats = await fs.stat(filePath);
      const albumArt = await mediaHelper.extractAlbumArt(filePath);
      const track = {
        path: filePath,
        url: pathToFileURL(filePath).toString(),
        title: path.basename(filePath),
        size: stats.size,
        modifiedMs: stats.mtimeMs,
        albumArt
      };
      tracks.push({
        ...track,
        cacheKey: cacheManager.getTrackCacheKey(track)
      });
    } catch {
      // ignore
    }
  }
  return tracks;
});

ipcMain.handle("lyrics-cache:load", async (_event, track) => {
  return await cacheManager.loadLyricsCache(track);
});

ipcMain.handle("lyrics-cache:save", async (_event, payload) => {
  return await cacheManager.saveLyricsCache(payload);
});

ipcMain.handle("lyrics:export", async (_event, payload) => {
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

ipcMain.handle("floating:toggle", async (_event, shouldShow) => {
  const win = await createFloatingWindow();

  if (shouldShow) {
    win.showInactive();
  } else {
    win.hide();
  }

  return win.isVisible();
});

ipcMain.on("floating:update-line", (_event, payload) => {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.webContents.send("floating:line", payload);
  }
});

ipcMain.on("floating:set-locked", (_event, locked) => {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return;
  }

  floatingWindow.setMovable(!locked);
  floatingWindow.webContents.send("floating:locked", locked);
});

ipcMain.on("floating:set-ignore-mouse", (_event, ignore, options) => {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.setIgnoreMouseEvents(ignore, options);
  }
});

ipcMain.on("playback:command", (_event, command) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("playback:command", command);
  }
});

ipcMain.handle("transcription:start", async (event, payload) => {
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

      const { transcribeAudioWithGemini } = require("./services/gemini-service");

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("transcription:progress", {
          type: "progress",
          stage: "gemini_transcribing",
          percent: 0.5
        });
      }

      if (cancelled) throw new Error("cancelled");

      const lines = await transcribeAudioWithGemini(apiKey, track.path, track.duration);

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
  applyVisualsToFloating(safe);
  return safe;
});

ipcMain.handle("cache:clear", async () => {
  return await cacheManager.clearLyricsCache();
});

ipcMain.handle("app:get-data-path", () => {
  return app.getPath("userData");
});

ipcMain.handle("lyrics:align", async (_event, payload) => {
  return await lyricsAligner.alignAndInterpolateLyrics(payload);
});
