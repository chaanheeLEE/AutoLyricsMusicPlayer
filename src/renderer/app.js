// UI Elements for main orchestration
const trackTitle = document.querySelector("#trackTitle");
const trackArtist = document.querySelector("#trackArtist");
const trackAlbumMeta = document.querySelector("#trackAlbumMeta");
const trackStatusBadge = document.querySelector("#trackStatusBadge");
const trackStatus = document.querySelector("#trackStatus");
const albumArt = document.querySelector("#albumArt");
const albumArtPlaceholder = document.querySelector("#albumArtPlaceholder");

// Action & Lyrics Bar Elements
const analyzeButton = document.querySelector("#analyzeButton");
const cancelButton = document.querySelector("#cancelButton");
const alignButton = document.querySelector("#alignButton");
const mainAnalyzeButton = document.querySelector("#mainAnalyzeButton");
const mainCancelButton = document.querySelector("#mainCancelButton");
const mainAlignButton = document.querySelector("#mainAlignButton");
const mainVocalIsolationToggle = document.querySelector("#mainVocalIsolationToggle");
const editVocalIsolationToggle = document.querySelector("#editVocalIsolationToggle");
const syncBackButton = document.querySelector("#syncBackButton");
const syncFineBackButton = document.querySelector("#syncFineBackButton");
const syncFineForwardButton = document.querySelector("#syncFineForwardButton");
const syncForwardButton = document.querySelector("#syncForwardButton");
const resetSyncButton = document.querySelector("#resetSyncButton");
const exportLrcButton = document.querySelector("#exportLrcButton");
const exportVttButton = document.querySelector("#exportVttButton");
const deleteCacheButton = document.querySelector("#deleteCacheButton");
const syncOffsetBadge = document.querySelector("#syncOffsetBadge");
const playlistList = document.querySelector("#playlistList");

// Persistent Player Bar Elements
const playerBar = document.querySelector("#playerBar");
const playerBarTitle = document.querySelector("#playerBarTitle");
const playerBarArtist = document.querySelector("#playerBarArtist");
const playerBarArt = document.querySelector("#playerBarArt");
const playerBarPlaceholder = document.querySelector("#playerBarPlaceholder");

// Edit Header Elements
const editTrackTitle = document.querySelector("#editTrackTitle");
const editTrackArt = document.querySelector("#editTrackArt");
const editTrackArtPlaceholder = document.querySelector("#editTrackArtPlaceholder");

const { formatClock, escapeHtml } = window.lyricsCore;

// Global State
const state = {
  playlist: [],
  currentIndex: -1,
  track: null,
  lyrics: [],
  lyricsSource: null,
  activeLineId: null,
  syncOffset: 0,
  floatingVisible: false,
  isTranscribing: false,
  vocalModelInstalled: false,
  settings: { theme: "lyra", model: "base", language: null, geminiApiKey: "", autoAnalyzeMode: "off", vocalIsolation: false },
  editMode: false,
  shuffle: false,
  shuffleQueue: [],
  repeatMode: "all",
  isAutoAnalyzing: false,
  alignSuggestedTrackKey: null,
  embeddedLyricsLines: null,
  plainLyricsSource: null,
  history: [],
  forwardHistory: [],
  playlistFilter: "",
};

// escapeHtml은 window.lyricsCore.escapeHtml로 일원화되었습니다.

function parseArtistTitle(trackOrTitle) {
  const meta = window.lyricsCore.resolveTrackMeta(trackOrTitle);
  return { title: meta.title, artist: meta.artist };
}

function updateTrackAlbumMeta(track) {
  if (!trackAlbumMeta) return;
  if (!track) {
    trackAlbumMeta.textContent = "";
    trackAlbumMeta.style.display = "none";
    return;
  }
  const meta = window.lyricsCore.resolveTrackMeta(track);
  const parts = [];
  if (meta.album) parts.push(meta.album);
  if (meta.year) parts.push(meta.year);
  if (meta.trackNumber) {
    parts.push(meta.totalTracks ? `Track ${meta.trackNumber}/${meta.totalTracks}` : `Track ${meta.trackNumber}`);
  }
  if (parts.length > 0) {
    trackAlbumMeta.textContent = parts.join(" · ");
    trackAlbumMeta.title = parts.join(" · ");
    trackAlbumMeta.style.display = "block";
  } else {
    trackAlbumMeta.textContent = "";
    trackAlbumMeta.style.display = "none";
  }
}

