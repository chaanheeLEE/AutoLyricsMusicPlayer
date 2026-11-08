/**
 * cuda-manager.js
 *
 * NVIDIA CUDA/cuDNN 런타임 DLL 팩 관리 서비스:
 * - 상태 감지 (시스템/AppData 내 cublas64_12.dll 존재 여부 및 GPU 감지)
 * - 온디맨드 다운로드 및 자동 압축 해제
 * - 삭제 및 재설치 기능 지원
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const { app } = require("electron");
const { execFile } = require("node:child_process");
const https = require("node:https");
const http = require("node:http");

// 공식 릴리즈 Assets 또는 미러 URL
const CUDA_PACK_URL = "https://github.com/chaanheeLEE/musicPlayer/releases/download/v0.5.4/cuda-runtime-win64.zip";

let activeAbortController = null;
let isDownloading = false;

function getNvidiaDir() {
  const userData = app.getPath("userData");
  return path.join(userData, "bin", "nvidia");
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function getDirectorySize(dirPath) {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        total += stats.size;
      }
    }
  } catch {
    return 0;
  }
  return total;
}

/**
 * Windows 시스템에서 NVIDIA GPU 모델명 감지
 */
function detectNvidiaGpu() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      return resolve({ hasNvidia: false, gpuName: null });
    }

    // 1. 드라이버 핵심 라이브러리(nvcuda.dll) 존재 여부로 즉각 확인 (가장 빠르고 권한 제한 없음)
    const sysRoot = process.env.SystemRoot || "C:\\Windows";
    const nvcudaPath = path.join(sysRoot, "System32", "nvcuda.dll");
    const hasNvcuda = fsSync.existsSync(nvcudaPath);

    // 2. 모델명 조회를 위한 WMI 보조 쿼리 시도
    execFile("powershell", [
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join '; '"
    ], { timeout: 3000 }, (err, stdout) => {
      let gpuName = null;
      let hasNvidia = hasNvcuda;

      if (!err && stdout) {
        const rawNames = stdout.trim();
        if (/NVIDIA/i.test(rawNames)) {
          hasNvidia = true;
          gpuName = rawNames
            .split(";")
            .map(s => s.trim())
            .find(s => /NVIDIA/i.test(s)) || "NVIDIA Graphics Device";
        }
      }

      if (hasNvidia && !gpuName) {
        gpuName = "NVIDIA CUDA Supported GPU";
      }

      resolve({ hasNvidia, gpuName });
    });
  });
}

/**
 * CUDA DLL 팩 설치 상태 확인
 */
async function getCudaStatus() {
  const nvidiaDir = getNvidiaDir();
  const { hasNvidia, gpuName } = await detectNvidiaGpu();

  let installed = false;
  let diskBytes = 0;
  const foundDlls = [];

  // 1. AppData 내 설치 확인
  if (fsSync.existsSync(nvidiaDir)) {
    try {
      const searchDlls = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await searchDlls(fullPath);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".dll")) {
            foundDlls.push(entry.name);
          }
        }
      };
      await searchDlls(nvidiaDir);
      diskBytes = await getDirectorySize(nvidiaDir);

      if (foundDlls.some(n => n.toLowerCase().includes("cublas64"))) {
        installed = true;
      }
    } catch {
      // ignore
    }
  }

  // 2. 시스템 전역 CUDA_PATH 확인 (시스템 자체에 이미 설치된 경우)
  let systemCuda = false;
  if (!installed && process.env.CUDA_PATH) {
    const sysBin = path.join(process.env.CUDA_PATH, "bin");
    if (fsSync.existsSync(sysBin)) {
      try {
        const sysFiles = fsSync.readdirSync(sysBin);
        if (sysFiles.some(f => f.toLowerCase().includes("cublas64"))) {
          systemCuda = true;
        }
      } catch {}
    }
  }

  return {
    hasNvidia,
    gpuName,
    installed: installed || systemCuda,
    isCustomInstalled: installed,
    isSystemInstalled: systemCuda,
    nvidiaDir,
    diskBytes,
    diskSizeFormatted: formatBytes(diskBytes),
    foundDlls,
    isDownloading
  };
}

