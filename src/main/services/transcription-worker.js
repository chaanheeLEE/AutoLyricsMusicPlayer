"use strict";

const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

let TRANSCRIBE_SCRIPT = path.join(__dirname, "transcribe.py");
if (TRANSCRIBE_SCRIPT.includes("app.asar")) {
  TRANSCRIBE_SCRIPT = TRANSCRIBE_SCRIPT.replace("app.asar", "app.asar.unpacked");
}

let cachedFfmpegPath = null;

/** Resolve ffmpeg binary — PATH first, then winget fallback on Windows. */
function resolveFfmpeg() {
  if (cachedFfmpegPath) {
    return cachedFfmpegPath;
  }

  const { existsSync } = require("node:fs");
  const packedFfmpeg = path.join(process.resourcesPath || "", "bin", "ffmpeg.exe");
  if (existsSync(packedFfmpeg)) {
    cachedFfmpegPath = packedFfmpeg;
    return packedFfmpeg;
  }

  const devFfmpeg = path.join(__dirname, "..", "..", "..", "bin", "win32", "ffmpeg.exe");
  if (existsSync(devFfmpeg)) {
    cachedFfmpegPath = devFfmpeg;
    return devFfmpeg;
  }

  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    cachedFfmpegPath = "ffmpeg";
    return "ffmpeg";
  } catch {
    // Winget installs under AppData on Windows
    if (process.platform === "win32") {
      const wingetBase = path.join(
        os.homedir(),
        "AppData", "Local", "Microsoft", "WinGet", "Packages"
      );
      // Glob-style: find any Gyan.FFmpeg_* dir
      try {
        const { readdirSync } = require("node:fs");
        const entries = readdirSync(wingetBase);
        for (const entry of entries) {
          if (entry.startsWith("Gyan.FFmpeg")) {
            const candidate = path.join(wingetBase, entry);
            // Search one level deep for bin/ffmpeg.exe
            const sub = readdirSync(candidate);
            for (const s of sub) {
              const bin = path.join(candidate, s, "bin", "ffmpeg.exe");
              try {
                require("node:fs").accessSync(bin);
                cachedFfmpegPath = bin;
                return bin;
              } catch { /* skip */ }
            }
          }
        }
      } catch { /* ignore */ }
    }
    throw new Error(
      "ffmpeg not found in PATH or default install locations.\n" +
      "Please install ffmpeg: https://ffmpeg.org/download.html\n" +
      "Then restart the app."
    );
  }
}

function hasFasterWhisper(pythonCmd) {
  try {
    execFileSync(pythonCmd, ["-c", "import faster_whisper"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Resolve python binary — PATH first, then common conda/venv locations. */
function resolvePython() {
  const { existsSync } = require("node:fs");
  for (const cmd of ["python", "python3"]) {
    if (hasFasterWhisper(cmd)) {
      return cmd;
    }
  }
  // Common conda/venv and Windows Python locations
  const condaRoots = [
    path.join(os.homedir(), "miniconda3"),
    path.join(os.homedir(), "anaconda3"),
    path.join(os.homedir(), "Miniconda3"),
    path.join(os.homedir(), "Anaconda3"),
    path.join(os.homedir(), "AppData", "Local", "miniconda3"),
    path.join(os.homedir(), "AppData", "Local", "anaconda3"),
    path.join("C:\\", "ProgramData", "miniconda3"),
    path.join("C:\\", "ProgramData", "anaconda3"),
  ];
  const candidates = [
    ...condaRoots.map((root) => path.join(root, "envs", "lyrics_player", "python.exe")),
    ...condaRoots.map((root) => path.join(root, "python.exe")),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Python", "Python312", "python.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Python", "Python311", "python.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Python", "Python310", "python.exe"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && hasFasterWhisper(c)) {
      return c;
    }
  }
  throw new Error(
    "python with faster-whisper not found.\n" +
    "Please ensure Python is installed and faster-whisper is available:\n" +
    "  pip install faster-whisper"
  );
}

function runFfmpeg(ffmpegBin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const err = new Error(`ffmpeg exited with code ${code}:\n${stderr.slice(-500)}`);
        err.exitCode = code;
        reject(err);
      }
    });

    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("ffmpeg not found. Please install ffmpeg and restart the app."));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Convert audio to 16kHz mono WAV using ffmpeg.
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {Promise<void>}
 */
async function convertAudio(inputPath, outputPath) {
  const ffmpegBin = resolveFfmpeg();
  await runFfmpeg(ffmpegBin, [
    "-y",
    "-i", inputPath,
    "-vn",
    "-ar", "16000",
    "-ac", "1",
    "-f", "wav",
    outputPath,
  ]);
}

/**
 * Start a transcription job.
 *
 * @param {object} track  - Track object with at least { path }
 * @param {object} options - { model?: string, language?: string }
 * @param {function} onProgress - Called with { stage, percent?, type, ... } for each event
 * @returns {{ cancel: () => void, promise: Promise<Array> }}
 */
