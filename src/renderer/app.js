// UI Elements for main orchestration
const trackTitle = document.querySelector("#trackTitle");
const trackArtist = document.querySelector("#trackArtist");
const trackAlbumMeta = document.querySelector("#trackAlbumMeta");
const trackStatusBadge = document.querySelector("#trackStatusBadge");
const trackStatus = document.querySelector("#trackStatus");
const albumArt = document.querySelector("#albumArt");
const albumArtPlaceholder = document.querySelector("#albumArtPlaceholder");

// Global Navigation Elements
const navNowPlayingBtn = document.querySelector("#navNowPlayingBtn");
const navLibraryBtn = document.querySelector("#navLibraryBtn");
const navEditLyricsBtn = document.querySelector("#navEditLyricsBtn");
const analyzeButton = document.querySelector("#analyzeButton");
const cancelButton = document.querySelector("#cancelButton");
const alignButton = document.querySelector("#alignButton");
const mainAnalyzeButton = document.querySelector("#mainAnalyzeButton");
const mainCancelButton = document.querySelector("#mainCancelButton");
const mainAlignButton = document.querySelector("#mainAlignButton");
const mainVocalIsolationToggle = document.querySelector("#mainVocalIsolationToggle");
const editVocalIsolationToggle = document.querySelector("#editVocalIsolationToggle");
const floatingButton = document.querySelector("#floatingButton");
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
const queueToggleButton = document.querySelector("#queueToggleButton");

// Views & Edit Toolbar Elements
const nowPlayingView = document.querySelector("#nowPlayingView");
const lyricsEditView = document.querySelector("#lyricsEditView");
const libraryView = document.querySelector("#libraryView");
const queueDrawer = document.querySelector("#queueDrawer");
const queueCloseBtn = document.querySelector("#queueCloseBtn");
const navQueueToggleBtn = document.querySelector("#navQueueToggleBtn");
const editTrackTitle = document.querySelector("#editTrackTitle");
const editTrackArt = document.querySelector("#editTrackArt");
const editTrackArtPlaceholder = document.querySelector("#editTrackArtPlaceholder");
const exitEditModeBtn = document.querySelector("#exitEditModeBtn");
const saveEditBtn = document.querySelector("#saveEditBtn");
const exportDropdownBtn = document.querySelector("#exportDropdownBtn");
const exportDropdownMenu = document.querySelector("#exportDropdownMenu");

const { formatClock, escapeHtml } = window.lyricsCore;

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
  vocalModelInstalled: false,
  settings: { theme: "lyra", model: "base", language: null, geminiApiKey: "", autoAnalyzeMode: "off", vocalIsolation: false },
  editMode: false,
  shuffle: false,
  repeatMode: "all",
  isAutoAnalyzing: false,
  embeddedLyricsLines: null,
  history: [],
  playlistFilter: "",
};

let saveTimer = null;

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
    trackStatusBadge.textContent = `내장 가사 감지됨 (${state.embeddedLyricsLines.length}줄)`;
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
  updateMediaSessionMetadata(track);
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
      embeddedPlainLyrics: state.embeddedLyricsLines,
      metadata: { source: "local" }
    });
  }, 250);
}

function persistLyricsImmediately() {
  if (!state.track || state.lyrics.length === 0) {
    return;
  }

  clearTimeout(saveTimer);
  return window.lyricsPlayer.saveCachedLyrics({
    track: state.track,
    lyrics: state.lyrics,
    syncOffset: state.syncOffset,
    embeddedPlainLyrics: state.embeddedLyricsLines,
    metadata: { source: "local" }
  });
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
    if (state.playlist.length === 0) return;
    if (state.repeatMode === "off" && !state.shuffle && state.currentIndex === state.playlist.length - 1) {
      return;
    }
    selectPlaylistItem(getNextIndex());
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
  onTrackMetadataUpdated: (updatedTrack) => {
    if (state.track === updatedTrack) {
      applyActiveTrackInfoUI(updatedTrack);
    }
  },
  onClearPlaylist: () => {
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
    persistLyricsSoon();
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
    updateDeleteCacheButtonState();
  },
  onLyricTextChange: () => {
    persistLyricsSoon();
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
    updateDeleteCacheButtonState();
  },
  onEditDone: () => {
    persistLyricsImmediately();
    lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
    updateDeleteCacheButtonState();
  },
  onGetCurrentTime: () => {
    return player.getCurrentTime();
  },
  onToggleEditView: (isEdit) => {
    switchView(isEdit ? "lyrics-edit" : "now-playing");
  }
});