/**
 * 리다이렉트를 지원하는 HTTP/HTTPS 스트림 다운로더
 */
function downloadFile(url, destPath, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const makeRequest = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        return reject(new Error("너무 많은 리다이렉트가 발생했습니다."));
      }

      const client = currentUrl.startsWith("https") ? https : http;
      const req = client.get(currentUrl, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const nextUrl = res.headers.location;
          if (!nextUrl) return reject(new Error("리다이렉트 주소를 찾을 수 없습니다."));
          res.resume();
          return makeRequest(nextUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`다운로드 서버 응답 오류: HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let downloadedBytes = 0;

        const fileStream = fsSync.createWriteStream(destPath);

        res.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          const percent = totalBytes > 0 ? downloadedBytes / totalBytes : null;
          onProgress({
            stage: "downloading",
            percent,
            downloadedBytes,
            totalBytes,
            message: `GPU 가속 팩 다운로드 중: ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
          });
        });

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });

        fileStream.on("error", (err) => {
          try { fsSync.unlinkSync(destPath); } catch {}
          reject(err);
        });
      });

      req.on("error", (err) => {
        try { fsSync.unlinkSync(destPath); } catch {}
        reject(err);
      });

      if (signal) {
        signal.addEventListener("abort", () => {
          req.destroy();
          try { fsSync.unlinkSync(destPath); } catch {}
          reject(new Error("cancelled"));
        });
      }
    };

    makeRequest(url);
  });
}

/**
 * GPU 가속 팩 다운로드 및 압축 해제 실행
 */
async function downloadCudaPack(onProgress) {
  if (isDownloading) {
    throw new Error("이미 GPU 가속 팩 다운로드가 진행 중입니다.");
  }

  isDownloading = true;
  activeAbortController = new AbortController();

  const nvidiaDir = getNvidiaDir();
  const tempZip = path.join(os.tmpdir(), `cuda_pack_${Date.now()}.zip`);

  try {
    await fs.mkdir(nvidiaDir, { recursive: true });

    onProgress({
      stage: "starting",
      percent: 0,
      message: "GPU 가속 팩 다운로드 연결 중..."
    });

    await downloadFile(CUDA_PACK_URL, tempZip, onProgress, activeAbortController.signal);

    onProgress({
      stage: "extracting",
      percent: 0.95,
      message: "GPU 가속 팩 압축 해제 및 설치 중..."
    });

    // PowerShell Expand-Archive 실행
    await new Promise((resolve, reject) => {
      execFile("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${tempZip}' -DestinationPath '${nvidiaDir}' -Force`
      ], { timeout: 120000 }, (err) => {
        if (err) return reject(new Error(`압축 해제 실패: ${err.message}`));
        resolve();
      });
    });

    // 임시 zip 파일 정리
    try { await fs.unlink(tempZip); } catch {}

    const status = await getCudaStatus();
    onProgress({
      stage: "done",
      percent: 1.0,
      message: "GPU 가속 팩 설치 완료!",
      status
    });

    return { ok: true, status };
  } catch (err) {
    try { await fs.unlink(tempZip); } catch {}
    if (err.message === "cancelled") {
      onProgress({ stage: "cancelled", message: "다운로드가 취소되었습니다." });
      return { ok: false, error: "cancelled" };
    }
    throw err;
  } finally {
    isDownloading = false;
    activeAbortController = null;
  }
}

/**
 * 다운로드 취소
 */
function cancelCudaDownload() {
  if (activeAbortController) {
    activeAbortController.abort();
    isDownloading = false;
    activeAbortController = null;
    return { ok: true };
  }
  return { ok: false, message: "진행 중인 다운로드가 없습니다." };
}

/**
 * GPU 가속 팩 삭제
 */
async function deleteCudaPack() {
  const nvidiaDir = getNvidiaDir();
  try {
    if (fsSync.existsSync(nvidiaDir)) {
      await fs.rm(nvidiaDir, { recursive: true, force: true });
    }
    const status = await getCudaStatus();
    return { ok: true, status };
  } catch (err) {
    console.error("Failed to delete CUDA pack:", err);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getCudaStatus,
  downloadCudaPack,
  cancelCudaDownload,
  deleteCudaPack
};
