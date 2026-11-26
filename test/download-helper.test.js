const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const {
  formatBytes,
  getDirectorySize,
  createCancelledError,
  isCancelledError,
  downloadFileWithRedirects
} = require("../src/main/helpers/download-helper");

function createMockRequestGet(routeHandler) {
  const requests = [];
  const requestGet = (url, callback) => {
    const req = new EventEmitter();
    req.url = url;
    req.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
    };
    requests.push(req);

    queueMicrotask(() => {
      routeHandler(url, req, callback);
    });
    return req;
  };
  requestGet.requests = requests;
  return requestGet;
}

test("formatBytes and cancellation helpers handle zero, MB/GB scales, and AbortSignal", () => {
  assert.equal(formatBytes(0), "0 MB");
  assert.equal(formatBytes(-10), "0 MB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), "2.50 GB");

  const err = createCancelledError();
  assert.equal(err.cancelled, true);
  assert.equal(err.message, "cancelled");
  assert.equal(isCancelledError(err), true);
  assert.equal(isCancelledError(new Error("cancelled")), true);
  assert.equal(isCancelledError(new Error("other"), { aborted: true }), true);
  assert.equal(isCancelledError(new Error("other"), { aborted: false }), false);
});

test("getDirectorySize recursively totals file sizes and returns 0 on missing paths", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "alp-dirsize-"));
  try {
    const nested = path.join(tmpDir, "sub");
    await fs.mkdir(nested);
    await fs.writeFile(path.join(tmpDir, "a.bin"), Buffer.alloc(1200));
    await fs.writeFile(path.join(nested, "b.bin"), Buffer.alloc(800));

    assert.equal(await getDirectorySize(tmpDir), 2000);
    assert.equal(await getDirectorySize(path.join(tmpDir, "non-existent")), 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("downloadFileWithRedirects follows relative redirects, emits progress, and writes file", async () => {
  const payload = Buffer.from("hello-alp-download-payload");
  const requestGet = createMockRequestGet((url, _req, callback) => {
    const res = new PassThrough();
    if (url === "https://example.test/redirect") {
      res.statusCode = 302;
      res.headers = { location: "/file" };
      callback(res);
      res.end();
      return;
    }
    if (url === "https://example.test/file") {
      res.statusCode = 200;
      res.headers = { "content-length": String(payload.length) };
      callback(res);
      res.end(payload);
      return;
    }
    res.statusCode = 404;
    res.headers = {};
    callback(res);
    res.end();
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "alp-dl-ok-"));
  const dest = path.join(tmpDir, "downloaded.bin");
  try {
    const progressEvents = [];
    await downloadFileWithRedirects("https://example.test/redirect", dest, {
      requestGet,
      onProgress: (ev) => progressEvents.push(ev),
      formatProgressMessage: ({ downloadedBytes, totalBytes }) => `DL ${downloadedBytes}/${totalBytes}`
    });

    const saved = await fs.readFile(dest);
    assert.deepEqual(saved, payload);
    assert.equal(requestGet.requests.length, 2);
    assert.equal(requestGet.requests[1].url, "https://example.test/file");
    assert.ok(progressEvents.length >= 1);
    assert.equal(progressEvents.at(-1).percent, 1);
    assert.equal(progressEvents.at(-1).message, `DL ${payload.length}/${payload.length}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("downloadFileWithRedirects rejects on HTTP 404 or redirect loop without leaving destination file", async () => {
  const requestGet = createMockRequestGet((url, _req, callback) => {
    const res = new PassThrough();
    if (url.endsWith("/loop")) {
      res.statusCode = 302;
      res.headers = { location: "/loop" };
    } else {
      res.statusCode = 404;
      res.headers = {};
    }
    callback(res);
    res.end();
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "alp-dl-err-"));
  const dest404 = path.join(tmpDir, "missing.bin");
  const destLoop = path.join(tmpDir, "loop.bin");
  try {
    await assert.rejects(
      () => downloadFileWithRedirects("https://example.test/missing", dest404, { requestGet }),
      /HTTP 404/
    );
    await assert.rejects(
      () => downloadFileWithRedirects("https://example.test/loop", destLoop, { requestGet, maxRedirects: 2 }),
      /리다이렉트/
    );
    await assert.rejects(() => fs.stat(dest404), { code: "ENOENT" });
    await assert.rejects(() => fs.stat(destLoop), { code: "ENOENT" });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("downloadFileWithRedirects aborts in-flight download and cleans up partial file", async () => {
  const controller = new AbortController();
  const res = new PassThrough();
  const requestGet = createMockRequestGet((_url, _req, callback) => {
    res.statusCode = 200;
    res.headers = { "content-length": "10000" };
    callback(res);
    res.write(Buffer.alloc(128));
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "alp-dl-abort-"));
  const dest = path.join(tmpDir, "partial.bin");
  try {
    await assert.rejects(
      () =>
        downloadFileWithRedirects("https://example.test/stream", dest, {
          requestGet,
          signal: controller.signal,
          onProgress: () => controller.abort()
        }),
      (err) => isCancelledError(err, controller.signal)
    );
    assert.equal(requestGet.requests[0].destroyed, true);
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(() => fs.stat(dest), { code: "ENOENT" });
  } finally {
    res.destroy();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