function updatePlayerBarInfo(track) {
  if (!playerBarTitle || !playerBarArtist) return;
  if (!track) {
    playerBarTitle.textContent = "No track selected";
    playerBarTitle.title = "선택된 트랙 없음";
    playerBarArtist.textContent = "-";
    playerBarArtist.title = "";
    if (playerBarArt) {
      playerBarArt.src = "";
      playerBarArt.style.display = "none";
    }
    if (playerBarPlaceholder) playerBarPlaceholder.style.display = "flex";
    return;
  }

  const { title, artist } = parseArtistTitle(track);
  playerBarTitle.textContent = title;
  playerBarTitle.title = title;
  playerBarArtist.textContent = artist;
  playerBarArtist.title = artist;

  if (track.albumArt && playerBarArt) {
    playerBarArt.src = track.albumArt;
    playerBarArt.style.display = "block";
    if (playerBarPlaceholder) playerBarPlaceholder.style.display = "none";
  } else {
    if (playerBarArt) {
      playerBarArt.src = "";
      playerBarArt.style.display = "none";
    }
    if (playerBarPlaceholder) playerBarPlaceholder.style.display = "flex";
  }
}

function updateTrackStatusBadge() {
  if (!trackStatusBadge) return;
  if (!state.track) {
    trackStatusBadge.textContent = "대기 중";
    trackStatusBadge.className = "track-status-badge";
    return;
  }
  if (state.isTranscribing) {
    trackStatusBadge.textContent = "AI 분석 중…";
    trackStatusBadge.className = "track-status-badge analyzing";
  } else if (state.lyrics && state.lyrics.length > 0) {
    trackStatusBadge.textContent = `가사 동기화됨 (${state.lyrics.length}줄)`;
    trackStatusBadge.className = "track-status-badge ready";
  } else if (state.embeddedLyricsLines && state.embeddedLyricsLines.length > 0) {
    const plainOriginLabel = window.lyricsCore.resolvePlainLyricsSourceLabel(state.plainLyricsSource);
    trackStatusBadge.textContent = `${plainOriginLabel} 감지됨 (${state.embeddedLyricsLines.length}줄)`;
    trackStatusBadge.className = "track-status-badge";
  } else {
    trackStatusBadge.textContent = "가사 미생성";
    trackStatusBadge.className = "track-status-badge";
  }
}

function updateEditHeaderInfo(track) {
  if (editTrackTitle) {
    editTrackTitle.textContent = track ? parseArtistTitle(track).title : "선택된 곡 없음";
  }
  if (editTrackArt && editTrackArtPlaceholder) {
    if (track?.albumArt) {
      editTrackArt.src = track.albumArt;
      editTrackArt.style.display = "block";
      editTrackArtPlaceholder.style.display = "none";
    } else {
      editTrackArt.src = "";
      editTrackArt.style.display = "none";
      editTrackArtPlaceholder.style.display = "flex";
    }
  }
}

function applyActiveTrackInfoUI(track) {
  if (!track) return;
  const { title, artist } = parseArtistTitle(track);
  trackTitle.innerHTML = `<span>${escapeHtml(title)}</span>`;
  if (trackArtist) trackArtist.textContent = artist;
  updateTrackAlbumMeta(track);
  updateTitleMarquee();
  updatePlayerBarInfo(track);
  updateEditHeaderInfo(track);
  shellControls.updateMediaSessionMetadata(track);
}

function setTrackAlbumArtUI(track) {
  const hasArt = Boolean(track?.albumArt);
  if (albumArt) {
    albumArt.src = hasArt ? track.albumArt : "";
    albumArt.style.display = hasArt ? "block" : "none";
  }
  if (albumArtPlaceholder) {
    albumArtPlaceholder.style.display = hasArt ? "none" : "flex";
  }
  if (playerBarArt) {
    playerBarArt.src = hasArt ? track.albumArt : "";
    playerBarArt.style.display = hasArt ? "block" : "none";
  }
  if (playerBarPlaceholder) {
    playerBarPlaceholder.style.display = hasArt ? "none" : "flex";
  }
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
  onEnded: () => trackController.handleEnded(),
  onPrev: () => trackController.handlePrev(),
  onNext: () => trackController.handleNext(),
  onShuffleChange: () => trackController.handleShuffleChange()
});

