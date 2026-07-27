(function attachLyricsCore(root) {
  function clampTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return 0;
    }

    return seconds;
  }

  function formatClock(seconds, showMs = false) {
    const safeSeconds = clampTime(seconds);
    const minutes = Math.floor(safeSeconds / 60);
    if (showMs) {
      const remainingSeconds = (safeSeconds % 60).toFixed(1).padStart(4, "0");
      return `${minutes}:${remainingSeconds}`;
    }
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

    // 첫 가사 시작 전인 경우 index 0 유지
    if (adjustedTime < lyrics[0].start) {
      return 0;
    }

    // 가사 start 시간을 기준으로 현재 재생 시간에 해당하는 가장 마지막 가사 index 탐색 (표준 LRC 싱크)
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (adjustedTime >= lyrics[i].start) {
        return i;
      }
    }

    return 0;
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
