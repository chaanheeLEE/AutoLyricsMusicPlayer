const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { formatBytes, getDirectorySize } = require("../helpers/download-helper");
const { resolvePython } = require("./transcription-worker");

// 크기 오름차순 정렬 (tiny → base → small → large-v3-turbo)
const SUPPORTED_MODELS = [
  {
    id: "tiny",
    name: "tiny",
    label: "tiny",
    repoId: "Systran/faster-whisper-tiny",
    sizeLabel: "약 75 MB",
    estimatedBytes: 75 * 1024 * 1024,
    description: "가장 가볍고 빠르지만, 가사 인식률이 다소 낮음",
    recommended: false
  },
  {
    id: "base",
    name: "base",
    label: "base",
    repoId: "Systran/faster-whisper-base",
    sizeLabel: "약 145 MB",
    estimatedBytes: 145 * 1024 * 1024,
    description: "빠른 시작 및 저사양 PC에 적합한 표준 모델",
    recommended: false,
    badge: "기본값"
  },
  {
    id: "small",
    name: "small",
    label: "small",
    repoId: "Systran/faster-whisper-small",
    sizeLabel: "약 480 MB",
    estimatedBytes: 480 * 1024 * 1024,
    description: "일반 대화 및 노래에 적당한 품질과 속도",
    recommended: false
  },
  {
    id: "large-v3-turbo",
    name: "large-v3-turbo",
    label: "large-v3-turbo",
    repoId: "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
    sizeLabel: "약 1.6 GB",
    estimatedBytes: 1.6 * 1024 * 1024 * 1024,
    description: "높은 정확도와 빠른 연산 속도를 제공하는 대용량 모델",
    recommended: false
  }
];

function getHubCacheDir() {
  if (process.env.HF_HOME) {
    return path.join(process.env.HF_HOME, "hub");
  }
  if (process.env.HUGGINGFACE_HUB_CACHE) {
    return process.env.HUGGINGFACE_HUB_CACHE;
  }
  return path.join(os.homedir(), ".cache", "huggingface", "hub");
}

/**
 * 모델 캐시 디렉토리 경로 가져오기
 */
function getModelDir(modelId) {
  const hubDir = getHubCacheDir();
  const matched = SUPPORTED_MODELS.find((m) => m.id === modelId);
  const repoId = matched?.repoId || `Systran/faster-whisper-${modelId}`;
  return path.join(hubDir, `models--${repoId.replace(/\//g, "--")}`);
}

/**
 * 지원 모델 전체 목록 및 다운로드 상태/용량 조회
 */
async function listModels() {
  const hubDir = getHubCacheDir();
  let totalDiskBytes = 0;

  const models = await Promise.all(
    SUPPORTED_MODELS.map(async (m) => {
      const targetDir = getModelDir(m.id);
      let downloaded = false;
      let diskBytes = 0;

      if (fsSync.existsSync(targetDir)) {
        diskBytes = await getDirectorySize(targetDir);
        // 정상적인 모델 디렉토리는 snapshots 내에 최소 10MB 이상의 파일들이 존재함
        if (diskBytes > 10 * 1024 * 1024) {
          downloaded = true;
          totalDiskBytes += diskBytes;
        }
      }

      return {
        ...m,
        downloaded,
        diskBytes,
        diskSizeFormatted: downloaded ? formatBytes(diskBytes) : null,
        targetDir
      };
    })
  );

  return {
    models,
    cacheDir: hubDir,
    totalDiskBytes,
    totalDiskSizeFormatted: formatBytes(totalDiskBytes)
  };
}

/**
 * 모델 삭제
 */
async function deleteModel(modelId) {
  const targetDir = getModelDir(modelId);
  try {
    if (fsSync.existsSync(targetDir)) {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
    return { ok: true, modelId };
  } catch (err) {
    console.error(`Failed to delete model ${modelId}:`, err);
    return { ok: false, modelId, error: err.message };
  }
}

let activeDownloadProcess = null;
let currentDownloadingModelId = null;

/**
 * 모델 다운로드 실행
 */
function downloadModel(modelId, onProgress) {
  if (activeDownloadProcess) {
    throw new Error(`이미 다른 모델(${currentDownloadingModelId})을 다운로드하는 중입니다.`);
  }

  currentDownloadingModelId = modelId;
  const scriptPath = path.join(__dirname, "transcribe.py");
  const packedTranscribe = path.join(process.resourcesPath || "", "bin", "transcribe.exe");

  let cmd, args;
  if (fsSync.existsSync(packedTranscribe)) {
    cmd = packedTranscribe;
    args = ["--download_only", "--model", modelId];
  } else {
    cmd = resolvePython();
    args = [scriptPath, "--download_only", "--model", modelId];
  }

  return new Promise((resolve, reject) => {
    onProgress({
      type: "model-download-progress",
      modelId,
      stage: "starting",
      message: `${modelId} 모델 다운로드를 준비하고 있습니다...`
    });

    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    activeDownloadProcess = proc;

    let stderrBuf = "";

    proc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === "progress") {
            onProgress({
              type: "model-download-progress",
              modelId,
              stage: msg.stage,
              percent: msg.percent,
              message: msg.message || `${modelId} 모델 다운로드 중...`
            });
          } else if (msg.type === "done") {
            onProgress({
              type: "model-download-progress",
              modelId,
              stage: "done",
              percent: 1.0,
              message: `${modelId} 모델 다운로드가 완료되었습니다!`
            });
          }
        } catch {
          // 일반 로그 메시지인 경우
          onProgress({
            type: "model-download-progress",
            modelId,
            stage: "downloading",
            message: trimmed
          });
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });

    proc.on("close", (code) => {
      activeDownloadProcess = null;
      currentDownloadingModelId = null;

      if (code === 0) {
        resolve({ ok: true, modelId });
      } else {
        reject(new Error(`모델 다운로드 실패 (종료 코드 ${code}):\n${stderrBuf.slice(-400)}`));
      }
    });

    proc.on("error", (err) => {
      activeDownloadProcess = null;
      currentDownloadingModelId = null;
      reject(err);
    });
  });
}

function cancelDownload() {
  if (activeDownloadProcess) {
    try {
      activeDownloadProcess.kill();
    } catch { /* ignore */ }
    activeDownloadProcess = null;
    currentDownloadingModelId = null;
    return { ok: true };
  }
  return { ok: false, message: "진행 중인 다운로드가 없습니다." };
}

module.exports = {
  SUPPORTED_MODELS,
  getHubCacheDir,
  listModels,
  deleteModel,
  downloadModel,
  cancelDownload
};