const playlist = new PlaylistManager(state, {
  onSelectTrack: (index) => {
    trackController.selectPlaylistItem(index);
  },
  onPlaylistChange: () => {
    updateAlignButtonState();
    trackController.prefetchNextTrack();
  },
  onTrackMetadataUpdated: (updatedTrack) => {
    if (state.track === updatedTrack) {
      applyActiveTrackInfoUI(updatedTrack);
    }
  },
  onClearPlaylist: () => {
    trackController.clearScheduledTimers();
    state.alignSuggestedTrackKey = null;
    state.lyricsSource = null;
    state.plainLyricsSource = null;
    state.history = [];
    state.forwardHistory = [];
    state.shuffleQueue = [];
    trackController.flushPendingLyricsSaves();
    lyricsJobManager.cancelActiveJob({ silent: true }).catch(() => {});

    // 플레이리스트 전체 비우기 시의 동기화 처리
    player.setEnabled(false);
    player.loadTrack({ url: "" }, false);
    
    trackTitle.innerHTML = "<span>No track selected</span>";
    if (trackArtist) trackArtist.textContent = "-";
    updateTrackAlbumMeta(null);
    updateTitleMarquee();
    trackStatus.textContent = "Add track(s) to start playback.";
    albumArt.src = "";
    albumArt.style.display = "none";
    albumArtPlaceholder.style.display = "flex";
    
    updatePlayerBarInfo(null);
    updateEditHeaderInfo(null);
    updateTrackStatusBadge();
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
    trackController.persistLyricsSoon();
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
    updateDeleteCacheButtonState();
  },
  onLyricTextChange: () => {
    trackController.persistLyricsSoon();
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
    updateDeleteCacheButtonState();
  },
  onEditDone: () => {
    trackController.persistLyricsImmediately();
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
    updateDeleteCacheButtonState();
  },
  onGetCurrentTime: () => {
    return player.getCurrentTime();
  },
  onToggleEditView: (isEdit) => {
    shellControls.switchView(isEdit ? "lyrics-edit" : "now-playing");
  }
});

const settingsView = new SettingsView(state, {
  onSave: (savedSettings) => {
    const engineText = savedSettings.sttEngine === "gemini" ? `Gemini API (${savedSettings.geminiModel || "gemini-3.5-flash-lite"})` : `Local Whisper (${savedSettings.model})`;
    trackStatus.textContent = `Settings saved. Engine: ${engineText}, Language: ${savedSettings.language || "auto"}.`;
    updateAlignButtonState();
    updateVocalIsolationChipUI();

    if (state.settings.autoAnalyzeMode !== "off" && state.track && state.lyrics.length === 0 && !state.isTranscribing) {
      lyricsJobManager.handleAnalyzeClick({ isAuto: true, expectedTrackKey: state.track.cacheKey });
    }
  },
  onVocalModelStatusChange: (status) => {
    state.vocalModelInstalled = Boolean(status?.installed);
    updateVocalIsolationChipUI();
  }
});

const lyricsJobManager = new LyricsJobManager(state, player, lyricsViewer, settingsView, {
  persistLyricsSoon: (payload) => trackController.persistLyricsSoon(payload),
  persistLyricsImmediately: (payload) => trackController.persistLyricsImmediately(payload),
  updateAlignButtonState,
  updateAnalyzeButtonState,
  updateVocalIsolationChipUI,
  updateTrackStatusBadge,
  updateDeleteCacheButtonState
});

const embedManager = new EmbedManager(state, trackStatus, updateAlignButtonState);

const onboardingManager = new OnboardingManager(state);

const shellControls = new ShellControls({
  state,
  player,
  lyricsViewer,
  playlist,
  callbacks: {
    onEnterEditView: () => updateEditHeaderInfo(state.track),
    onSaveEdit: () => trackController.persistLyricsImmediately()
  }
});
shellControls.init();

