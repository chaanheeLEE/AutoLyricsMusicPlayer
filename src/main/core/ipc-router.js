const fs = require("node:fs/promises");
const { serializeLrc, serializeVtt } = require("../../shared/lyrics-core");
const { registerTrackIpc } = require("../ipc/track-ipc");
const { registerLyricsIpc } = require("../ipc/lyrics-ipc");
const { registerTranscriptionIpc } = require("../ipc/transcription-ipc");
const { registerModelsIpc } = require("../ipc/models-ipc");
const { registerWindowSettingsIpc } = require("../ipc/window-settings-ipc");

function resolveDependencies(overrides = {}) {
  const electron = (!overrides.ipcMain || !overrides.dialog || !overrides.app)
    ? require("electron")
    : null;

  return {
    ipcMain: overrides.ipcMain || electron.ipcMain,
    dialog: overrides.dialog || electron.dialog,
    app: overrides.app || electron.app,
    fs: overrides.fs || fs,
    serializeLrc: overrides.serializeLrc || serializeLrc,
    serializeVtt: overrides.serializeVtt || serializeVtt,
    startTranscription: overrides.startTranscription || require("../services/transcription-worker").startTranscription,
    cacheManager: overrides.cacheManager || require("../helpers/cache-manager"),
    settingsManager: overrides.settingsManager || require("../helpers/settings-manager"),
    mediaHelper: overrides.mediaHelper || require("../helpers/media-helper"),
    lyricsAligner: overrides.lyricsAligner || require("../helpers/lyrics-aligner"),
    lyricsTagger: overrides.lyricsTagger || require("../services/lyrics-tagger"),
    modelManager: overrides.modelManager || require("../services/model-manager"),
    cudaManager: overrides.cudaManager || require("../services/cuda-manager"),
    vocalModelManager: overrides.vocalModelManager || require("../services/vocal-model-manager"),
    transcribeAudioWithGemini: overrides.transcribeAudioWithGemini || null
  };
}

/**
 * 도메인별 IPC 핸들러를 일괄 등록하는 조립 엔트리.
 */
function registerIpcHandlers(windowManager, overrides = {}) {
  const deps = resolveDependencies(overrides);

  registerTrackIpc({
    ipcMain: deps.ipcMain,
    dialog: deps.dialog,
    windowManager,
    cacheManager: deps.cacheManager,
    mediaHelper: deps.mediaHelper,
    fs: deps.fs
  });

  registerLyricsIpc({
    ipcMain: deps.ipcMain,
    dialog: deps.dialog,
    windowManager,
    cacheManager: deps.cacheManager,
    lyricsTagger: deps.lyricsTagger,
    serializeLrc: deps.serializeLrc,
    serializeVtt: deps.serializeVtt,
    fs: deps.fs
  });

  const transcriptionControls = registerTranscriptionIpc({
    ipcMain: deps.ipcMain,
    windowManager,
    startTranscription: deps.startTranscription,
    vocalModelManager: deps.vocalModelManager,
    lyricsAligner: deps.lyricsAligner,
    transcribeAudioWithGemini: deps.transcribeAudioWithGemini
  });

  registerModelsIpc({
    ipcMain: deps.ipcMain,
    windowManager,
    modelManager: deps.modelManager,
    cudaManager: deps.cudaManager,
    vocalModelManager: deps.vocalModelManager
  });

  registerWindowSettingsIpc({
    ipcMain: deps.ipcMain,
    app: deps.app,
    windowManager,
    settingsManager: deps.settingsManager,
    cacheManager: deps.cacheManager,
    mediaHelper: deps.mediaHelper
  });

  return transcriptionControls;
}

module.exports = {
  registerIpcHandlers
};
