const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const binDir = path.join(__dirname, "..", "bin", "win32");

// 1. Create directory
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// 2. Resolve or download FFmpeg & FFprobe
const ffmpegDest = path.join(binDir, "ffmpeg.exe");
const ffprobeDest = path.join(binDir, "ffprobe.exe");

if (!fs.existsSync(ffmpegDest) || !fs.existsSync(ffprobeDest)) {
  console.log("FFmpeg or FFprobe is missing from bin/win32. Attempting to locate or download...");
  let foundFfmpeg = null;
  let foundFfprobe = null;

  // Check system PATH
  try {
    const whereFfmpeg = execSync("where.exe ffmpeg", { encoding: "utf8" }).trim().split("\r\n")[0];
    if (whereFfmpeg && fs.existsSync(whereFfmpeg)) {
      foundFfmpeg = whereFfmpeg;
      console.log(`Found ffmpeg in PATH: ${foundFfmpeg}`);
    }
    const whereFfprobe = execSync("where.exe ffprobe", { encoding: "utf8" }).trim().split("\r\n")[0];
    if (whereFfprobe && fs.existsSync(whereFfprobe)) {
      foundFfprobe = whereFfprobe;
      console.log(`Found ffprobe in PATH: ${foundFfprobe}`);
    }
  } catch (e) {
    // Ignore
  }

  // Check WinGet default installation folder
  if ((!foundFfmpeg || !foundFfprobe) && process.platform === "win32") {
    const wingetBase = path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
    try {
      if (fs.existsSync(wingetBase)) {
        const entries = fs.readdirSync(wingetBase);
        for (const entry of entries) {
          if (entry.startsWith("Gyan.FFmpeg")) {
            const candidate = path.join(wingetBase, entry);
            const sub = fs.readdirSync(candidate);
            for (const s of sub) {
              const binFfmpeg = path.join(candidate, s, "bin", "ffmpeg.exe");
              const binFfprobe = path.join(candidate, s, "bin", "ffprobe.exe");
              if (fs.existsSync(binFfmpeg) && !foundFfmpeg) {
                foundFfmpeg = binFfmpeg;
                console.log(`Found ffmpeg in WinGet directory: ${foundFfmpeg}`);
              }
              if (fs.existsSync(binFfprobe) && !foundFfprobe) {
                foundFfprobe = binFfprobe;
                console.log(`Found ffprobe in WinGet directory: ${foundFfprobe}`);
              }
            }
          }
          if (foundFfmpeg && foundFfprobe) break;
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // If found locally, copy them
  if (foundFfmpeg && !fs.existsSync(ffmpegDest)) {
    console.log(`Copying ffmpeg: ${foundFfmpeg} -> ${ffmpegDest}`);
    fs.copyFileSync(foundFfmpeg, ffmpegDest);
  }
  if (foundFfprobe && !fs.existsSync(ffprobeDest)) {
    console.log(`Copying ffprobe: ${foundFfprobe} -> ${ffprobeDest}`);
    fs.copyFileSync(foundFfprobe, ffprobeDest);
  }

  // If still missing, download both
  if (!fs.existsSync(ffmpegDest) || !fs.existsSync(ffprobeDest)) {
    console.log("FFmpeg/FFprobe binaries still missing. Downloading official essentials release...");
    const zipUrl = "https://github.com/GyanD/codexffmpeg/releases/download/7.0.1/ffmpeg-7.0.1-essentials_build.zip";
    const tempZip = path.join(os.tmpdir(), "ffmpeg_temp.zip");
    const tempExtract = path.join(os.tmpdir(), "ffmpeg_temp_extracted");

    try {
      console.log(`Downloading: ${zipUrl}`);
      execSync(`powershell -Command "Invoke-WebRequest -Uri '${zipUrl}' -OutFile '${tempZip}'"`, { stdio: "inherit" });
      console.log("Extracting...");
      if (fs.existsSync(tempExtract)) {
        fs.rmSync(tempExtract, { recursive: true, force: true });
      }
      execSync(`powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${tempExtract}'"`, { stdio: "inherit" });

      const searchForBinary = (dir, name) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            const res = searchForBinary(fullPath, name);
            if (res) return res;
          } else if (file === name) {
            return fullPath;
          }
        }
        return null;
      };

      const foundTempFfmpeg = searchForBinary(tempExtract, "ffmpeg.exe");
      const foundTempFfprobe = searchForBinary(tempExtract, "ffprobe.exe");

      if (foundTempFfmpeg && !fs.existsSync(ffmpegDest)) {
        console.log(`Copying downloaded ffmpeg: ${foundTempFfmpeg} -> ${ffmpegDest}`);
        fs.copyFileSync(foundTempFfmpeg, ffmpegDest);
      }
      if (foundTempFfprobe && !fs.existsSync(ffprobeDest)) {
        console.log(`Copying downloaded ffprobe: ${foundTempFfprobe} -> ${ffprobeDest}`);
        fs.copyFileSync(foundTempFfprobe, ffprobeDest);
      }

      if (!fs.existsSync(ffmpegDest) || !fs.existsSync(ffprobeDest)) {
        throw new Error("Could not find ffmpeg.exe or ffprobe.exe in extracted archive.");
      }

      // Cleanup
      fs.unlinkSync(tempZip);
      fs.rmSync(tempExtract, { recursive: true, force: true });
    } catch (err) {
      console.error("Failed to download FFmpeg/FFprobe:", err);
      process.exit(1);
    }
  }
} else {
  console.log("FFmpeg and FFprobe already exist in bin/win32.");
}

// Helper function to compress executable with UPX
function compressWithUpx(binPath) {
  if (process.platform !== "win32") return;
  
  const upxDest = path.join(os.tmpdir(), "upx.exe");
  const tempExtract = path.join(os.tmpdir(), "upx_temp_extracted");

  if (!fs.existsSync(upxDest)) {
    console.log("Downloading UPX for binary compression...");
    const upxUrl = "https://github.com/upx/upx/releases/download/v4.2.4/upx-4.2.4-win64.zip";
    const tempZip = path.join(os.tmpdir(), "upx_temp.zip");
    try {
      if (fs.existsSync(tempExtract)) {
        fs.rmSync(tempExtract, { recursive: true, force: true });
      }
      execSync(`powershell -Command "Invoke-WebRequest -Uri '${upxUrl}' -OutFile '${tempZip}'"`, { stdio: "inherit" });
      execSync(`powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${tempExtract}'"`, { stdio: "inherit" });
      
      const searchForUpx = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            const res = searchForUpx(fullPath);
            if (res) return res;
          } else if (file === "upx.exe") {
            return fullPath;
          }
        }
        return null;
      };

      const foundUpx = searchForUpx(tempExtract);
      if (foundUpx) {
        fs.copyFileSync(foundUpx, upxDest);
        console.log("UPX executable ready.");
      } else {
        throw new Error("upx.exe not found in extracted archive.");
      }
      
      fs.unlinkSync(tempZip);
      fs.rmSync(tempExtract, { recursive: true, force: true });
    } catch (err) {
      console.error("Failed to download or prepare UPX. Skipping compression:", err);
      return;
    }
  }

  console.log(`Compressing ${path.basename(binPath)} with UPX...`);
  try {
    execSync(`"${upxDest}" --best --lzma "${binPath}"`, { stdio: "inherit" });
    console.log(`${path.basename(binPath)} compression complete.`);
  } catch (err) {
    console.log(`UPX compression finished (might be already compressed or skipped).`);
  }
}

