const { IPC_CHANNELS } = require("./channels");

/**
 * 플로팅 가사창, 재생 커맨드 전달, 환경설정/캐시/앱 경로 및 커스텀 창 제어 IPC 핸들러를 등록합니다.
 */
function registerWindowSettingsIpc({
  ipcMain,
  app,
  windowManager,
  settingsManager,
  cacheManager,
  mediaHelper
}) {
  ipcMain.handle(IPC_CHANNELS.FLOATING_TOGGLE, async (_event, shouldShow) => {
    const win = await windowManager.createFloatingWindow();

    if (shouldShow) {
      win.showInactive();
    } else {
      win.hide();
    }

    return win.isVisible();
  });

  ipcMain.on(IPC_CHANNELS.FLOATING_UPDATE_LINE, (_event, payload) => {
    const floatingWindow = windowManager.getFloatingWindow();
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.webContents.send(IPC_CHANNELS.FLOATING_LINE, payload);
    }
  });

  ipcMain.on(IPC_CHANNELS.FLOATING_SET_LOCKED, (_event, locked) => {
    const floatingWindow = windowManager.getFloatingWindow();
    if (!floatingWindow || floatingWindow.isDestroyed()) {
      return;
    }

    floatingWindow.setMovable(!locked);
    floatingWindow.webContents.send(IPC_CHANNELS.FLOATING_LOCKED, locked);
  });

  ipcMain.on(IPC_CHANNELS.FLOATING_SET_IGNORE_MOUSE, (_event, ignore, options) => {
    const floatingWindow = windowManager.getFloatingWindow();
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.setIgnoreMouseEvents(ignore, options);
    }
  });

  ipcMain.on(IPC_CHANNELS.PLAYBACK_COMMAND, (_event, command) => {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.PLAYBACK_COMMAND, command);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_LOAD, () => {
    return settingsManager.loadSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, async (_event, settings) => {
    const safe = await settingsManager.saveSettings(settings);
    windowManager.applyVisualsToFloating(safe);
    return safe;
  });

  ipcMain.handle(IPC_CHANNELS.CACHE_CLEAR, async () => {
    const res1 = await cacheManager.clearLyricsCache();
    const res2 = await mediaHelper.clearAlbumArtCache();
    return { ok: res1.ok && res2.ok };
  });

  ipcMain.handle(IPC_CHANNELS.APP_GET_DATA_PATH, () => {
    return app.getPath("userData");
  });

  // 커스텀 윈도우 제어 IPC
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, () => {
    const mainWindow = windowManager.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return { isMaximized: false };
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { isMaximized: mainWindow.isMaximized() };
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    const mainWindow = windowManager.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
}

module.exports = {
  registerWindowSettingsIpc
};