function startTranscription(track, options, onProgress) {
  const model = options?.model || "base";
  const whisperDevice = options?.whisperDevice || "auto";
  const language = options?.language || null;
  const initialPrompt = options?.initialPrompt || null;
  const beamSize = options?.beamSize !== undefined ? options.beamSize : 2;
  const tmpId = crypto.randomBytes(6).toString("hex");
  const tmpWav = path.join(os.tmpdir(), `alp_${tmpId}.wav`);

  let cancelled = false;
  let activeProc = null;

  async function cleanup() {
    try { await fs.unlink(tmpWav); } catch { /* ignore */ }
  }

  const promise = (async () => {
    // --- Stage 1: converting ---
    onProgress({ type: "progress", stage: "converting", percent: 0 });

    try {
      await convertAudio(track.path, tmpWav);
    } catch (err) {
      if (cancelled) {
        onProgress({ type: "progress", stage: "cancelled" });
        return [];
      }
      onProgress({ type: "error", stage: "converting", message: err.message });
      throw err;
    }

    if (cancelled) {
      await cleanup();
      onProgress({ type: "progress", stage: "cancelled" });
      return [];
    }

    // --- Stage 2: transcribing ---
    onProgress({ type: "progress", stage: "transcribing", percent: 0.1 });

    const lines = [];

    await new Promise((resolve, reject) => {
      const { existsSync } = require("node:fs");
      const packedTranscribe = process.resourcesPath
        ? path.join(process.resourcesPath, "bin", "transcribe.exe")
        : "";
      const devTranscribe = path.join(__dirname, "..", "..", "..", "bin", "win32", "transcribe.exe");

      let cmd, args;
      if (packedTranscribe && existsSync(packedTranscribe)) {
        cmd = packedTranscribe;
        args = [tmpWav, "--model", model];
      } else {
        try {
          cmd = resolvePython();
          args = [TRANSCRIBE_SCRIPT, tmpWav, "--model", model];
        } catch (pyErr) {
          if (existsSync(devTranscribe)) {
            console.warn("[Transcription Worker] Python faster-whisper unavailable in dev mode, falling back to bin/win32/transcribe.exe");
            cmd = devTranscribe;
            args = [tmpWav, "--model", model];
          } else {
            throw pyErr;
          }
        }
      }
      args.push("--device", whisperDevice);
      if (language) args.push("--language", language);
      if (initialPrompt) args.push("--initial_prompt", initialPrompt);
      if (beamSize) args.push("--beam_size", String(beamSize));

      const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      activeProc = proc;

      let stderrBuf = "";
      let lastPythonError = null;
      proc.stderr.on("data", (chunk) => { stderrBuf += chunk.toString(); });

      proc.stdout.on("data", (chunk) => {
        const rawLines = chunk.toString().split("\n");
        for (const raw of rawLines) {
          const trimmed = raw.trim();
          if (!trimmed) continue;
          let msg;
          try { msg = JSON.parse(trimmed); } catch { continue; }

          if (msg.type === "info") {
            console.log(`[Transcription Worker] ${msg.message}`);
          }

          if (msg.type === "error") {
            lastPythonError = msg.message;
          }

          if (msg.type === "segment") {
            lines.push({
              id: msg.id,
              start: msg.start,
              end: msg.end,
              text: msg.text,
              confidence: msg.confidence ?? 0.9,
            });
          }
          // forward all events to caller
          onProgress(msg);
        }
      });

      proc.on("close", (code) => {
        activeProc = null;
        if (cancelled) {
          resolve();
        } else if (code === 0) {
          resolve();
        } else {
          // Write stderr & lastPythonError to a log file in the workspace for easier debugging
          const logPath = path.join(process.cwd(), "transcribe_error.log");
          fs.writeFile(logPath, `Exit Code: ${code}\n\nPython Error:\n${lastPythonError || "None"}\n\nStderr:\n${stderrBuf}\n`)
            .catch((writeErr) => console.error("Failed to write transcribe_error.log:", writeErr));
          
          reject(new Error(
            lastPythonError || `transcription process exited with code ${code}.\n${stderrBuf.slice(-400)}`
          ));
        }
      });

      proc.on("error", (err) => {
        activeProc = null;
        if (err.code === "ENOENT") {
          reject(new Error("python not found. Please ensure Python is installed and in PATH."));
        } else {
          reject(err);
        }
      });
    });

    await cleanup();

    if (cancelled) {
      onProgress({ type: "progress", stage: "cancelled" });
      return [];
    }

    onProgress({ type: "progress", stage: "saving", percent: 1 });
    return lines;
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      if (activeProc && !activeProc.killed) {
        activeProc.kill("SIGTERM");
      }
    },
  };
}

module.exports = { startTranscription, resolveFfmpeg };
