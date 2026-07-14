const { BrowserWindow, Menu } = require("electron");
const path = require("node:path");
const settingsManager = require("../helpers/settings-manager");

let mainWindow = null;
let floatingWindow = null;

function getMainWindow() {
  return mainWindow;
}

function setMainWindow(win) {
  mainWindow = win;
}

function getFloatingWindow() {
  return floatingWindow;
}

function setFloatingWindow(win) {
  floatingWindow = win;
}

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
  const iconPath = path.join(__dirname, "../../assets/icon.png");

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
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));

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
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  floatingWindow.setAlwaysOnTop(true, "screen-saver");

  floatingWindow.loadFile(path.join(__dirname, "../../renderer/floating.html"));

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

module.exports = {
  getMainWindow,
  setMainWindow,
  getFloatingWindow,
  setFloatingWindow,
  applyVisualsToFloating,
  createMainWindow,
  createFloatingWindow
};
