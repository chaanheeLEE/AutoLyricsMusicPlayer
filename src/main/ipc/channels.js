/**
 * Main ↔ Renderer IPC 채널 상수 일원화 모듈.
 * 참고: preload.js는 contextIsolation/sandbox 환경에서 로컬 require 제한이 있을 수 있으므로
 * test/ipc-router.test.js에서 preload.js의 채널 문자열과 IPC_CHANNELS 정합성을 검증합니다.
 */
const IPC_CHANNELS = Object.freeze({
  // Track / Media
  TRACK_OPEN: "track:open",
  TRACK_GET_ALBUM_ART: "track:get-album-art",
  TRACK_GET_METADATA: "track:get-metadata",
  TRACK_PREFETCH: "track:prefetch",

  // Lyrics Cache / Export / Embed
  LYRICS_CACHE_LOAD: "lyrics-cache:load",
  LYRICS_CACHE_SAVE: "lyrics-cache:save",
  LYRICS_CACHE_DELETE_TRACK: "lyrics-cache:delete-track",
  LYRICS_EXPORT: "lyrics:export",
  LYRICS_EMBED_TO_FILE: "lyrics:embed-to-file",

  // Transcription / Align
  TRANSCRIPTION_START: "transcription:start",
  TRANSCRIPTION_CANCEL: "transcription:cancel",
  TRANSCRIPTION_PROGRESS: "transcription:progress",
  LYRICS_ALIGN: "lyrics:align",

  // Models / CUDA / Vocal Separation
  MODELS_LIST: "models:list",
  MODELS_DOWNLOAD: "models:download",
  MODELS_CANCEL_DOWNLOAD: "models:cancel-download",
  MODELS_DELETE: "models:delete",
  MODELS_DOWNLOAD_PROGRESS: "models:download-progress",

  CUDA_STATUS: "cuda:status",
  CUDA_DOWNLOAD: "cuda:download",
  CUDA_CANCEL_DOWNLOAD: "cuda:cancel-download",
  CUDA_DELETE: "cuda:delete",
  CUDA_DOWNLOAD_PROGRESS: "cuda:download-progress",

  VOCAL_MODEL_STATUS: "vocal-model:status",
  VOCAL_MODEL_DOWNLOAD: "vocal-model:download",
  VOCAL_MODEL_CANCEL_DOWNLOAD: "vocal-model:cancel-download",
  VOCAL_MODEL_DELETE: "vocal-model:delete",
  VOCAL_MODEL_DOWNLOAD_PROGRESS: "vocal-model:download-progress",

  // Window / Floating / Settings / Playback / App / Cache
  FLOATING_TOGGLE: "floating:toggle",
  FLOATING_UPDATE_LINE: "floating:update-line",
  FLOATING_LINE: "floating:line",
  FLOATING_SET_LOCKED: "floating:set-locked",
  FLOATING_LOCKED: "floating:locked",
  FLOATING_SET_IGNORE_MOUSE: "floating:set-ignore-mouse",
  FLOATING_CLOSED: "floating:closed",
  FLOATING_APPLY_VISUALS: "floating:apply-visuals",

  PLAYBACK_COMMAND: "playback:command",

  SETTINGS_LOAD: "settings:load",
  SETTINGS_SAVE: "settings:save",
  CACHE_CLEAR: "cache:clear",
  APP_GET_DATA_PATH: "app:get-data-path",

  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_TOGGLE_MAXIMIZE: "window:toggle-maximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_MAXIMIZED_CHANGED: "window:maximized-changed"
});

module.exports = {
  IPC_CHANNELS
};
