(function attachLyricsCore(root) {
  function clampTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return 0;
    }

    return seconds;
  }

  function formatClock(seconds) {
    const safeSeconds = clampTime(seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = Math.floor(safeSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainingSeconds}`;
  }

  function formatLrcTimestamp(seconds) {
    const safeSeconds = clampTime(seconds);
    const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, "0");
    const wholeSeconds = Math.floor(safeSeconds % 60).toString().padStart(2, "0");
    const centiseconds = Math.floor((safeSeconds % 1) * 100).toString().padStart(2, "0");
    return `${minutes}:${wholeSeconds}.${centiseconds}`;
  }

  function formatVttTimestamp(seconds) {
    const safeSeconds = clampTime(seconds);
    const hours = Math.floor(safeSeconds / 3600).toString().padStart(2, "0");
    const minutes = Math.floor((safeSeconds % 3600) / 60).toString().padStart(2, "0");
    const wholeSeconds = Math.floor(safeSeconds % 60).toString().padStart(2, "0");
    const milliseconds = Math.floor((safeSeconds % 1) * 1000).toString().padStart(3, "0");
    return `${hours}:${minutes}:${wholeSeconds}.${milliseconds}`;
  }

  function getActiveLineIndex(lyrics, time, syncOffset) {
    if (!lyrics || lyrics.length === 0) {
      return -1;
    }
    const adjustedTime = clampTime(time + syncOffset);
    
    // 극초반 재생 혹은 첫 가사 시작 전에는 항상 첫 가사(index 0)가 하이라이트되도록 조기 리턴
    if (adjustedTime <= lyrics[0].start) {
      return 0;
    }

    let low = 0;
    let high = lyrics.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const line = lyrics[mid];

      if (adjustedTime < line.start) {
        high = mid - 1;
      } else if (adjustedTime > line.end) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    // Default to the first lyric line (index 0) if playback is before the first lyric starts
    return Math.max(Math.min(high, lyrics.length - 1), 0);
  }

  function serializeLrc(lyrics, syncOffset) {
    return lyrics
      .map((line) => {
        const timestamp = formatLrcTimestamp(line.start - syncOffset);
        return `[${timestamp}]${line.text || ""}`;
      })
      .join("\n");
  }

  function serializeVtt(lyrics, syncOffset) {
    const cues = lyrics.map((line, index) => {
      const start = formatVttTimestamp(line.start - syncOffset);
      const end = formatVttTimestamp(Math.max(line.end - syncOffset, line.start - syncOffset + 0.1));
      return `${index + 1}\n${start} --> ${end}\n${line.text || ""}`;
    });

    return `WEBVTT\n\n${cues.join("\n\n")}\n`;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  const api = {
    clampTime,
    formatClock,
    formatLrcTimestamp,
    formatVttTimestamp,
    getActiveLineIndex,
    serializeLrc,
    serializeVtt,
    escapeHtml
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.lyricsCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