const trackController = new TrackController({
  state,
  player,
  playlist,
  lyricsViewer,
  lyricsJobManager,
  embedManager,
  callbacks: {
    applyActiveTrackInfoUI,
    updateTrackStatusBadge,
    setTrackAlbumArtUI,
    onAlbumArtLoaded: (track) => {
      setTrackAlbumArtUI(track);
      updateEditHeaderInfo(track);
      playlist.render();
    },
    setControlsEnabled,
    setTrackStatusText: (text) => {
      trackStatus.textContent = text;
    },
    updateActionButtonsState,
    updateDeleteCacheButtonState,
    scrollToActivePlaylistItem: () => {
      const activeItem = playlistList?.querySelector(".playlist-item.active");
      if (activeItem) {
        activeItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }
});

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

function updateDeleteCacheButtonState() {
  if (deleteCacheButton) {
    const hasCacheToClear = !!(state.track && state.lyrics && state.lyrics.length > 0);
    deleteCacheButton.style.display = hasCacheToClear ? "" : "none";
  }
}

if (deleteCacheButton) {
  deleteCacheButton.addEventListener("click", async () => {
    if (!state.track) return;
    
    if (confirm(`'${state.track.title}' 곡의 저장된 가사 캐시를 삭제하시겠습니까?`)) {
      const res = await window.lyricsPlayer.deleteTrackCache(state.track);
      if (res?.ok) {
        state.lyrics = [];
        state.lyricsSource = null;
        state.syncOffset = 0;
        state.alignSuggestedTrackKey = null;
        lyricsViewer.setOffset(0);
        lyricsViewer.render();
        trackStatus.textContent = "Cache deleted. Press Analyze to generate lyrics.";
        updateTrackStatusBadge();
        updateActionButtonsState();
        updateDeleteCacheButtonState();
      } else {
        alert(`캐시 삭제 실패: ${res?.error || "unknown error"}`);
      }
    }
  });
}

function updateAnalyzeButtonState() {
  const hasLyrics = Boolean(state.lyrics && state.lyrics.length > 0);
  const isAiAnalyzed = window.lyricsCore.isAiAnalyzedLyricsSource(state.lyricsSource, hasLyrics);

  for (const btn of [analyzeButton, mainAnalyzeButton]) {
    if (!btn) continue;
    btn.classList.toggle("reanalyze-state", isAiAnalyzed);
    btn.textContent = isAiAnalyzed ? "AI 재분석" : "AI 가사 분석";
    btn.title = isAiAnalyzed
      ? "현재 곡의 가사를 다시 AI로 분석합니다"
      : "AI 음성 인식으로 가사를 생성합니다";
  }
}

function updateAlignButtonState() {
  const hasApiKey = !!(state.settings?.geminiApiKey || "").trim();
  const hasLyrics = Boolean(state.lyrics && state.lyrics.length > 0);
  const isAligned = hasLyrics && state.lyrics[0]?.id?.startsWith("align_");
  const isSuggested = !state.isTranscribing && hasApiKey && hasLyrics && !isAligned && state.alignSuggestedTrackKey === state.track?.cacheKey;

  for (const btn of [alignButton, mainAlignButton]) {
    if (!btn) continue;
    btn.classList.toggle("realign-state", isAligned);
    btn.classList.toggle("align-suggested", isSuggested);

    if (state.isTranscribing) {
      btn.disabled = true;
    } else if (!hasApiKey || !hasLyrics) {
      btn.disabled = true;
      btn.title = !hasApiKey
        ? "Gemini API Key가 필요합니다. 설정에서 입력해주세요."
        : "정합할 가사가 없습니다. 먼저 AI 가사 분석을 실행해주세요.";
      btn.textContent = "AI 정합";
    } else {
      btn.disabled = false;
      btn.title = isAligned
        ? "Gemini AI로 공식 가사와 타임스탬프를 다시 정합합니다"
        : "Gemini AI로 공식 가사와 타임스탬프를 정밀 정합합니다";
      btn.textContent = isAligned ? "AI 재정합" : "AI 정합";
    }
  }
}

function updateActionButtonsState() {
  updateAnalyzeButtonState();
  updateAlignButtonState();
  updateVocalIsolationChipUI();
}

function updateVocalIsolationChipUI() {
  const show = state.settings?.sttEngine !== "gemini" && Boolean(state.vocalModelInstalled);
  const enabled = Boolean(state.settings?.vocalIsolation);
  const labelText = enabled ? "보컬 분리: ON" : "보컬 분리: OFF";
  const chips = [mainVocalIsolationToggle, editVocalIsolationToggle];

  for (const chip of chips) {
    if (!chip) continue;
    chip.style.display = show ? "inline-flex" : "none";
    chip.classList.toggle("active", enabled);
    chip.setAttribute("aria-pressed", String(enabled));
    chip.disabled = Boolean(state.isTranscribing);
    const labelEl = chip.querySelector(".vocal-chip-label");
    if (labelEl) labelEl.textContent = labelText;
  }
}

async function handleVocalIsolationChipToggle() {
  if (!state.vocalModelInstalled || state.isTranscribing) return;
  const nextVal = !state.settings?.vocalIsolation;
  state.settings = { ...(state.settings || {}), vocalIsolation: nextVal };
  const settingsSelect = document.querySelector("#settingVocalIsolation");
  if (settingsSelect) {
    settingsSelect.value = nextVal ? "on" : "off";
  }
  updateVocalIsolationChipUI();
  try {
    const saved = await window.lyricsPlayer.saveSettings(state.settings);
    if (saved) {
      state.settings = saved;
      updateVocalIsolationChipUI();
    }
  } catch (err) {
    console.error("[App] Failed to persist vocalIsolation setting:", err);
  }
}

[mainVocalIsolationToggle, editVocalIsolationToggle].forEach((chip) => {
  if (chip) chip.addEventListener("click", handleVocalIsolationChipToggle);
});

function setControlsEnabled(enabled) {
  player.setEnabled(enabled);
  playlist.setEnabled(enabled);
  lyricsViewer.setEnabled(enabled);

  if (analyzeButton) analyzeButton.disabled = !enabled;
  if (mainAnalyzeButton) mainAnalyzeButton.disabled = !enabled;
  shellControls.setFloatingEnabled(enabled);
  syncBackButton.disabled = !enabled;
  syncFineBackButton.disabled = !enabled;
  syncFineForwardButton.disabled = !enabled;
  syncForwardButton.disabled = !enabled;
  resetSyncButton.disabled = !enabled;
  exportLrcButton.disabled = !enabled;
  exportVttButton.disabled = !enabled;
  embedManager.setEnabled(enabled);

  updateActionButtonsState();
}

// showProgress, hideProgress, align, analyze, cancel 관련 로직은 LyricsJobManager가 관리하고,
// 전역 단축키, MediaSession, 뷰/드로어 전환, 플로팅 버튼 및 윈도우 제어는 ShellControls가 관리합니다.

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

// -------------------------------------------------------------
// App Initialization
// -------------------------------------------------------------

(async () => {
  shellControls.initMediaSession();

  // 초기 테마 즉시 적용 (깜빡임 방지)
  document.documentElement.dataset.theme = localStorage.getItem("theme") || "lyra";

  // Restore shuffle & repeat state
  const savedShuffle = localStorage.getItem("shuffle") === "true";
  state.shuffle = savedShuffle;
  const shuffleButton = document.querySelector("#shuffleButton");
  if (shuffleButton) {
    shuffleButton.title = `셔플: ${state.shuffle ? "ON" : "OFF"}`;
    shuffleButton.classList.toggle("active", state.shuffle);
  }
  state.repeatMode = localStorage.getItem("repeat_mode") || "all";
  player.updateRepeatUI();

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
    await trackController.selectPlaylistItem(lastIndex, false);
  }
  
  // Restore floating visibility
  const savedFloating = localStorage.getItem("floating_visible") === "true";
  if (savedFloating) {
    state.floatingVisible = true;
    const visible = await window.lyricsPlayer.toggleFloating(true);
    state.floatingVisible = visible;
    shellControls.updateFloatingButtonUI(visible);
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
  }

  updateAlignButtonState();

  // 첫 실행 시 온보딩 모달 표시
  if (!loaded.firstRunCompleted) {
    setTimeout(() => {
      onboardingManager.show();
    }, 400);
  }
})();
