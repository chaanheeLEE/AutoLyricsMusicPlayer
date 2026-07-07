const { spawn } = require("node:child_process");
const { resolveFfmpeg } = require("../services/transcription-worker");

async function extractAlbumArt(audioPath) {
  return new Promise((resolve) => {
    let ffmpegBin;
    try {
      ffmpegBin = resolveFfmpeg();
    } catch {
      return resolve(null);
    }

    const proc = spawn(ffmpegBin, [
      "-y",
      "-i", audioPath,
      "-an",
      "-c:v", "copy",
      "-f", "image2pipe",
      "-"
    ], { stdio: ["ignore", "pipe", "ignore"] });

    let chunks = [];
    proc.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });

    proc.on("close", (code) => {
      if (code === 0 && chunks.length > 0) {
        const buffer = Buffer.concat(chunks);
        let mime = "image/jpeg";
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
          mime = "image/png";
        }
        resolve(`data:${mime};base64,${buffer.toString("base64")}`);
      } else {
        resolve(null);
      }
    });

    proc.on("error", () => {
      resolve(null);
    });
  });
}

module.exports = {
  extractAlbumArt
};
