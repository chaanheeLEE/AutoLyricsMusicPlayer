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

/** Resolve ffmpeg binary — PATH first, then winget fallback on Windows. */
function resolveFfmpeg() {
  const { existsSync } = require("node:fs");
  const packedFfmpeg = path.join(process.resourcesPath, "bin", "ffmpeg.exe");
  if (existsSync(packedFfmpeg)) {
    return packedFfmpeg;
  }

  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
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

/** Resolve python binary — PATH first, then common conda/venv locations. */
function resolvePython() {
  const { execFileSync } = require("node:child_process");
  // Try plain 'python' first (already in PATH)
  for (const cmd of ["python", "python3"]) {
    try {
      execFileSync(cmd, ["-c", "import faster_whisper"], { stdio: "ignore" });
      return cmd;
    } catch { /* try next */ }
  }
  // Common conda/venv locations on Windows
  const candidates = [
    path.join(os.homedir(), "miniconda3", "python.exe"),
    path.join(os.homedir(), "anaconda3", "python.exe"),
    path.join(os.homedir(), "Miniconda3", "python.exe"),
    path.join(os.homedir(), "Anaconda3", "python.exe"),
    path.join("C:\\", "ProgramData", "miniconda3", "python.exe"),
    path.join("C:\\", "ProgramData", "anaconda3", "python.exe"),
  ];
  const { accessSync } = require("node:fs");
  for (const c of candidates) {
    try {
      accessSync(c);
      return c;
    } catch { /* skip */ }
  }
  throw new Error(
    "python with faster-whisper not found.\n" +
    "Please ensure Python is installed and faster-whisper is available:\n" +
    "  pip install faster-whisper"
  );
}


/**
 * Convert audio to 16kHz mono WAV using ffmpeg.
 * @param {string} inputPath
 * @param {string} outputPath
 * @returns {Promise<void>}
 */
function convertAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    let ffmpegBin;
    try { ffmpegBin = resolveFfmpeg(); } catch (err) { return reject(err); }

    const proc = spawn(ffmpegBin, [
      "-y",
      "-i", inputPath,
      "-ar", "16000",
      "-ac", "1",
      "-f", "wav",
      outputPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });


    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}:\n${stderr.slice(-500)}`));
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
 * Start a transcription job.
 *
 * @param {object} track  - Track object with at least { path }
 * @param {object} options - { model?: string, language?: string }
 * @param {function} onProgress - Called with { stage, percent?, type, ... } for each event
 * @returns {{ cancel: () => void, promise: Promise<Array> }}
 */
function startTranscription(track, options, onProgress) {
  const model = options?.model || "base";
  const language = options?.language || null;
  const initialPrompt = options?.initialPrompt || null;
  const beamSize = options?.beamSize !== undefined ? options.beamSize : 5;
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
      const packedTranscribe = path.join(process.resourcesPath, "bin", "transcribe.exe");
      
      let cmd, args;
      if (existsSync(packedTranscribe)) {
        cmd = packedTranscribe;
        args = [tmpWav, "--model", model];
      } else {
        cmd = resolvePython();
        args = [TRANSCRIBE_SCRIPT, tmpWav, "--model", model];
      }
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
