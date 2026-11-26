const fsDefault = require("node:fs/promises");
const { IPC_CHANNELS } = require("./channels");

/**
 * 가사 캐시, 내보내기(.lrc/.vtt), 음원 태그 임베딩 IPC 핸들러를 등록합니다.
 */
function registerLyricsIpc({
  ipcMain,
  dialog,
  windowManager,
  cacheManager,
  lyricsTagger,
  serializeLrc,
  serializeVtt,
  fs = fsDefault
}) {
  ipcMain.handle(IPC_CHANNELS.LYRICS_CACHE_LOAD, async (_event, track) => {
    return await cacheManager.loadLyricsCache(track);
  });

  ipcMain.handle(IPC_CHANNELS.LYRICS_CACHE_SAVE, async (_event, payload) => {
    return await cacheManager.saveLyricsCache(payload);
  });

  ipcMain.handle(IPC_CHANNELS.LYRICS_CACHE_DELETE_TRACK, async (_event, track) => {
    return await cacheManager.deleteTrackCache(track);
  });

  ipcMain.handle(IPC_CHANNELS.LYRICS_EXPORT, async (_event, payload) => {
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

  ipcMain.handle(IPC_CHANNELS.LYRICS_EMBED_TO_FILE, async (_event, payload) => {
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
        embeddedPlainLyrics: lyrics.map((l) => (typeof l === "string" ? l : l.text)),
        metadata: { source: "embedded_lrc", updatedAt: new Date().toISOString() }
      });
    }
    return res;
  });
}

module.exports = {
  registerLyricsIpc
};