function switchView(viewName) {
  if (nowPlayingView) nowPlayingView.classList.remove("active");
  if (lyricsEditView) lyricsEditView.classList.remove("active");
  if (libraryView) libraryView.classList.remove("active");

  if (viewName === "lyrics-edit") {
    if (lyricsEditView) lyricsEditView.classList.add("active");
    updateEditHeaderInfo(state.track);
    if (lyricsViewer) lyricsViewer.renderEditView();
  } else if (viewName === "library") {
    if (libraryView) libraryView.classList.add("active");
    if (navLibraryBtn) navLibraryBtn.classList.add("active");
    if (navNowPlayingBtn) navNowPlayingBtn.classList.remove("active");
    if (state.editMode) {
      state.editMode = false;
    }
    if (playlist) playlist.renderLibraryTable();
  } else {
    // "now-playing"
    if (nowPlayingView) nowPlayingView.classList.add("active");
    if (navNowPlayingBtn) navNowPlayingBtn.classList.add("active");
    if (navLibraryBtn) navLibraryBtn.classList.remove("active");
    if (lyricsViewer) lyricsViewer.render();
  }
}

const settingsView = new SettingsView(state, {
  onSave: (savedSettings) => {
    const engineText = savedSettings.sttEngine === "gemini" ? `Gemini API (${savedSettings.geminiModel || "gemini-3.1-flash-lite"})` : `Local Whisper (${savedSettings.model})`;
    trackStatus.textContent = `Settings saved. Engine: ${engineText}, Language: ${savedSettings.language || "auto"}.`;
    updateAlignButtonState();
    updateVocalIsolationChipUI();

    if (state.settings.autoAnalyzeMode !== "off" && state.track && state.lyrics.length === 0 && !state.isTranscribing) {
      state.isAutoAnalyzing = true;
      lyricsJobManager.handleAnalyzeClick();
    }
  },
  onVocalModelStatusChange: (status) => {
    state.vocalModelInstalled = Boolean(status?.installed);
    updateVocalIsolationChipUI();
  }
});

const lyricsJobManager = new LyricsJobManager(state, player, lyricsViewer, settingsView, {
  persistLyricsSoon,
  updateAlignButtonState,
  updateAnalyzeButtonState,
  updateVocalIsolationChipUI,
  updateTrackStatusBadge
});

const embedManager = new EmbedManager(state, trackStatus, updateAlignButtonState);

const onboardingManager = new OnboardingManager(state);

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

  const meta = window.lyricsCore.resolveTrackMeta(track);

  navigator.mediaSession.metadata = new MediaMetadata({
    title: meta.title,
    artist: meta.artist === "-" ? "Local Track" : meta.artist,
    album: meta.album || "ALP",
    artwork: artwork
  });
}

