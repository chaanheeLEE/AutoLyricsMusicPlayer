const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const binDir = path.join(__dirname, "..", "bin", "win32");

// 1. Create directory
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// 2. Resolve or download FFmpeg (ffprobe is no longer needed, saving ~58MB)
const ffmpegDest = path.join(binDir, "ffmpeg.exe");
const legacyFfprobeDest = path.join(binDir, "ffprobe.exe");
if (fs.existsSync(legacyFfprobeDest)) {
  try {
    fs.unlinkSync(legacyFfprobeDest);
    console.log("Removed legacy ffprobe.exe to reduce bundle size.");
  } catch (e) {
    // Ignore error
  }
}

if (!fs.existsSync(ffmpegDest)) {
  console.log("FFmpeg is missing from bin/win32. Attempting to locate or download...");
  let foundFfmpeg = null;

  // Check system PATH
  try {
    const whereFfmpeg = execSync("where.exe ffmpeg", { encoding: "utf8" }).trim().split("\r\n")[0];
    if (whereFfmpeg && fs.existsSync(whereFfmpeg)) {
      foundFfmpeg = whereFfmpeg;
      console.log(`Found ffmpeg in PATH: ${foundFfmpeg}`);
    }
  } catch (e) {
    // Ignore
  }

  // Check WinGet default installation folder
  if (!foundFfmpeg && process.platform === "win32") {
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
              if (fs.existsSync(binFfmpeg) && !foundFfmpeg) {
                foundFfmpeg = binFfmpeg;
                console.log(`Found ffmpeg in WinGet directory: ${foundFfmpeg}`);
                break;
              }
            }
          }
          if (foundFfmpeg) break;
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  // If found locally, copy it
  if (foundFfmpeg && !fs.existsSync(ffmpegDest)) {
    console.log(`Copying ffmpeg: ${foundFfmpeg} -> ${ffmpegDest}`);
    fs.copyFileSync(foundFfmpeg, ffmpegDest);
  }

  // If still missing, download
  if (!fs.existsSync(ffmpegDest)) {
    console.log("FFmpeg binary is still missing. Downloading official essentials release...");
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

      if (foundTempFfmpeg && !fs.existsSync(ffmpegDest)) {
        console.log(`Copying downloaded ffmpeg: ${foundTempFfmpeg} -> ${ffmpegDest}`);
        fs.copyFileSync(foundTempFfmpeg, ffmpegDest);
      }

      if (!fs.existsSync(ffmpegDest)) {
        throw new Error("Could not find ffmpeg.exe in extracted archive.");
      }

      // Cleanup
      fs.unlinkSync(tempZip);
      fs.rmSync(tempExtract, { recursive: true, force: true });
    } catch (err) {
      console.error("Failed to download FFmpeg:", err);
      process.exit(1);
    }
  }
} else {
  console.log("FFmpeg already exists in bin/win32.");
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

// Compress FFmpeg with UPX
if (process.platform === "win32") {
  try {
    compressWithUpx(ffmpegDest);
  } catch (err) {
    console.error("Error during UPX compression of FFmpeg:", err);
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
  const withCuda = process.argv.includes("--with-cuda");
  console.log(`Building transcribe.py into transcribe.exe using PyInstaller (${withCuda ? "Full CUDA Bundle" : "Lightweight CPU Edition"})...`);
  try {
    const tempDllsDir = path.join(__dirname, "..", "temp_nvidia_dlls");

    let pythonRunner = "python";
    let pyinstallerRunner = "pyinstaller";

    try {
      execSync("conda run -n lyrics_player python --version", { stdio: "ignore" });
      console.log("Found conda environment 'lyrics_player'.");
      pythonRunner = "conda run -n lyrics_player python";
      pyinstallerRunner = "conda run -n lyrics_player pyinstaller";
    } catch {
      console.log("Conda environment 'lyrics_player' not found. Using system python...");
      pythonRunner = "python";
      pyinstallerRunner = "python -m PyInstaller";
    }

    let addDataArg = "";
    if (withCuda) {
      // 1. Copy NVIDIA DLLs (Only when --with-cuda flag is specified)
      console.log("Collecting NVIDIA CUDA/CuDNN DLLs (--with-cuda enabled)...");
      const copyCmd = `${pythonRunner} scripts/copy-nvidia-dlls.py "${tempDllsDir}"`;
      console.log(`Running: ${copyCmd}`);
      try {
        execSync(copyCmd, { stdio: "inherit" });
      } catch (e) {
        console.warn("Warning: copy-nvidia-dlls skipped or encountered warning.", e.message);
      }

      if (fs.existsSync(path.join(tempDllsDir, "nvidia"))) {
        addDataArg = `--add-data "${tempDllsDir}/nvidia;nvidia"`;
      }
    } else {
      console.log("[Size Optimization] Skipping CUDA DLL bundling to reduce binary size by ~800MB.");
      console.log("Note: To bundle CUDA/cuDNN DLLs for standalone GPU support, build with '--with-cuda'.");
    }

    // 2. Build using PyInstaller with excludes for unused modules
    const excludeModules = [
      "tkinter",
      "matplotlib",
      "scipy",
      "unittest",
      "test",
      "pydoc"
    ].map(m => `--exclude-module ${m}`).join(" ");

    const buildCmd = `${pyinstallerRunner} --onefile --clean ${excludeModules} --collect-all faster_whisper --collect-all ctranslate2 ${addDataArg} --distpath "${binDir}" "src/main/services/transcribe.py"`;
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
