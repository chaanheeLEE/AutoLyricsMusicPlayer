// UI Elements for main orchestration
const trackTitle = document.querySelector("#trackTitle");
const trackStatus = document.querySelector("#trackStatus");
const albumArt = document.querySelector("#albumArt");
const albumArtPlaceholder = document.querySelector("#albumArtPlaceholder");
const analyzeButton = document.querySelector("#analyzeButton");
const cancelButton = document.querySelector("#cancelButton");
const alignButton = document.querySelector("#alignButton");
const floatingButton = document.querySelector("#floatingButton");
const syncBackButton = document.querySelector("#syncBackButton");
const syncFineBackButton = document.querySelector("#syncFineBackButton");
const syncFineForwardButton = document.querySelector("#syncFineForwardButton");
const syncForwardButton = document.querySelector("#syncForwardButton");
const resetSyncButton = document.querySelector("#resetSyncButton");
const exportLrcButton = document.querySelector("#exportLrcButton");
const exportVttButton = document.querySelector("#exportVttButton");
const syncOffsetBadge = document.querySelector("#syncOffsetBadge");
const playlistList = document.querySelector("#playlistList");

const { formatClock } = window.lyricsCore;

// Global State
const state = {
  playlist: [],
  currentIndex: -1,
  track: null,
  lyrics: [],
  activeLineId: null,
  syncOffset: 0,
  floatingVisible: false,
  isTranscribing: false,
  settings: { model: "base", language: null, geminiApiKey: "", autoAnalyzeMode: "off" },
  editMode: false,
  shuffle: false,
  isAutoAnalyzing: false,
  embeddedLyricsLines: null,
  history: [],
  playlistFilter: "",
};

let saveTimer = null;

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function persistLyricsSoon() {
  if (!state.track || state.lyrics.length === 0) {
    return;
  }

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.lyricsPlayer.saveCachedLyrics({
      track: state.track,
      lyrics: state.lyrics,
      syncOffset: state.syncOffset,
      metadata: { source: "local" }
    });
  }, 250);
}

// -------------------------------------------------------------
// 모듈 인스턴스 초기화 및 콜백 바인딩
// -------------------------------------------------------------

const player = new PlayerController(state, {
  onTimeUpdate: (currentTime) => {
    lyricsViewer.updateActive(currentTime, player.isPlaying());
  },
  onStateChange: (statusText) => {
    trackStatus.textContent = statusText;
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
  },
  onEnded: () => {
    if (state.playlist.length > 0) {
      selectPlaylistItem(getNextIndex());
    }
  },
  onPrev: () => {
    if (state.playlist.length === 0) return;
    if (state.history.length > 0) {
      const prevIndex = state.history.pop();
      selectPlaylistItem(prevIndex, player.isPlaying(), true);
    } else {
      let idx = state.currentIndex - 1;
      if (idx < 0) idx = state.playlist.length - 1;
      selectPlaylistItem(idx, player.isPlaying());
    }
  },
  onNext: () => {
    if (state.playlist.length === 0) return;
    selectPlaylistItem(getNextIndex(), player.isPlaying());
  }
});

const playlist = new PlaylistManager(state, {
  onSelectTrack: (index) => {
    selectPlaylistItem(index);
  },
  onPlaylistChange: () => {
    updateAlignButtonState();
  },
  onClearPlaylist: () => {
    // 플레이리스트 전체 비우기 시의 동기화 처리
    player.setEnabled(false);
    player.loadTrack({ url: "" }, false);
    
    trackTitle.innerHTML = "<span>No track selected</span>";
    updateTitleMarquee();
    trackStatus.textContent = "Add track(s) to start playback.";
    albumArt.src = "";
    albumArt.style.display = "none";
    albumArtPlaceholder.style.display = "flex";
    
    lyricsViewer.render();
    updateAlignButtonState();
  }
});

