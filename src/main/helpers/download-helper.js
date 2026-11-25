const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");

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

function createCancelledError() {
  const err = new Error("cancelled");
  err.cancelled = true;
  return err;
}

function isCancelledError(err, signal = null) {
  return Boolean(err?.cancelled || err?.message === "cancelled" || signal?.aborted);
}

/**
 * HTTP/HTTPS 리다이렉트, 진행률 콜백, AbortSignal 취소 및 실패 시 임시 파일 정리를 지원하는 스트림 다운로더입니다.
 */
function downloadFileWithRedirects(
  url,
  destPath,
  { onProgress = null, formatProgressMessage = null, signal = null, maxRedirects = 5, requestGet = null } = {}
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancelledError());
      return;
    }

    let settled = false;
    let activeReq = null;
    let activeFileStream = null;

    const cleanupPartialFile = () => {
      const tryUnlink = () => {
        try {
          fsSync.unlinkSync(destPath);
        } catch { /* ignore */ }
      };
      if (activeFileStream) {
        activeFileStream.once("close", tryUnlink);
        try {
          activeFileStream.destroy();
        } catch { /* ignore */ }
      }
      tryUnlink();
    };

    const onAbort = () => {
      try {
        activeReq?.destroy();
      } catch { /* ignore */ }
      finish(createCancelledError());
    };

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      if (err) {
        cleanupPartialFile();
        reject(err);
      } else {
        resolve();
      }
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const makeRequest = (currentUrl, redirectCount = 0) => {
      if (settled) return;
      if (signal?.aborted) {
        finish(createCancelledError());
        return;
      }
      if (redirectCount > maxRedirects) {
        finish(new Error("너무 많은 리다이렉트가 발생했습니다."));
        return;
      }

      const getter = typeof requestGet === "function"
        ? requestGet
        : (currentUrl.startsWith("https") ? https.get.bind(https) : http.get.bind(http));
      const req = getter(currentUrl, (res) => {
        if (settled) {
          res.resume();
          return;
        }

        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const nextUrl = res.headers.location;
          res.resume();
          if (!nextUrl) {
            finish(new Error("리다이렉트 주소를 찾을 수 없습니다."));
            return;
          }
          let resolvedUrl;
          try {
            resolvedUrl = new URL(nextUrl, currentUrl).toString();
          } catch (err) {
            finish(err);
            return;
          }
          makeRequest(resolvedUrl, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          finish(new Error(`다운로드 서버 응답 오류: HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let downloadedBytes = 0;

        const fileStream = fsSync.createWriteStream(destPath);
        activeFileStream = fileStream;

        res.on("data", (chunk) => {
          if (settled) return;
          downloadedBytes += chunk.length;
          const percent = totalBytes > 0 ? downloadedBytes / totalBytes : null;
          if (typeof onProgress === "function") {
            const message = typeof formatProgressMessage === "function"
              ? formatProgressMessage({ downloadedBytes, totalBytes, percent })
              : `다운로드 중: ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
            onProgress({
              stage: "downloading",
              percent,
              downloadedBytes,
              totalBytes,
              message
            });
          }
        });

        res.on("error", (err) => finish(signal?.aborted ? createCancelledError() : err));
        fileStream.on("error", (err) => finish(signal?.aborted ? createCancelledError() : err));

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close((closeErr) => {
            if (closeErr) {
              finish(closeErr);
              return;
            }
            finish(null);
          });
        });
      });

      activeReq = req;
      req.on("error", (err) => {
        finish(signal?.aborted ? createCancelledError() : err);
      });
    };

    makeRequest(url);
  });
}

module.exports = {
  formatBytes,
  getDirectorySize,
  createCancelledError,
  isCancelledError,
  downloadFileWithRedirects
};
