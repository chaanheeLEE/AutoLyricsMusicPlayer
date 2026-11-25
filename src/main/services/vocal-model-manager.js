/**
 * vocal-model-manager.js
 *
 * 경량 ONNX 보컬 분리 모델(UVR-MDX-NET-Voc_FT.onnx) 관리 서비스:
 * - 설치 상태 및 디스크 용량 확인
 * - 온디맨드 다운로드 (HTTP/HTTPS 리다이렉트 지원 + .tmp 원자적 저장)
 * - 다운로드 취소 및 삭제
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { app } = require("electron");
const {
  formatBytes,
  downloadFileWithRedirects,
  isCancelledError
} = require("../helpers/download-helper");

const VOCAL_MODEL_FILENAME = "UVR-MDX-NET-Voc_FT.onnx";
const VOCAL_MODEL_URL =
  process.env.VOCAL_MODEL_URL ||
  `https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/${VOCAL_MODEL_FILENAME}`;
const MIN_VALID_BYTES = 10 * 1024 * 1024;

let activeAbortController = null;
let isDownloading = false;

function getVocalModelsDir() {
  return path.join(app.getPath("userData"), "models", "vocal");
}

function getVocalModelPath() {
  return path.join(getVocalModelsDir(), VOCAL_MODEL_FILENAME);
}

async function getVocalModelStatus() {
  const modelPath = getVocalModelPath();
  let installed = false;
  let diskBytes = 0;

  try {
    const stats = await fs.stat(modelPath);
    if (stats.isFile() && stats.size > MIN_VALID_BYTES) {
      installed = true;
      diskBytes = stats.size;
    }
  } catch {
    installed = false;
    diskBytes = 0;
  }

  return {
    modelName: VOCAL_MODEL_FILENAME,
    modelPath,
    installed,
    diskBytes,
    diskSizeFormatted: installed ? formatBytes(diskBytes) : "약 64 MB",
    isDownloading,
  };
}

async function downloadVocalModel(onProgress) {
  if (isDownloading) {
    throw new Error("이미 보컬 분리 모델 다운로드가 진행 중입니다.");
  }

  isDownloading = true;
  activeAbortController = new AbortController();

  const modelsDir = getVocalModelsDir();
  const modelPath = getVocalModelPath();
  const tempPath = `${modelPath}.tmp`;

  try {
    await fs.mkdir(modelsDir, { recursive: true });
    try { await fs.unlink(tempPath); } catch {}

    onProgress({
      stage: "starting",
      percent: 0,
      message: "보컬 분리 모델 다운로드 연결 중...",
    });

    await downloadFileWithRedirects(VOCAL_MODEL_URL, tempPath, {
      onProgress,
      formatProgressMessage: ({ downloadedBytes, totalBytes }) =>
        `보컬 분리 모델 다운로드 중: ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`,
      signal: activeAbortController.signal
    });
    await fs.rename(tempPath, modelPath);

    const status = await getVocalModelStatus();
    onProgress({
      stage: "done",
      percent: 1.0,
      message: "보컬 분리 모델 설치 완료!",
      status,
    });

    return { ok: true, status };
  } catch (err) {
    try { await fs.unlink(tempPath); } catch {}
    if (isCancelledError(err)) {
      onProgress({ stage: "cancelled", message: "다운로드가 취소되었습니다." });
      return { ok: false, error: "cancelled" };
    }
    throw err;
  } finally {
    isDownloading = false;
    activeAbortController = null;
  }
}

function cancelVocalModelDownload() {
  if (activeAbortController) {
    activeAbortController.abort();
    isDownloading = false;
    activeAbortController = null;
    return { ok: true };
  }
  return { ok: false, message: "진행 중인 다운로드가 없습니다." };
}

async function deleteVocalModel() {
  const modelPath = getVocalModelPath();
  try {
    if (fsSync.existsSync(modelPath)) {
      await fs.unlink(modelPath);
    }
    const status = await getVocalModelStatus();
    return { ok: true, status };
  } catch (err) {
    console.error("Failed to delete vocal model:", err);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  VOCAL_MODEL_FILENAME,
  getVocalModelPath,
  getVocalModelStatus,
  downloadVocalModel,
  cancelVocalModelDownload,
  deleteVocalModel,
};