const lyricsViewer = new LyricsViewer(state, {
  onSeek: (time) => {
    player.setCurrentTime(time);
    lyricsViewer.updateActive(time, player.isPlaying());
  },
  onOffsetChange: () => {
    persistLyricsSoon();
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
  },
  onLyricTextChange: () => {
    persistLyricsSoon();
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
  }
});

const settingsView = new SettingsView(state, {
  onSave: (savedSettings) => {
    trackStatus.textContent = `Settings saved. Model: ${savedSettings.model}, Language: ${savedSettings.language || "auto"}.`;
    updateAlignButtonState();

    if (state.settings.autoAnalyzeMode !== "off" && state.track && state.lyrics.length === 0 && !state.isTranscribing) {
      state.isAutoAnalyzing = true;
      analyzeButton.click();
    }
  }
});

// -------------------------------------------------------------
// Orchestrator 핵심 비즈니스 로직
// -------------------------------------------------------------

function getNextIndex() {
  if (state.playlist.length <= 1) return 0;
  if (state.shuffle) {
    let randIdx;
    do {
      randIdx = Math.floor(Math.random() * state.playlist.length);
    } while (randIdx === state.currentIndex);
    return randIdx;
  } else {
    let nextIdx = state.currentIndex + 1;
    if (nextIdx >= state.playlist.length) nextIdx = 0;
    return nextIdx;
  }
}

function updateTitleMarquee() {
  trackTitle.classList.remove("marquee-active");
  trackTitle.style.removeProperty("--marquee-dist");

  const span = trackTitle.querySelector("span");
  if (!span) return;

  setTimeout(() => {
    const containerWidth = trackTitle.clientWidth;
    const textWidth = span.scrollWidth;
    if (textWidth > containerWidth) {
      const dist = containerWidth - textWidth - 8;
      trackTitle.style.setProperty("--marquee-dist", `${dist}px`);
      trackTitle.classList.add("marquee-active");
    }
  }, 50);
}

window.addEventListener("resize", updateTitleMarquee);

function updateMediaSessionMetadata(track) {
  if (!("mediaSession" in navigator)) return;

  const artwork = [];
  if (track.albumArt) {
    const isPng = track.albumArt.startsWith("data:image/png");
    artwork.push({
      src: track.albumArt,
      sizes: "512x512",
      type: isPng ? "image/png" : "image/jpeg"
    });
  }

  const cleanTitle = track.title.replace(/\.[^/.]+$/, "");

  navigator.mediaSession.metadata = new MediaMetadata({
    title: cleanTitle,
    artist: "Local Track",
    album: "Auto Lyrics Player",
    artwork: artwork
  });
}

