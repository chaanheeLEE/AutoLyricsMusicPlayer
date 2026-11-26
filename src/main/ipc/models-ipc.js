const { IPC_CHANNELS } = require("./channels");

function sendToMainWindow(windowManager, channel, msg) {
  const mainWindow = windowManager.getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, msg);
  }
}

/**
 * Whisper 모델, CUDA GPU 가속 팩, ONNX 보컬 분리 모델 관리 IPC 핸들러를 등록합니다.
 */
function registerModelsIpc({ ipcMain, windowManager, modelManager, cudaManager, vocalModelManager }) {
  // Whisper 모델 관리 IPC
  ipcMain.handle(IPC_CHANNELS.MODELS_LIST, async () => {
    return await modelManager.listModels();
  });

  ipcMain.handle(IPC_CHANNELS.MODELS_DOWNLOAD, async (_event, modelId) => {
    return await modelManager.downloadModel(modelId, (msg) => {
      sendToMainWindow(windowManager, IPC_CHANNELS.MODELS_DOWNLOAD_PROGRESS, msg);
    });
  });

  ipcMain.handle(IPC_CHANNELS.MODELS_CANCEL_DOWNLOAD, () => {
    return modelManager.cancelDownload();
  });

  ipcMain.handle(IPC_CHANNELS.MODELS_DELETE, async (_event, modelId) => {
    return await modelManager.deleteModel(modelId);
  });

  // CUDA GPU 가속 팩 관리 IPC
  ipcMain.handle(IPC_CHANNELS.CUDA_STATUS, async () => {
    return await cudaManager.getCudaStatus();
  });

  ipcMain.handle(IPC_CHANNELS.CUDA_DOWNLOAD, async () => {
    return await cudaManager.downloadCudaPack((msg) => {
      sendToMainWindow(windowManager, IPC_CHANNELS.CUDA_DOWNLOAD_PROGRESS, msg);
    });
  });

  ipcMain.handle(IPC_CHANNELS.CUDA_CANCEL_DOWNLOAD, () => {
    return cudaManager.cancelCudaDownload();
  });

  ipcMain.handle(IPC_CHANNELS.CUDA_DELETE, async () => {
    return await cudaManager.deleteCudaPack();
  });

  // ONNX 보컬 분리 모델 관리 IPC
  ipcMain.handle(IPC_CHANNELS.VOCAL_MODEL_STATUS, async () => {
    return await vocalModelManager.getVocalModelStatus();
  });

  ipcMain.handle(IPC_CHANNELS.VOCAL_MODEL_DOWNLOAD, async () => {
    return await vocalModelManager.downloadVocalModel((msg) => {
      sendToMainWindow(windowManager, IPC_CHANNELS.VOCAL_MODEL_DOWNLOAD_PROGRESS, msg);
    });
  });

  ipcMain.handle(IPC_CHANNELS.VOCAL_MODEL_CANCEL_DOWNLOAD, () => {
    return vocalModelManager.cancelVocalModelDownload();
  });

  ipcMain.handle(IPC_CHANNELS.VOCAL_MODEL_DELETE, async () => {
    return await vocalModelManager.deleteVocalModel();
  });
}

module.exports = {
  registerModelsIpc
};