async function selectPlaylistItem(index, autoPlay = true, isFromHistory = false) {
  if (index < 0 || index >= state.playlist.length) return;
  state.activeLineId = null;

  if (state.isTranscribing) {
    lyricsJobManager.handleCancelClick().catch(() => {});
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
  applyActiveTrackInfoUI(track);
  updateTrackStatusBadge();

  if (!track.metadataLoaded && track.path && window.lyricsPlayer?.getTrackMetadata) {
    window.lyricsPlayer.getTrackMetadata(track).then((meta) => {
      if (!meta) return;
      Object.assign(track, meta);
      playlist.saveCache();
      if (state.track === track) {
        applyActiveTrackInfoUI(track);
      }
      playlist.render();
    }).catch(() => {});
  }

  // 앨범 아트 설정 (비동기 지연 로드 지원)
  if (track.albumArt) {
    albumArt.src = track.albumArt;
    albumArt.style.display = "block";
    albumArtPlaceholder.style.display = "none";
    if (playerBarArt) {
      playerBarArt.src = track.albumArt;
      playerBarArt.style.display = "block";
    }
    if (playerBarPlaceholder) playerBarPlaceholder.style.display = "none";
  } else {
    albumArt.src = "";
    albumArt.style.display = "none";
    albumArtPlaceholder.style.display = "flex";
    if (playerBarArt) {
      playerBarArt.src = "";
      playerBarArt.style.display = "none";
    }
    if (playerBarPlaceholder) playerBarPlaceholder.style.display = "flex";

    // 앨범 아트 비동기 Lazy Extraction
    if (track.path) {
      window.lyricsPlayer.getTrackAlbumArt(track).then((art) => {
        if (art && state.track === track) {
          track.albumArt = art;
          albumArt.src = art;
          albumArt.style.display = "block";
          albumArtPlaceholder.style.display = "none";
          if (playerBarArt) {
            playerBarArt.src = art;
            playerBarArt.style.display = "block";
          }
          if (playerBarPlaceholder) playerBarPlaceholder.style.display = "none";
          updateEditHeaderInfo(track);
          playlist.render();
        }
      }).catch(() => {});
    }
  }

  // 다음 트랙 사전 적재 (백그라운드 프리페치)
  if (Array.isArray(state.tracks) && state.tracks.length > 1) {
    const currentIndex = state.tracks.indexOf(track);
    if (currentIndex !== -1 && currentIndex + 1 < state.tracks.length) {
      const nextTrack = state.tracks[currentIndex + 1];
      if (nextTrack && window.lyricsPlayer?.prefetchTrack) {
        window.lyricsPlayer.prefetchTrack(nextTrack).catch(() => {});
      }
    }
  }

  setControlsEnabled(true);

  // 캐시 가사 정보 로드 전 UI 및 상태 즉시 초기화
  state.lyrics = [];
  state.embeddedLyricsLines = null;
  lyricsViewer.setOffset(0);
  lyricsViewer.render();

  // 캐시 가사 정보 로드
  trackStatus.textContent = "Loading cached lyrics…";
  const cached = await window.lyricsPlayer.loadCachedLyrics(track);

  // 내장 가사 존재 여부에 따른 Embed 버튼 하이라이트 지정
  const hasEmbedded = typeof cached?.hasEmbeddedLyrics === "boolean"
    ? cached.hasEmbeddedLyrics
    : (cached?.metadata?.source === "embedded_lrc" || cached?.metadata?.source === "embedded_plain");
  embedManager.updateHighlight(hasEmbedded);
  
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

    const shouldAutoAnalyze =
      !state.isTranscribing && (
        state.settings.autoAnalyzeMode === "analyze" ||
        (state.settings.autoAnalyzeMode === "align" && (state.settings.geminiApiKey || "").trim().length > 0)
      );

    if (shouldAutoAnalyze) {
      state.isAutoAnalyzing = true;
      setTimeout(() => {
        lyricsJobManager.handleAnalyzeClick();
      }, 100);
    }
  } else if (cached?.lyrics) {
    state.lyrics = cached.lyrics;
    lyricsViewer.setOffset(cached.syncOffset || 0);
    trackStatus.textContent = state.embeddedLyricsLines
      ? `Loaded cached lyrics. (내장 평문 가사 보존됨)`
      : `Loaded cached lyrics.`;
  } else {
    state.lyrics = [];
    lyricsViewer.setOffset(0);
    trackStatus.textContent = "No cached lyrics. Press Analyze to generate.";

    if (state.settings.autoAnalyzeMode !== "off" && !state.isTranscribing) {
      state.isAutoAnalyzing = true;
      setTimeout(() => {
        lyricsJobManager.handleAnalyzeClick();
      }, 100);
    }
  }

  lyricsViewer.render();
  lyricsViewer.updateActive(player.getCurrentTime(), player.isPlaying());
  updateTrackStatusBadge();
  playlist.render();
  updateActionButtonsState();
  updateDeleteCacheButtonState();

  const activeItem = playlistList.querySelector(".playlist-item.active");
  if (activeItem) {
    activeItem.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

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
        state.syncOffset = 0;
        lyricsViewer.setOffset(0);
        lyricsViewer.render();
        trackStatus.textContent = "Cache deleted. Press Analyze to generate lyrics.";
        updateActionButtonsState();
        updateDeleteCacheButtonState();
      } else {
        alert(`캐시 삭제 실패: ${res?.error || "unknown error"}`);
      }
    }
  });
}