async function selectPlaylistItem(index, autoPlay = true, isFromHistory = false) {
  if (index < 0 || index >= state.playlist.length) return;
  state.activeLineId = null;

  if (state.isTranscribing) {
    window.lyricsPlayer.cancelTranscription().catch(() => {});
    state.isTranscribing = false;
    analyzeButton.style.display = "";
    cancelButton.style.display = "none";
    hideProgress();
    trackStatus.textContent = "Analysis cancelled.";
  }

  // 히스토리 기록
  if (!isFromHistory && state.currentIndex >= 0 && state.currentIndex !== index) {
    state.history.push(state.currentIndex);
    if (state.history.length > 50) {
      state.history.shift();
    }
  }

  state.currentIndex = index;
  playlist.saveCache();
  
  const track = state.playlist[index];
  state.track = track;

  // 오디오 소스 설정
  player.loadTrack(track, autoPlay);
  trackTitle.innerHTML = `<span>${escapeHtml(track.title)}</span>`;
  updateTitleMarquee();
  updateMediaSessionMetadata(track);

  // 앨범 아트 설정
  if (track.albumArt) {
    albumArt.src = track.albumArt;
    albumArt.style.display = "block";
    albumArtPlaceholder.style.display = "none";
  } else {
    albumArt.src = "";
    albumArt.style.display = "none";
    albumArtPlaceholder.style.display = "flex";
  }

  setControlsEnabled(true);

  // 캐시 가사 정보 로드
  trackStatus.textContent = "Loading cached lyrics…";
  state.embeddedLyricsLines = null;
  const cached = await window.lyricsPlayer.loadCachedLyrics(track);
  
  // 캐시 상태에 무관하게, 음원 자체에 내장된 평문 가사가 존재하면 항상 보관
  if (cached?.embeddedPlainLyrics) {
    state.embeddedLyricsLines = cached.embeddedPlainLyrics;
  } else if (cached?.lyrics && cached.metadata?.source === "embedded_plain") {
    state.embeddedLyricsLines = cached.lyrics.map(l => l.text);
  }

  if (cached?.lyrics && cached.metadata?.source === "embedded_plain") {
    state.lyrics = [];
    lyricsViewer.setOffset(0);
    trackStatus.textContent = `내장 가사 ${state.embeddedLyricsLines.length}줄 감지됨. Analyze 실행 후 AI Align으로 싱크 적용 가능.`;
    analyzeButton.textContent = "Analyze";

    if (
      state.settings.autoAnalyzeMode === "align" &&
      (state.settings.geminiApiKey || "").trim().length > 0 &&
      !state.isTranscribing
    ) {
      state.isAutoAnalyzing = true;
      setTimeout(() => {
        analyzeButton.click();
      }, 100);
    }
  } else if (cached?.lyrics) {
    state.lyrics = cached.lyrics;
    lyricsViewer.setOffset(cached.syncOffset || 0);
    trackStatus.textContent = state.embeddedLyricsLines
      ? `Loaded cached lyrics. (내장 평문 가사 보존됨)`
      : `Loaded cached lyrics.`;
    analyzeButton.textContent = "Reanalyze";
  } else {
    state.lyrics = [];
    lyricsViewer.setOffset(0);
    trackStatus.textContent = "No cached lyrics. Press Analyze to generate.";
    analyzeButton.textContent = "Analyze";

    if (state.settings.autoAnalyzeMode !== "off" && !state.isTranscribing) {
      state.isAutoAnalyzing = true;
      setTimeout(() => {
        analyzeButton.click();
      }, 100);
    }
  }

  lyricsViewer.render();
  lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
  playlist.render();
  updateAlignButtonState();

  const activeItem = playlistList.querySelector(".playlist-item.active");
  if (activeItem) {
    activeItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function updateAlignButtonState() {
  const hasApiKey = !!(state.settings?.geminiApiKey || "").trim();
  const hasLyrics = state.lyrics && state.lyrics.length > 0;
  const isAligned = hasLyrics && state.lyrics[0]?.id?.startsWith("align_");

  alignButton.classList.toggle("realign-state", isAligned);

  if (!hasApiKey || !hasLyrics) {
    alignButton.disabled = true;
    alignButton.title = !hasApiKey 
      ? "Gemini API Key is required. Please set it in settings." 
      : "No lyrics to align. Please analyze the track first.";
    alignButton.textContent = "AI Align";
  } else {
    alignButton.disabled = false;
    alignButton.title = isAligned 
      ? "Re-run AI Alignment using Gemini" 
      : "AI Align Lyrics using Gemini";
    alignButton.textContent = isAligned ? "AI Realign" : "AI Align";
  }
}

function setControlsEnabled(enabled) {
  player.setEnabled(enabled);
  playlist.setEnabled(enabled);
  lyricsViewer.setEnabled(enabled);
  
  analyzeButton.disabled = !enabled;
  floatingButton.disabled = !enabled;
  syncBackButton.disabled = !enabled;
  syncFineBackButton.disabled = !enabled;
  syncFineForwardButton.disabled = !enabled;
  syncForwardButton.disabled = !enabled;
  resetSyncButton.disabled = !enabled;
  exportLrcButton.disabled = !enabled;
  exportVttButton.disabled = !enabled;
  
  updateAlignButtonState();
}

function showProgress(label, percent) {
  const transcriptionProgress = document.querySelector("#transcriptionProgress");
  const progressLabel = document.querySelector("#progressLabel");
  const progressBar = document.querySelector("#progressBar");
  
  transcriptionProgress.style.display = "block";
  progressLabel.textContent = label;
  progressBar.style.width = `${Math.min(Math.max(percent * 100, 0), 100)}%`;
}

function hideProgress() {
  const transcriptionProgress = document.querySelector("#transcriptionProgress");
  const progressBar = document.querySelector("#progressBar");
  
  transcriptionProgress.style.display = "none";
  progressBar.style.width = "0%";
}

// -------------------------------------------------------------
// 이벤트 바인딩 및 오케스트레이터 액션
// -------------------------------------------------------------

alignButton.addEventListener("click", async () => {
  if (!state.track || state.lyrics.length === 0) {
    trackStatus.textContent = "No lyrics to align. Run Analyze first.";
    return;
  }

  const apiKey = state.settings.geminiApiKey || "";
  if (!apiKey.trim()) {
    trackStatus.textContent = "Gemini API Key is required for AI Alignment. Please configure it in settings.";
    settingsView.open();
    return;
  }

  state.isTranscribing = true;
  alignButton.style.display = "none";
  analyzeButton.style.display = "none";
  showProgress("Searching & alignment in progress…", 0.5);
  trackStatus.textContent = "AI Alignment in progress…";

  try {
    const result = await window.lyricsPlayer.alignLyrics({
      track: state.track,
      whisperLyrics: state.lyrics,
      settings: state.settings,
      embeddedLyricsLines: state.embeddedLyricsLines || null
    });

    if (result?.ok && result.lyrics?.length > 0) {
      state.lyrics = result.lyrics;
      lyricsViewer.setOffset(0);
      
      if (result.warning === "fallback_to_whisper") {
        console.error("[Aligner] Fallback to whisper active. AI Align Error detail:\n", result.errorDetail);
        trackStatus.textContent = `AI Alignment Failed: ${result.errorDetail.split('\n')[0]}`;
      } else {
        trackStatus.textContent = `AI Alignment complete. ${result.lyrics.length} official lines mapped.`;
      }

      lyricsViewer.render();
      lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
      persistLyricsSoon();
      updateAlignButtonState();
    } else {
      trackStatus.textContent = `AI Alignment failed: ${result?.error || "unknown error"}`;
    }
  } catch (error) {
    trackStatus.textContent = `AI Alignment failed: ${error.message}`;
  } finally {
    state.isTranscribing = false;
    alignButton.style.display = "";
    analyzeButton.style.display = "";
    hideProgress();
  }
});

analyzeButton.addEventListener("click", async () => {
  if (!state.track) {
    state.isAutoAnalyzing = false;
    return;
  }

  state.isTranscribing = true;
  analyzeButton.style.display = "none";
  cancelButton.style.display = "";
  cancelButton.disabled = false;
  showProgress("Converting audio…", 0);
  trackStatus.textContent = "Analyzing…";

  const originalTrackKey = state.track.cacheKey;

  // Whisper 설정 및 힌트 프롬프트 구성
  const options = { ...(state.settings || {}) };
  if (state.embeddedLyricsLines && state.embeddedLyricsLines.length > 0) {
    // 내장 가사가 있을 경우 상위 5줄을 힌트로 사용
    options.initialPrompt = state.embeddedLyricsLines.slice(0, 5).join(" ");
  } else if (state.track.title) {
    // 내장 가사가 없을 경우 파일명을 힌트로 사용 (확장자 제거)
    options.initialPrompt = state.track.title.replace(/\.[^/.]+$/, "");
  }
  if (options.beamSize === undefined) {
    options.beamSize = 5;
  }

  const result = await window.lyricsPlayer.startTranscription(state.track, options);

  if (!state.track || state.track.cacheKey !== originalTrackKey) {
    state.isAutoAnalyzing = false;
    return;
  }

  state.isTranscribing = false;
  cancelButton.style.display = "none";
  analyzeButton.style.display = "";
  hideProgress();

  if (result?.ok && result.lyrics?.length > 0) {
    state.lyrics = result.lyrics;
    lyricsViewer.setOffset(0);
    trackStatus.textContent = `Transcription complete. ${result.lyrics.length} lines found.`;
    analyzeButton.textContent = "Reanalyze";
    lyricsViewer.render();
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
    persistLyricsSoon();
    updateAlignButtonState();

    if (state.isAutoAnalyzing && state.settings.autoAnalyzeMode === "align" && (state.settings.geminiApiKey || "").trim().length > 0) {
      setTimeout(() => {
        alignButton.click();
      }, 500);
    }
  } else if (result?.ok && result.lyrics?.length === 0) {
    trackStatus.textContent = "No speech detected. Check settings or audio file.";
    updateAlignButtonState();
  } else {
    trackStatus.textContent = `Analysis failed: ${result?.error || "unknown error"}`;
    updateAlignButtonState();
  }

  state.isAutoAnalyzing = false;
});

cancelButton.addEventListener("click", async () => {
  cancelButton.disabled = true;
  await window.lyricsPlayer.cancelTranscription();
  state.isTranscribing = false;
  analyzeButton.style.display = "";
  cancelButton.style.display = "none";
  hideProgress();
  trackStatus.textContent = "Analysis cancelled.";
});

floatingButton.addEventListener("click", async () => {
  state.floatingVisible = !state.floatingVisible;
  const visible = await window.lyricsPlayer.toggleFloating(state.floatingVisible);
  state.floatingVisible = visible;
  floatingButton.textContent = visible ? "Hide Floating Lyrics" : "Show Floating Lyrics";
  floatingButton.classList.toggle("active", visible);
  lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
  localStorage.setItem("floating_visible", String(visible));
});

syncBackButton.addEventListener("click", () => {
  lyricsViewer.setOffset(state.syncOffset - 0.5);
});

syncFineBackButton.addEventListener("click", () => {
  lyricsViewer.setOffset(state.syncOffset - 0.1);
});

syncFineForwardButton.addEventListener("click", () => {
  lyricsViewer.setOffset(state.syncOffset + 0.1);
});

syncForwardButton.addEventListener("click", () => {
  lyricsViewer.setOffset(state.syncOffset + 0.5);
});

resetSyncButton.addEventListener("click", () => {
  lyricsViewer.setOffset(0);
});

async function exportLyrics(format) {
  const result = await window.lyricsPlayer.exportLyrics({
    format,
    lyrics: state.lyrics,
    syncOffset: state.syncOffset,
    trackTitle: state.track?.title || "lyrics"
  });

  if (result?.ok) {
    trackStatus.textContent = `Exported ${format.toUpperCase()} lyrics.`;
  } else if (!result?.cancelled) {
    trackStatus.textContent = "No lyrics available to export.";
  }
}

exportLrcButton.addEventListener("click", () => {
  exportLyrics("lrc");
});

exportVttButton.addEventListener("click", () => {
  exportLyrics("vtt");
});

window.lyricsPlayer.onFloatingClosed(() => {
  state.floatingVisible = false;
  floatingButton.textContent = "Show Floating Lyrics";
  floatingButton.classList.remove("active");
  localStorage.setItem("floating_visible", "false");
});

window.lyricsPlayer.onPlaybackCommand((command) => {
  if (command === "toggle-play") {
    player.togglePlay();
  }

  if (command === "prev-track") {
    player.prev();
  }

  if (command === "next-track") {
    player.next();
  }

  if (command === "close-floating") {
    if (state.floatingVisible) {
      floatingButton.click();
    }
  }
});

const STAGE_LABELS = {
  loading_model: "Loading model…",
  converting: "Converting audio…",
  transcribing: "Transcribing…",
  saving: "Saving…",
  cancelled: "Cancelled.",
};

const STAGE_PERCENT = {
  loading_model: 0.05,
  converting: 0.15,
  transcribing: 0.2,
  saving: 0.95,
};

window.lyricsPlayer.onTranscriptionProgress((msg) => {
  if (msg.type === "progress") {
    const label = STAGE_LABELS[msg.stage] || msg.stage;
    const pct = msg.percent ?? STAGE_PERCENT[msg.stage] ?? 0;
    showProgress(label, pct);
  } else if (msg.type === "segment") {
    showProgress(`Transcribing… (${msg.id})`, 0.5);
  } else if (msg.type === "error") {
    hideProgress();
    trackStatus.textContent = `Error: ${msg.message}`;
  }
});

function initMediaSession() {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.setActionHandler("play", () => {
    if (state.playlist.length === 0) return;
    player.play();
  });

  navigator.mediaSession.setActionHandler("pause", () => {
    player.pause();
  });

  navigator.mediaSession.setActionHandler("previoustrack", () => {
    if (state.playlist.length === 0) return;
    let idx = state.currentIndex - 1;
    if (idx < 0) idx = state.playlist.length - 1;
    selectPlaylistItem(idx, player.isPlaying());
  });

  navigator.mediaSession.setActionHandler("nexttrack", () => {
    if (state.playlist.length === 0) return;
    selectPlaylistItem(getNextIndex(), player.isPlaying());
  });

  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (Number.isFinite(player.getDuration())) {
      let seekTime = details.seekTime;
      player.setCurrentTime(seekTime);
      player.updatePlaybackPosition();
    }
  });
}

