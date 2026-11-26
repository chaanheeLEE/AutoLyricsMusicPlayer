const { IPC_CHANNELS } = require("./channels");

/**
 * 음성 인식(Whisper/Gemini STT) 및 AI 가사 정합 IPC 핸들러를 등록합니다.
 * 활성 작업 상태(activeTranscriptionJob, activeAlignController)를 클로저로 격리 관리합니다.
 */
function registerTranscriptionIpc({
  ipcMain,
  windowManager,
  startTranscription,
  vocalModelManager,
  lyricsAligner,
  transcribeAudioWithGemini = null
}) {
  let activeTranscriptionJob = null;
  let activeAlignController = null;

  function cancelAllActiveJobs() {
    if (activeTranscriptionJob) {
      activeTranscriptionJob.cancel();
      activeTranscriptionJob = null;
    }
    if (activeAlignController) {
      activeAlignController.abort();
      activeAlignController = null;
    }
  }

  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_START, async (_event, payload) => {
    const mainWindow = windowManager.getMainWindow();
    cancelAllActiveJobs();

    const track = payload?.track;
    const options = payload?.options || {};
    const jobId = options.jobId ?? null;

    const sendJobProgress = (jobRef, msg) => {
      if (activeTranscriptionJob === jobRef && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.TRANSCRIPTION_PROGRESS, { ...msg, jobId });
      }
    };

    if (!track?.path) {
      return { ok: false, error: "missing_track_path" };
    }

    if (options.sttEngine === "gemini") {
      const apiKey = options.geminiApiKey;
      if (!apiKey || !apiKey.trim()) {
        return { ok: false, error: "missing_api_key" };
      }

      const abortController = new AbortController();
      const jobRef = {
        cancel() {
          abortController.abort();
        }
      };
      activeTranscriptionJob = jobRef;

      try {
        sendJobProgress(jobRef, {
          type: "progress",
          stage: "gemini_uploading",
          percent: 0.2
        });

        if (abortController.signal.aborted) {
          return { ok: false, cancelled: true, error: "cancelled" };
        }

        const transcribeFn = transcribeAudioWithGemini || require("../services/gemini-service").transcribeAudioWithGemini;

        sendJobProgress(jobRef, {
          type: "progress",
          stage: "gemini_transcribing",
          percent: 0.5
        });

        const lines = await transcribeFn(
          apiKey,
          track.path,
          track.duration,
          options.geminiModel || "gemini-3.5-flash-lite",
          {
            signal: abortController.signal,
            language: options.language || null
          }
        );

        if (abortController.signal.aborted) {
          return { ok: false, cancelled: true, error: "cancelled" };
        }

        sendJobProgress(jobRef, {
          type: "progress",
          stage: "saving",
          percent: 1.0
        });

        return { ok: true, lyrics: lines };
      } catch (err) {
        if (err?.cancelled || err?.message === "cancelled" || abortController.signal.aborted) {
          return { ok: false, cancelled: true, error: "cancelled" };
        }
        return { ok: false, error: err.message };
      } finally {
        if (activeTranscriptionJob === jobRef) {
          activeTranscriptionJob = null;
        }
      }
    }

    const workerOptions = { ...options };
    if (workerOptions.vocalIsolation) {
      const vocalStatus = await vocalModelManager.getVocalModelStatus();
      if (vocalStatus.installed) {
        workerOptions.vocalModelPath = vocalStatus.modelPath;
      } else {
        workerOptions.vocalIsolation = false;
      }
    }

    return new Promise((resolve) => {
      let jobCancelled = false;
      const jobHolder = {
        job: null,
        cancel() {
          jobCancelled = true;
          if (this.job) {
            this.job.cancel();
          }
        }
      };
      activeTranscriptionJob = jobHolder;

      jobHolder.job = startTranscription(track, workerOptions, (msg) => {
        if (!jobCancelled) {
          sendJobProgress(jobHolder, msg);
        }
      });

      jobHolder.job.promise
        .then((lines) => {
          if (activeTranscriptionJob === jobHolder) {
            activeTranscriptionJob = null;
          }
          if (jobCancelled) {
            resolve({ ok: false, cancelled: true, error: "cancelled" });
            return;
          }
          resolve({ ok: true, lyrics: lines });
        })
        .catch((err) => {
          if (activeTranscriptionJob === jobHolder) {
            activeTranscriptionJob = null;
          }
          if (jobCancelled || err?.cancelled || err?.message === "cancelled") {
            resolve({ ok: false, cancelled: true, error: "cancelled" });
            return;
          }
          resolve({ ok: false, error: err.message });
        });
    });
  });

  ipcMain.handle(IPC_CHANNELS.TRANSCRIPTION_CANCEL, () => {
    cancelAllActiveJobs();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.LYRICS_ALIGN, async (_event, payload) => {
    const mainWindow = windowManager.getMainWindow();
    if (activeAlignController) {
      activeAlignController.abort();
      activeAlignController = null;
    }

    const abortController = new AbortController();
    activeAlignController = abortController;
    const jobId = payload?.jobId ?? null;

    try {
      return await lyricsAligner.alignAndInterpolateLyrics(payload, {
        signal: abortController.signal,
        onProgress: (msg) => {
          if (
            !abortController.signal.aborted &&
            activeAlignController === abortController &&
            mainWindow &&
            !mainWindow.isDestroyed()
          ) {
            mainWindow.webContents.send(IPC_CHANNELS.TRANSCRIPTION_PROGRESS, { ...msg, jobId });
          }
        }
      });
    } finally {
      if (activeAlignController === abortController) {
        activeAlignController = null;
      }
    }
  });

  return {
    cancelAllActiveJobs
  };
}

module.exports = {
  registerTranscriptionIpc
};
