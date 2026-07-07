const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lyricsPlayer", {
  openTrack: () => ipcRenderer.invoke("track:open"),
  loadCachedLyrics: (track) => ipcRenderer.invoke("lyrics-cache:load", track),
  saveCachedLyrics: (payload) => ipcRenderer.invoke("lyrics-cache:save", payload),
  exportLyrics: (payload) => ipcRenderer.invoke("lyrics:export", payload),
  toggleFloating: (shouldShow) => ipcRenderer.invoke("floating:toggle", shouldShow),
  updateFloatingLine: (payload) => ipcRenderer.send("floating:update-line", payload),
  setFloatingLocked: (locked) => ipcRenderer.send("floating:set-locked", locked),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send("floating:set-ignore-mouse", ignore, options),
  sendPlaybackCommand: (command) => ipcRenderer.send("playback:command", command),
  onFloatingClosed: (callback) => {
    ipcRenderer.on("floating:closed", callback);
  },
  onFloatingLine: (callback) => {
    ipcRenderer.on("floating:line", (_event, payload) => callback(payload));
  },
  onFloatingLocked: (callback) => {
    ipcRenderer.on("floating:locked", (_event, locked) => callback(locked));
  },
  onPlaybackCommand: (callback) => {
    ipcRenderer.on("playback:command", (_event, command) => callback(command));
  },
  onApplyVisuals: (callback) => {
    ipcRenderer.on("floating:apply-visuals", (_event, settings) => callback(settings));
  },
  startTranscription: (track, options) =>
    ipcRenderer.invoke("transcription:start", { track, options }),
  cancelTranscription: () => ipcRenderer.invoke("transcription:cancel"),
  onTranscriptionProgress: (callback) => {
    ipcRenderer.on("transcription:progress", (_event, msg) => callback(msg));
  },
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  clearCache: () => ipcRenderer.invoke("cache:clear"),
  getAppDataPath: () => ipcRenderer.invoke("app:get-data-path"),
  alignLyrics: (payload) => ipcRenderer.invoke("lyrics:align", payload),
});