// -------------------------------------------------------------
// App Initialization
// -------------------------------------------------------------

(async () => {
  initMediaSession();

  // Restore shuffle state
  const savedShuffle = localStorage.getItem("shuffle") === "true";
  state.shuffle = savedShuffle;
  const shuffleButton = document.querySelector("#shuffleButton");
  shuffleButton.textContent = `Shuffle: ${state.shuffle ? "ON" : "OFF"}`;
  shuffleButton.classList.toggle("active", state.shuffle);

  // Restore playlist from localStorage
  try {
    const rawPlaylist = localStorage.getItem("playlist");
    if (rawPlaylist) {
      const parsed = JSON.parse(rawPlaylist);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.playlist = parsed.map((track, idx) => {
          if (track.originalOrder === undefined) {
            track.originalOrder = idx;
          }
          return track;
        });
        playlist.render();
        
        trackTitle.innerHTML = "<span>Loading playlist…</span>";
        trackStatus.textContent = "Restoring player state…";
      }
    }
  } catch (e) {
    console.error("Failed to load playlist cache", e);
  }

  // Load configuration from API
  const [loaded, dataPath] = await Promise.all([
    window.lyricsPlayer.loadSettings(),
    window.lyricsPlayer.getAppDataPath(),
  ]);
  
  state.settings = loaded;
  settingsView.bindConfigValues(loaded, dataPath);
  setControlsEnabled(false);

  // Load last active track
  if (state.playlist.length > 0) {
    let lastIndex = parseInt(localStorage.getItem("playlist_index") || "0", 10);
    if (lastIndex < 0 || lastIndex >= state.playlist.length) {
      lastIndex = 0;
    }
    await selectPlaylistItem(lastIndex, false);
  }
  
  // Restore playlist size from cache
  const cachedHeight = localStorage.getItem("playlist_height");
  if (cachedHeight) {
    document.querySelector(".playlist-section").style.height = cachedHeight;
  }

  // Restore floating visibility
  const savedFloating = localStorage.getItem("floating_visible") === "true";
  if (savedFloating) {
    state.floatingVisible = true;
    const visible = await window.lyricsPlayer.toggleFloating(true);
    state.floatingVisible = visible;
    floatingButton.textContent = visible ? "Hide Floating Lyrics" : "Show Floating Lyrics";
    floatingButton.classList.toggle("active", visible);
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
  }

  updateAlignButtonState();
})();

