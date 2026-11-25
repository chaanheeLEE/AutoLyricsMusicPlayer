(function attachTrackController(root) {
  const defaultLyricsCore =
    (root && root.lyricsCore) ||
    (typeof require === "function" ? require("../../shared/lyrics-core") : null);

  function buildLyricsSaveSnapshot(state, explicitPayload = null) {
    const track = explicitPayload?.track || state?.track;
    const rawLyrics = explicitPayload?.lyrics !== undefined ? explicitPayload.lyrics : state?.lyrics;
    if (!track?.cacheKey || !Array.isArray(rawLyrics) || rawLyrics.length === 0) {
      return null;
    }

    const embeddedPlainLyrics = explicitPayload?.embeddedPlainLyrics !== undefined
      ? explicitPayload.embeddedPlainLyrics
      : state?.embeddedLyricsLines;
    const plainLyricsSource = explicitPayload?.plainLyricsSource !== undefined
      ? explicitPayload.plainLyricsSource
      : state?.plainLyricsSource;

    return {
      track: { ...track },
      lyrics: rawLyrics.map((line) => ({ ...line })),
      syncOffset: explicitPayload?.syncOffset !== undefined ? explicitPayload.syncOffset : state?.syncOffset,
      embeddedPlainLyrics: Array.isArray(embeddedPlainLyrics) ? [...embeddedPlainLyrics] : null,
      plainLyricsSource: embeddedPlainLyrics ? (plainLyricsSource || null) : null,
      metadata: explicitPayload?.metadata || { source: "local" }
    };
  }

  function computeNextTrackIndex(state, syncShuffleQueueFn) {
    const playlist = state?.playlist || [];
    if (playlist.length <= 1) {
      return { nextIndex: 0, shuffleQueue: state?.shuffleQueue || [] };
    }

    if (Array.isArray(state.forwardHistory) && state.forwardHistory.length > 0) {
      for (let i = state.forwardHistory.length - 1; i >= 0; i--) {
        const candidateIdx = state.forwardHistory[i];
        if (candidateIdx >= 0 && candidateIdx < playlist.length && candidateIdx !== state.currentIndex) {
          return { nextIndex: candidateIdx, shuffleQueue: state.shuffleQueue || [] };
        }
      }
    }

    if (state.shuffle && typeof syncShuffleQueueFn === "function") {
      const nextQueue = syncShuffleQueueFn(playlist, state.track, state.shuffleQueue);
      const nextTrack = nextQueue[0];
      const nextIdx = nextTrack ? playlist.indexOf(nextTrack) : -1;
      if (nextIdx !== -1) {
        return { nextIndex: nextIdx, shuffleQueue: nextQueue };
      }
      let seqFallback = state.currentIndex + 1;
      if (seqFallback >= playlist.length) seqFallback = 0;
      return { nextIndex: seqFallback, shuffleQueue: nextQueue };
    }

    let nextIdx = state.currentIndex + 1;
    if (nextIdx >= playlist.length) nextIdx = 0;
    return { nextIndex: nextIdx, shuffleQueue: state.shuffleQueue || [] };
  }

  function applyNavigationHistory(state, targetIndex, navMode = "manual") {
    const mode = navMode === true ? "prev" : (navMode || "manual");
    if (mode === "manual") {
      if (state.currentIndex >= 0 && state.currentIndex !== targetIndex) {
        state.history.push(state.currentIndex);
        if (state.history.length > 50) {
          state.history.shift();
        }
      }
      state.forwardHistory = [];
    } else if (mode === "next") {
      if (state.currentIndex >= 0 && state.currentIndex !== targetIndex) {
        state.history.push(state.currentIndex);
        if (state.history.length > 50) {
          state.history.shift();
        }
      }
      if (
        Array.isArray(state.forwardHistory) &&
        state.forwardHistory.length > 0 &&
        state.forwardHistory[state.forwardHistory.length - 1] === targetIndex
      ) {
        state.forwardHistory.pop();
      } else {
        state.forwardHistory = [];
      }
    }
  }

  function computePrevTrackNavigation(state) {
    if (Array.isArray(state.history) && state.history.length > 0) {
      if (state.currentIndex >= 0) {
        state.forwardHistory.push(state.currentIndex);
        if (state.forwardHistory.length > 50) {
          state.forwardHistory.shift();
        }
      }
      return state.history.pop();
    }

    let idx = state.currentIndex - 1;
    if (idx < 0) idx = state.playlist.length - 1;
    return idx;
  }

  /**
   * 트랙 전환(selectionSeq 가드), 재생 히스토리/셔플, 백그라운드 프리페치,
   * 자동 분석 디바운스, 트랙별 가사 캐시 스냅샷 저장을 전담합니다.
   */
  class TrackController {
    constructor({
      state,
      player = null,
      playlist = null,
      lyricsViewer = null,
      lyricsJobManager = null,
      embedManager = null,
      callbacks = {},
      api = null,
      lyricsCore = null,
      timers = null
    } = {}) {
      this.state = state;
      this.player = player;
      this.playlist = playlist;
      this.lyricsViewer = lyricsViewer;
      this.lyricsJobManager = lyricsJobManager;
      this.embedManager = embedManager;
      this.callbacks = callbacks;

      this.api = api || (root && root.lyricsPlayer) || null;
      this.lyricsCore = lyricsCore || defaultLyricsCore;
      this.timers = timers || {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id)
      };

      this.saveTimers = new Map();
      this.trackSelectionSeq = 0;
      this.autoAnalyzeTimer = null;
      this.prefetchTimer = null;

      this.AUTO_ANALYZE_DEBOUNCE_MS = 200;
      this.PREFETCH_DELAY_MS = 180;
      this.SAVE_DEBOUNCE_MS = 250;
    }

    buildLyricsSaveSnapshot(explicitPayload = null) {
      return buildLyricsSaveSnapshot(this.state, explicitPayload);
    }

    persistLyricsSoon(explicitPayload = null) {
      const snapshot = this.buildLyricsSaveSnapshot(explicitPayload);
      if (!snapshot) {
        return;
      }

      const cacheKey = snapshot.track.cacheKey;
      const existing = this.saveTimers.get(cacheKey);
      if (existing) {
        this.timers.clearTimeout(existing.timerId);
      }

      const timerId = this.timers.setTimeout(() => {
        this.saveTimers.delete(cacheKey);
        this.api?.saveCachedLyrics?.(snapshot);
      }, this.SAVE_DEBOUNCE_MS);

      this.saveTimers.set(cacheKey, { timerId, snapshot });
    }

    persistLyricsImmediately(explicitPayload = null) {
      const snapshot = this.buildLyricsSaveSnapshot(explicitPayload);
      if (!snapshot) {
        return;
      }

      const cacheKey = snapshot.track.cacheKey;
      const existing = this.saveTimers.get(cacheKey);
      if (existing) {
        this.timers.clearTimeout(existing.timerId);
        this.saveTimers.delete(cacheKey);
      }

      return this.api?.saveCachedLyrics?.(snapshot);
    }

    flushPendingLyricsSaves() {
      for (const [cacheKey, entry] of this.saveTimers.entries()) {
        this.timers.clearTimeout(entry.timerId);
        this.saveTimers.delete(cacheKey);
        Promise.resolve(this.api?.saveCachedLyrics?.(entry.snapshot)).catch(() => {});
      }
    }

    clearScheduledTimers() {
      if (this.autoAnalyzeTimer) {
        this.timers.clearTimeout(this.autoAnalyzeTimer);
        this.autoAnalyzeTimer = null;
      }
      if (this.prefetchTimer) {
        this.timers.clearTimeout(this.prefetchTimer);
        this.prefetchTimer = null;
      }
    }

    getNextIndex() {
      const { nextIndex, shuffleQueue } = computeNextTrackIndex(
        this.state,
        this.lyricsCore?.syncShuffleQueue
      );
      this.state.shuffleQueue = shuffleQueue;
      return nextIndex;
    }

    prefetchNextTrack() {
      if (this.prefetchTimer) {
        this.timers.clearTimeout(this.prefetchTimer);
        this.prefetchTimer = null;
      }
      if (!Array.isArray(this.state.playlist) || this.state.playlist.length <= 1 || !this.api?.prefetchTrack) {
        return;
      }
      const nextIndex = this.getNextIndex();
      const nextTrack = nextIndex !== this.state.currentIndex ? this.state.playlist[nextIndex] : null;
      if (!nextTrack) return;

      this.prefetchTimer = this.timers.setTimeout(() => {
        this.prefetchTimer = null;
        Promise.resolve(this.api.prefetchTrack(nextTrack)).catch(() => {});
      }, this.PREFETCH_DELAY_MS);
    }

    scheduleAutoAnalyze(selectionSeq, track, cancelPromise = null) {
      if (this.autoAnalyzeTimer) {
        this.timers.clearTimeout(this.autoAnalyzeTimer);
        this.autoAnalyzeTimer = null;
      }
      this.autoAnalyzeTimer = this.timers.setTimeout(async () => {
        this.autoAnalyzeTimer = null;
        if (cancelPromise) {
          await cancelPromise.catch(() => {});
        }
        if (
          selectionSeq !== this.trackSelectionSeq ||
          this.state.track !== track ||
          this.state.isTranscribing
        ) {
          return;
        }
        this.lyricsJobManager?.handleAnalyzeClick?.({
          isAuto: true,
          expectedTrackKey: track.cacheKey
        });
      }, this.AUTO_ANALYZE_DEBOUNCE_MS);
    }

    handleEnded() {
      if (this.state.playlist.length === 0) return;
      if (
        this.state.repeatMode === "off" &&
        !this.state.shuffle &&
        this.state.currentIndex === this.state.playlist.length - 1
      ) {
        return;
      }
      this.selectPlaylistItem(this.getNextIndex(), true, "next");
    }

    handlePrev() {
      if (this.state.playlist.length === 0) return;
      const prevIndex = computePrevTrackNavigation(this.state);
      this.selectPlaylistItem(prevIndex, Boolean(this.player?.isPlaying?.()), "prev");
    }

    handleNext() {
      if (this.state.playlist.length === 0) return;
      this.selectPlaylistItem(this.getNextIndex(), Boolean(this.player?.isPlaying?.()), "next");
    }

    handleShuffleChange() {
      this.state.shuffleQueue = [];
      this.state.forwardHistory = [];
      this.prefetchNextTrack();
    }

    async selectPlaylistItem(index, autoPlay = true, navMode = "manual") {
      if (index < 0 || index >= this.state.playlist.length) return;
      const selectionSeq = ++this.trackSelectionSeq;
      this.state.activeLineId = null;
      this.state.alignSuggestedTrackKey = null;

      this.clearScheduledTimers();

      // 새 곡 전환 시 이전 가사 상태를 즉시 초기화하여 버튼 라벨('AI 재분석' 오표시)과 렌더 경합 차단
      this.state.lyrics = [];
      this.state.lyricsSource = null;
      this.state.embeddedLyricsLines = null;
      this.state.plainLyricsSource = null;

      this.flushPendingLyricsSaves();
      const cancelPromise = this.lyricsJobManager?.cancelActiveJob
        ? Promise.resolve(this.lyricsJobManager.cancelActiveJob({ silent: true })).catch(() => {})
        : Promise.resolve();

      applyNavigationHistory(this.state, index, navMode);

      this.state.currentIndex = index;
      this.playlist?.saveCache?.();

      const track = this.state.playlist[index];
      this.state.track = track;
      this.state.shuffleQueue = Array.isArray(this.state.shuffleQueue)
        ? this.state.shuffleQueue.filter((t) => t !== track)
        : [];

      // 오디오 소스 설정
      this.player?.loadTrack?.(track, autoPlay);
      this.callbacks.applyActiveTrackInfoUI?.(track);
      this.callbacks.updateTrackStatusBadge?.();

      if (!track.metadataLoaded && track.path && this.api?.getTrackMetadata) {
        this.api.getTrackMetadata(track).then((meta) => {
          if (!meta) return;
          Object.assign(track, meta);
          this.playlist?.saveCache?.();
          if (this.state.track === track) {
            this.callbacks.applyActiveTrackInfoUI?.(track);
          }
          this.playlist?.render?.();
        }).catch(() => {});
      }

      // 앨범 아트 설정 (비동기 지연 로드 지원)
      this.callbacks.setTrackAlbumArtUI?.(track);
      if (!track.albumArt && track.path && this.api?.getTrackAlbumArt) {
        this.api.getTrackAlbumArt(track).then((art) => {
          if (art && this.state.track === track) {
            track.albumArt = art;
            this.callbacks.onAlbumArtLoaded?.(track, art);
          }
        }).catch(() => {});
      }

      this.callbacks.setControlsEnabled?.(true);

      this.lyricsViewer?.setOffset?.(0);
      this.lyricsViewer?.render?.();

      // 캐시 가사 정보 즉시 로드 (이전 작업 취소 완료를 기다리지 않고 바로 렌더링)
      this.callbacks.setTrackStatusText?.("Loading cached lyrics…");
      const cached = await this.api?.loadCachedLyrics?.(track);

      if (selectionSeq !== this.trackSelectionSeq || this.state.track !== track) {
        return;
      }

      const lyricsCore = this.lyricsCore;
      const sourceConstants = lyricsCore?.LYRICS_SOURCE || {
        EMBEDDED_LRC: "embedded_lrc",
        EMBEDDED_PLAIN: "embedded_plain",
        TXT_PLAIN: "txt_plain",
        LRCLIB_CACHED: "lrclib_cached"
      };

      const isEmbeddedFn = lyricsCore?.isEmbeddedAudioSource
        || ((src) => src === "embedded_lrc" || src === "embedded_plain");
      const isPlainOnlyFn = lyricsCore?.isPlainOnlyLyricsSource
        || ((src) => src === "embedded_plain" || src === "txt_plain");
      const resolveLabelFn = lyricsCore?.resolvePlainLyricsSourceLabel
        || ((src) => (src === "txt_plain" ? "로컬 텍스트(.txt) 가사" : "내장 가사"));

      // 내장 가사 존재 여부에 따른 Embed 버튼 하이라이트 지정
      const hasEmbedded = typeof cached?.hasEmbeddedLyrics === "boolean"
        ? cached.hasEmbeddedLyrics
        : isEmbeddedFn(cached?.metadata?.source);
      this.embedManager?.updateHighlight?.(hasEmbedded);

      // 캐시 상태에 무관하게, 음원 자체 또는 로컬 .txt·웹 공식 평문 가사가 존재하면 항상 보관
      const isPlainOnlySource = isPlainOnlyFn(cached?.metadata?.source);
      if (cached?.embeddedPlainLyrics) {
        this.state.embeddedLyricsLines = cached.embeddedPlainLyrics;
      } else if (cached?.lyrics && isPlainOnlySource) {
        this.state.embeddedLyricsLines = cached.lyrics.map((l) => l.text);
      }
      this.state.plainLyricsSource = cached?.plainLyricsSource
        || (isPlainOnlySource
          ? cached.metadata.source
          : (this.state.embeddedLyricsLines
            ? (hasEmbedded ? sourceConstants.EMBEDDED_PLAIN : sourceConstants.LRCLIB_CACHED)
            : null));

      if (cached?.lyrics && isPlainOnlySource) {
        this.state.lyrics = [];
        this.state.lyricsSource = cached.metadata.source;
        this.lyricsViewer?.setOffset?.(0);
        const plainOriginLabel = resolveLabelFn(this.state.plainLyricsSource);
        this.callbacks.setTrackStatusText?.(
          `${plainOriginLabel} ${this.state.embeddedLyricsLines.length}줄 감지됨. 'AI 가사 분석' 실행 후 'AI 정합'으로 싱크 적용 가능.`
        );

        const shouldAutoAnalyze =
          !this.state.isTranscribing && (
            this.state.settings.autoAnalyzeMode === "analyze" ||
            (this.state.settings.autoAnalyzeMode === "align" && (this.state.settings.geminiApiKey || "").trim().length > 0)
          );

        if (shouldAutoAnalyze) {
          this.scheduleAutoAnalyze(selectionSeq, track, cancelPromise);
        }
      } else if (cached?.lyrics) {
        this.state.lyrics = cached.lyrics;
        this.state.lyricsSource = cached.metadata?.source || "local";
        this.lyricsViewer?.setOffset?.(cached.syncOffset || 0);
        const preservedLabel = resolveLabelFn(this.state.plainLyricsSource);
        this.callbacks.setTrackStatusText?.(
          this.state.embeddedLyricsLines
            ? `Loaded cached lyrics. (${preservedLabel} 보존됨)`
            : `Loaded cached lyrics.`
        );
      } else {
        this.state.lyrics = [];
        this.state.lyricsSource = null;
        this.lyricsViewer?.setOffset?.(0);
        this.callbacks.setTrackStatusText?.("No cached lyrics. Press Analyze to generate.");

        if (this.state.settings.autoAnalyzeMode !== "off" && !this.state.isTranscribing) {
          this.scheduleAutoAnalyze(selectionSeq, track, cancelPromise);
        }
      }

      this.lyricsViewer?.render?.();
      this.lyricsViewer?.updateActive?.(this.player?.getCurrentTime?.(), this.player?.isPlaying?.());
      this.callbacks.updateTrackStatusBadge?.();
      this.playlist?.render?.();
      this.callbacks.updateActionButtonsState?.();
      this.callbacks.updateDeleteCacheButtonState?.();

      // 현재 곡 가사 렌더링이 완료된 후 다음 트랙 백그라운드 프리페치 예약
      this.prefetchNextTrack();

      this.callbacks.scrollToActivePlaylistItem?.();
    }
  }

  const exportsObj = {
    TrackController,
    buildLyricsSaveSnapshot,
    computeNextTrackIndex,
    applyNavigationHistory,
    computePrevTrackNavigation
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }

  if (root) {
    root.TrackController = TrackController;
    root.trackControllerHelpers = {
      buildLyricsSaveSnapshot,
      computeNextTrackIndex,
      applyNavigationHistory,
      computePrevTrackNavigation
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