function updateAnalyzeButtonState() {
  const hasLyrics = state.lyrics && state.lyrics.length > 0;
  if (analyzeButton) {
    analyzeButton.classList.toggle("reanalyze-state", hasLyrics);
    analyzeButton.textContent = hasLyrics ? "AI 재분석 (Reanalyze)" : "AI 가사 분석 (Analyze)";
  }
  if (mainAnalyzeButton) {
    mainAnalyzeButton.classList.toggle("reanalyze-state", hasLyrics);
    mainAnalyzeButton.textContent = hasLyrics ? "AI 재분석" : "AI 가사 분석";
    mainAnalyzeButton.title = hasLyrics
      ? "현재 곡의 가사를 다시 AI로 분석합니다"
      : "AI 음성 인식으로 가사를 생성합니다";
  }
}

function updateAlignButtonState() {
  const hasApiKey = !!(state.settings?.geminiApiKey || "").trim();
  const hasLyrics = state.lyrics && state.lyrics.length > 0;
  const isAligned = hasLyrics && state.lyrics[0]?.id?.startsWith("align_");

  const targets = [
    { btn: alignButton, baseLabel: "AI Align", realignLabel: "AI Realign" },
    { btn: mainAlignButton, baseLabel: "AI 정합", realignLabel: "AI 재정합" },
  ];

  for (const { btn, baseLabel, realignLabel } of targets) {
    if (!btn) continue;
    btn.classList.toggle("realign-state", isAligned);

    if (state.isTranscribing) {
      btn.disabled = true;
    } else if (!hasApiKey || !hasLyrics) {
      btn.disabled = true;
      btn.title = !hasApiKey
        ? "Gemini API Key is required. Please set it in settings."
        : "No lyrics to align. Please analyze the track first.";
      btn.textContent = baseLabel;
    } else {
      btn.disabled = false;
      btn.title = isAligned
        ? "Re-run AI Alignment using Gemini"
        : "AI Align Lyrics using Gemini";
      btn.textContent = isAligned ? realignLabel : baseLabel;
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
  floatingButton.disabled = !enabled;
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

// showProgress, hideProgress, align, analyze, cancel 관련 로직은 LyricsJobManager가 관리하므로 제거합니다.

function updateFloatingButtonUI(visible) {
  if (!floatingButton) return;
  floatingButton.classList.toggle("active", visible);
  floatingButton.title = visible ? "외부 플로팅 가사창 닫기" : "외부 투명 플로팅 가사창 열기";
  const labelSpan = floatingButton.querySelector("span");
  if (labelSpan) {
    labelSpan.textContent = visible ? "가사 창 닫기" : "가사 창";
  }
}

floatingButton.addEventListener("click", async () => {
  state.floatingVisible = !state.floatingVisible;
  const visible = await window.lyricsPlayer.toggleFloating(state.floatingVisible);
  state.floatingVisible = visible;
  updateFloatingButtonUI(visible);
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
  updateFloatingButtonUI(false);
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
    await selectPlaylistItem(lastIndex, false);
  }
  
  // Restore floating visibility
  const savedFloating = localStorage.getItem("floating_visible") === "true";
  if (savedFloating) {
    state.floatingVisible = true;
    const visible = await window.lyricsPlayer.toggleFloating(true);
    state.floatingVisible = visible;
    updateFloatingButtonUI(visible);
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

// --- Shortcuts & Global UI Controls ---
(() => {
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

  // 재생 대기열 토글 및 닫기 버튼 핸들러 (상단 nav + 하단 바 + 닫기 버튼 동기화)
  function setQueueDrawerOpen(open) {
    if (!queueDrawer) return;
    queueDrawer.classList.toggle("open", open);
    if (queueToggleButton) queueToggleButton.classList.toggle("active", open);
    if (navQueueToggleBtn) navQueueToggleBtn.classList.toggle("active", open);
  }

  if (queueToggleButton && queueDrawer) {
    queueToggleButton.addEventListener("click", () => {
      setQueueDrawerOpen(!queueDrawer.classList.contains("open"));
    });
  }

  if (navQueueToggleBtn && queueDrawer) {
    navQueueToggleBtn.addEventListener("click", () => {
      setQueueDrawerOpen(!queueDrawer.classList.contains("open"));
    });
  }

  if (queueCloseBtn && queueDrawer) {
    queueCloseBtn.addEventListener("click", () => {
      setQueueDrawerOpen(false);
    });
  }

  // 하단 바 볼륨 아이콘 클릭 시 음소거 토글
  const volumeIcon = document.querySelector("#volumeIcon");
  if (volumeIcon) {
    volumeIcon.style.cursor = "pointer";
    volumeIcon.addEventListener("click", () => {
      if (player.audio.volume > 0) {
        state.savedVolume = player.audio.volume;
        player.setVolume(0);
      } else {
        player.setVolume(state.savedVolume || 0.85);
      }
    });
  }
  // 상단 내비게이션 바 탭 이벤트
  if (navNowPlayingBtn && navLibraryBtn) {
    navNowPlayingBtn.addEventListener("click", () => {
      if (state.editMode) {
        lyricsViewer.toggleEditMode(false);
      } else {
        switchView("now-playing");
      }
    });

    navLibraryBtn.addEventListener("click", () => {
      switchView("library");
    });
  }

  if (navEditLyricsBtn) {
    navEditLyricsBtn.addEventListener("click", () => {
      lyricsViewer.toggleEditMode(true);
    });
  }

  // 가사 전용 편집 화면 툴바 이벤트
  if (exitEditModeBtn) {
    exitEditModeBtn.addEventListener("click", () => {
      lyricsViewer.toggleEditMode(false);
    });
  }

  if (saveEditBtn) {
    saveEditBtn.addEventListener("click", () => {
      persistLyricsImmediately();
      lyricsViewer.toggleEditMode(false);
    });
  }

  if (exportDropdownBtn && exportDropdownMenu) {
    exportDropdownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportDropdownMenu.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dropdown-wrap")) {
        exportDropdownMenu.classList.remove("show");
      }
    });

    exportDropdownMenu.addEventListener("click", () => {
      exportDropdownMenu.classList.remove("show");
    });
  }

  // 커스텀 윈도우 제어 버튼 (최소화 / 최대화 / 닫기)
  const winMinimizeBtn = document.querySelector("#winMinimizeBtn");
  const winMaximizeBtn = document.querySelector("#winMaximizeBtn");
  const winCloseBtn = document.querySelector("#winCloseBtn");

  const ICON_MAXIMIZE = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>`;
  const ICON_RESTORE = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="1.8" y="3.5" width="6.5" height="6.5" rx="0.8"/><path d="M3.8 3.5V2.4a.8.8 0 0 1 .8-.8h5a.8.8 0 0 1 .8.8v5a.8.8 0 0 1-.8.8H8.3"/></svg>`;

  function updateMaximizeButtonUI(isMaximized) {
    if (!winMaximizeBtn) return;
    winMaximizeBtn.innerHTML = isMaximized ? ICON_RESTORE : ICON_MAXIMIZE;
    winMaximizeBtn.title = isMaximized ? "이전 크기로 복원" : "최대화";
    winMaximizeBtn.setAttribute("aria-label", winMaximizeBtn.title);
  }

  if (winMinimizeBtn && window.lyricsPlayer?.minimizeWindow) {
    winMinimizeBtn.addEventListener("click", () => window.lyricsPlayer.minimizeWindow());
  }

  if (winMaximizeBtn && window.lyricsPlayer?.toggleMaximizeWindow) {
    winMaximizeBtn.addEventListener("click", async () => {
      const res = await window.lyricsPlayer.toggleMaximizeWindow();
      if (typeof res?.isMaximized === "boolean") {
        updateMaximizeButtonUI(res.isMaximized);
      }
    });
  }

  if (winCloseBtn && window.lyricsPlayer?.closeWindow) {
    winCloseBtn.addEventListener("click", () => window.lyricsPlayer.closeWindow());
  }

  if (window.lyricsPlayer?.onWindowMaximizedChanged) {
    window.lyricsPlayer.onWindowMaximizedChanged((isMaximized) => {
      updateMaximizeButtonUI(isMaximized);
    });
  }
})();