// --- Playlist Height Resizer ---
(() => {
  const playlistResizer = document.querySelector("#playlistResizer");
  const playlistSection = document.querySelector(".playlist-section");

  if (!playlistResizer || !playlistSection) return;

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  playlistResizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = playlistSection.offsetHeight;
    playlistResizer.classList.add("resizing");
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const dy = e.clientY - startY;
    const newHeight = startHeight - dy;

    if (newHeight >= 60 && newHeight <= 450) {
      playlistSection.style.height = `${newHeight}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      playlistResizer.classList.remove("resizing");
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      localStorage.setItem("playlist_height", playlistSection.style.height);
    }
  });

  // -------------------------------------------------------------
  // 단축키 제어 (Keyboard Shortcuts)
  // -------------------------------------------------------------
  const DEFAULT_SHORTCUTS = {
    togglePlay: "Space",
    seekBackward: "ArrowLeft",
    seekForward: "ArrowRight",
    volumeUp: "ArrowUp",
    volumeDown: "ArrowDown",
    prevTrack: "KeyP",
    nextTrack: "KeyN",
    toggleMute: "KeyM",
    toggleFloating: "KeyF",
  };

  document.addEventListener("keydown", (e) => {
    // 입력창에 포커스가 있는 경우 단축키 동작 무시
    const activeEl = document.activeElement;
    if (activeEl && (
      (activeEl.tagName === "INPUT" && (activeEl.type === "text" || activeEl.type === "password" || activeEl.type === "number")) ||
      activeEl.tagName === "TEXTAREA" ||
      activeEl.isContentEditable
    )) {
      return;
    }

    const shortcuts = state.settings?.shortcuts || DEFAULT_SHORTCUTS;

    switch (e.code) {
      case shortcuts.togglePlay:
        e.preventDefault(); // 스페이스바 브라우저 스크롤 방지
        player.togglePlay();
        break;
      case shortcuts.seekBackward:
        e.preventDefault();
        const curTimeLeft = player.getCurrentTime();
        if (Number.isFinite(curTimeLeft)) {
          player.setCurrentTime(Math.max(0, curTimeLeft - 5));
        }
        break;
      case shortcuts.seekForward:
        e.preventDefault();
        const curTimeRight = player.getCurrentTime();
        const duration = player.getDuration();
        if (Number.isFinite(curTimeRight) && Number.isFinite(duration)) {
          player.setCurrentTime(Math.min(duration, curTimeRight + 5));
        }
        break;
      case shortcuts.volumeUp:
        e.preventDefault();
        const curVolUp = player.audio.volume;
        player.setVolume(Math.min(1.0, Number((curVolUp + 0.05).toFixed(2))));
        break;
      case shortcuts.volumeDown:
        e.preventDefault();
        const curVolDown = player.audio.volume;
        player.setVolume(Math.max(0.0, Number((curVolDown - 0.05).toFixed(2))));
        break;
      case shortcuts.nextTrack:
        player.next();
        break;
      case shortcuts.prevTrack:
        player.prev();
        break;
      case shortcuts.toggleMute:
        if (player.audio.volume > 0) {
          state.savedVolume = player.audio.volume;
          player.setVolume(0);
        } else {
          player.setVolume(state.savedVolume || 0.85);
        }
        break;
      case shortcuts.toggleFloating:
        if (!floatingButton.disabled) {
          floatingButton.click();
        }
        break;
    }
  });
})();
