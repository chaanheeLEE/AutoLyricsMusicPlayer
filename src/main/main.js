const { app, BrowserWindow } = require("electron");
const windowManager = require("./core/window-manager");
const ipcRouter = require("./core/ipc-router");

app.whenReady().then(() => {
  // IPC 라우팅 핸들러 먼저 등록
  ipcRouter.registerIpcHandlers(windowManager);

  // 메인 창 생성
  windowManager.createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
