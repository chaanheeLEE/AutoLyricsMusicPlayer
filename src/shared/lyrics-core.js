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

  function parseTimeString(val) {
    if (!val || typeof val !== "string") return NaN;
    const trimmed = val.trim();
    if (!trimmed) return NaN;

    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }

    const parts = trimmed.split(":");
    if (parts.length >= 2) {
      let seconds = 0;
      let multiplier = 1;
      for (let i = parts.length - 1; i >= 0; i--) {
        const num = Number(parts[i]);
        if (isNaN(num)) return NaN;
        seconds += num * multiplier;
        multiplier *= 60;
      }
      return seconds;
    }

    return NaN;
  }

  function adjustTimestamp(seconds, delta) {
    const current = Number.isFinite(seconds) ? seconds : 0;
    return Number(Math.max(0, current + delta).toFixed(3));
  }

  function parseFilenameTitle(rawTitle) {
    if (!rawTitle || typeof rawTitle !== "string") {
      return { title: "No track selected", artist: "-" };
    }
    const clean = rawTitle.replace(/\.(mp3|flac|m4a|wav|ogg|aac|opus|webm)$/i, "").trim();
    if (clean.includes(" - ")) {
      const parts = clean.split(" - ");
      const artist = parts[0].trim() || "-";
      const title = parts.slice(1).join(" - ").trim() || clean;
      return { title, artist };
    }
    return { title: clean || "No track selected", artist: "-" };
  }

  function resolveTrackMeta(trackOrTitle) {
    const empty = {
      title: "No track selected",
      artist: "-",
      album: "",
      albumArtist: "",
      trackNumber: null,
      totalTracks: null,
      discNumber: null,
      totalDiscs: null,
      year: "",
      genre: "",
      duration: null,
      codec: "",
      bitrate: "",
      sampleRate: "",
      fileName: ""
    };

    if (!trackOrTitle) return empty;

    if (typeof trackOrTitle === "string") {
      const parsed = parseFilenameTitle(trackOrTitle);
      return { ...empty, title: parsed.title, artist: parsed.artist, fileName: trackOrTitle };
    }

    const fallback = parseFilenameTitle(trackOrTitle.fileName || trackOrTitle.title);
    const hasRichMeta = Boolean(trackOrTitle.metadataLoaded);
    return {
      title: (hasRichMeta && trackOrTitle.title ? trackOrTitle.title : fallback.title) || "No track selected",
      artist: (trackOrTitle.artist || fallback.artist || "-") || "-",
      album: trackOrTitle.album || "",
      albumArtist: trackOrTitle.albumArtist || "",
      trackNumber: Number.isFinite(trackOrTitle.trackNumber) ? trackOrTitle.trackNumber : null,
      totalTracks: Number.isFinite(trackOrTitle.totalTracks) ? trackOrTitle.totalTracks : null,
      discNumber: Number.isFinite(trackOrTitle.discNumber) ? trackOrTitle.discNumber : null,
      totalDiscs: Number.isFinite(trackOrTitle.totalDiscs) ? trackOrTitle.totalDiscs : null,
      year: trackOrTitle.year || "",
      genre: trackOrTitle.genre || "",
      duration: Number.isFinite(trackOrTitle.duration) && trackOrTitle.duration > 0 ? trackOrTitle.duration : null,
      codec: trackOrTitle.codec || "",
      bitrate: trackOrTitle.bitrate || "",
      sampleRate: trackOrTitle.sampleRate || "",
      fileName: trackOrTitle.fileName || trackOrTitle.title || ""
    };
  }

  function syncShuffleQueue(playlist, currentTrack, existingQueue = [], randomFn = Math.random) {
    if (!Array.isArray(playlist) || playlist.length <= 1) {
      return [];
    }

    const playlistSet = new Set(playlist);
    const seen = new Set();
    const validQueue = [];

    if (Array.isArray(existingQueue)) {
      for (const track of existingQueue) {
        if (playlistSet.has(track) && track !== currentTrack && !seen.has(track)) {
          seen.add(track);
          validQueue.push(track);
        }
      }
    }

    if (validQueue.length > 0) {
      return validQueue;
    }

    const pool = playlist.filter((track) => track !== currentTrack);
    const deck = pool.length > 0 ? pool : [...playlist];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(randomFn() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  const LYRICS_FONT_PRESETS = {
    default: '"Malgun Gothic", "맑은 고딕", "Segoe UI", Inter, Arial, sans-serif',
    serif: '"Noto Serif KR", "Batang", "바탕", "NanumMyeongjo", "나눔명조", Georgia, "Times New Roman", serif',
    rounded: '"NanumSquareRound", "나눔스퀘어라운드", "NanumSquareRoundOTF", "Gulim", "굴림", sans-serif',
    mono: '"D2Coding", "JetBrains Mono", Consolas, "DotumChe", "돋움체", "GulimChe", "굴림체", monospace',
  };

  const GENERIC_FONT_FAMILIES = new Set([
    "sans-serif",
    "serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "ui-rounded",
  ]);

  function resolveLyricsFontFamily(preset = "default", customFont = "") {
    if (preset === "custom") {
      const sanitized = String(customFont || "")
        .split(",")
        .map((part) => part.replace(/["';{}()<>\\]/g, "").trim())
        .filter(Boolean)
        .map((family) => (GENERIC_FONT_FAMILIES.has(family.toLowerCase()) ? family.toLowerCase() : `"${family}"`));

      if (sanitized.length > 0) {
        return `${sanitized.join(", ")}, ${LYRICS_FONT_PRESETS.default}`;
      }
    }
    return LYRICS_FONT_PRESETS[preset] || LYRICS_FONT_PRESETS.default;
  }

  const api = {
    clampTime,
    formatClock,
    formatLrcTimestamp,
    formatVttTimestamp,
    getActiveLineIndex,
    serializeLrc,
    serializeVtt,
    escapeHtml,
    parseTimeString,
    adjustTimestamp,
    resolveTrackMeta,
    syncShuffleQueue,
    LYRICS_FONT_PRESETS,
    resolveLyricsFontFamily
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.lyricsCore = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
