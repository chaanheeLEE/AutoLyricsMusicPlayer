const fsDefault = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { IPC_CHANNELS } = require("./channels");

function parseTrackPayload(payload) {
  return {
    filePath: typeof payload === "string" ? payload : payload?.path,
    cacheKey: typeof payload === "object" && payload !== null ? payload.cacheKey : null
  };
}

/**
 * 로컬 오디오 파일 경로로부터 트랙 객체(메타데이터·캐시키 포함)를 생성합니다.
 */
async function createTrackObject(filePath, { fs = fsDefault, cacheManager, mediaHelper }) {
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

/**
 * 트랙 열기·앨범아트·메타데이터·프리페치 IPC 핸들러를 등록합니다.
 */
function registerTrackIpc({ ipcMain, dialog, windowManager, cacheManager, mediaHelper, fs = fsDefault }) {
  ipcMain.handle(IPC_CHANNELS.TRACK_OPEN, async () => {
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
      result.filePaths.map((filePath) => createTrackObject(filePath, { fs, cacheManager, mediaHelper }))
    )).filter(Boolean);

    return tracks;
  });

  ipcMain.handle(IPC_CHANNELS.TRACK_GET_ALBUM_ART, async (_event, payload) => {
    const { filePath, cacheKey } = parseTrackPayload(payload);
    if (!filePath) return null;
    try {
      return await mediaHelper.extractAlbumArt(filePath, cacheKey);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRACK_GET_METADATA, async (_event, payload) => {
    const { filePath, cacheKey } = parseTrackPayload(payload);
    if (!filePath) return null;
    try {
      return await mediaHelper.extractTrackMetadata(filePath, cacheKey);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.TRACK_PREFETCH, async (_event, track) => {
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
}

module.exports = {
  createTrackObject,
  registerTrackIpc
};