// Compress FFmpeg and FFprobe with UPX
if (process.platform === "win32") {
  try {
    compressWithUpx(ffmpegDest);
    compressWithUpx(ffprobeDest);
  } catch (err) {
    console.error("Error during UPX compression of FFmpeg/FFprobe:", err);
  }
}

// 3. Compile transcribe.py into transcribe.exe using PyInstaller
const transcribeSource = path.join(__dirname, "..", "src", "main", "services", "transcribe.py");
const transcribeDest = path.join(binDir, "transcribe.exe");

let shouldBuild = !fs.existsSync(transcribeDest);

if (fs.existsSync(transcribeDest) && fs.existsSync(transcribeSource)) {
  const sourceStat = fs.statSync(transcribeSource);
  const scriptStat = fs.statSync(__filename);
  const destStat = fs.statSync(transcribeDest);

  if (sourceStat.mtime > destStat.mtime) {
    console.log("transcribe.py is newer than transcribe.exe. Rebuilding...");
    shouldBuild = true;
  } else if (scriptStat.mtime > destStat.mtime) {
    console.log("setup-binaries.js is newer than transcribe.exe. Rebuilding...");
    shouldBuild = true;
  }

  if (shouldBuild) {
    try {
      fs.unlinkSync(transcribeDest);
    } catch (err) {
      console.error("Failed to delete outdated transcribe.exe:", err);
    }
  }
}

if (shouldBuild) {
  console.log("Building transcribe.py into transcribe.exe using PyInstaller...");
  try {
    const tempDllsDir = path.join(__dirname, "..", "temp_nvidia_dlls");

    // 1. Copy NVIDIA DLLs from conda environment
    console.log("Collecting NVIDIA CUDA/CuDNN DLLs...");
    const copyCmd = `conda run -n lyrics_player python scripts/copy-nvidia-dlls.py "${tempDllsDir}"`;
    console.log(`Running: ${copyCmd}`);
    execSync(copyCmd, { stdio: "inherit" });

    // 2. Build using PyInstaller with collected DLLs
    const buildCmd = `conda run -n lyrics_player pyinstaller --onefile --clean --collect-all faster_whisper --collect-all ctranslate2 --add-data "${tempDllsDir}/nvidia;nvidia" --distpath "${binDir}" "src/main/services/transcribe.py"`;
    console.log(`Running: ${buildCmd}`);
    execSync(buildCmd, { stdio: "inherit" });
    console.log("transcribe.exe built successfully!");

    // Clean build files
    console.log("Cleaning up temp build directories...");
    const specPath = path.join(__dirname, "..", "transcribe.spec");
    const buildPath = path.join(__dirname, "..", "build");
    if (fs.existsSync(specPath)) fs.unlinkSync(specPath);
    if (fs.existsSync(buildPath)) fs.rmSync(buildPath, { recursive: true, force: true });
    if (fs.existsSync(tempDllsDir)) fs.rmSync(tempDllsDir, { recursive: true, force: true });
  } catch (err) {
    console.error("PyInstaller compilation failed:", err);
    const tempDllsDir = path.join(__dirname, "..", "temp_nvidia_dlls");
    if (fs.existsSync(tempDllsDir)) {
      try { fs.rmSync(tempDllsDir, { recursive: true, force: true }); } catch (e) { }
    }
    process.exit(1);
  }
} else {
  console.log("transcribe.exe already exists in bin/win32 and is up to date.");
}

console.log("Dependency binaries preparation complete!");
