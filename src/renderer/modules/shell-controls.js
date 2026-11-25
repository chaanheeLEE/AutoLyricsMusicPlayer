(function attachShellControls(root) {
  const DEFAULT_SHORTCUTS = Object.freeze({
    togglePlay: "Space",
    seekBackward: "ArrowLeft",
    seekForward: "ArrowRight",
    volumeUp: "ArrowUp",
    volumeDown: "ArrowDown",
    prevTrack: "KeyP",
    nextTrack: "KeyN",
    toggleMute: "KeyM",
    toggleFloating: "KeyF",
  });

  const ICON_MAXIMIZE = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>`;
  const ICON_RESTORE = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="1.8" y="3.5" width="6.5" height="6.5" rx="0.8"/><path d="M3.8 3.5V2.4a.8.8 0 0 1 .8-.8h5a.8.8 0 0 1 .8.8v5a.8.8 0 0 1-.8.8H8.3"/></svg>`;

  function shouldIgnoreShortcutTarget(activeEl) {
    if (!activeEl) return false;
    const tag = activeEl.tagName;
    if (
      (tag === "INPUT" && (activeEl.type === "text" || activeEl.type === "password" || activeEl.type === "number")) ||
      tag === "TEXTAREA" ||
      activeEl.isContentEditable
    ) {
      return true;
    }
    return false;
  }

  function resolveShortcutAction(code, shortcuts = DEFAULT_SHORTCUTS) {
    if (!code) return null;
    const map = shortcuts || DEFAULT_SHORTCUTS;
    for (const [action, keyCode] of Object.entries(map)) {
      if (keyCode === code) {
        return action;
      }
    }
    return null;
  }

  function computeMutedVolumeToggle(currentVolume, savedVolume) {
    const vol = Number(currentVolume) || 0;
    if (vol > 0) {
      return { nextVolume: 0, savedVolume: vol };
    }
    const restored = savedVolume || 0.85;
    return { nextVolume: restored, savedVolume: restored };
  }

  /**
   * 전역 단축키, MediaSession, 뷰/드로어 전환, 플로팅 창 버튼, 커스텀 윈도우 제어 등
   * 앱 셸(Shell) 레벨의 UI 컨트롤을 담당합니다.
   */
  class ShellControls {
    constructor({
      state,
      player,
      lyricsViewer,
      playlist,
      callbacks = {},
      doc = null,
      win = null,
      api = null,
      storage = null
    } = {}) {
      this.state = state;
      this.player = player;
      this.lyricsViewer = lyricsViewer;
      this.playlist = playlist;
      this.callbacks = callbacks;

      this.doc = doc || (typeof document !== "undefined" ? document : null);
      this.win = win || (typeof window !== "undefined" ? window : null);
      this.api = api || this.win?.lyricsPlayer || null;
      this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);

      this._initialized = false;

      this.navNowPlayingBtn = this._q("#navNowPlayingBtn");
      this.navLibraryBtn = this._q("#navLibraryBtn");
      this.navEditLyricsBtn = this._q("#navEditLyricsBtn");
      this.floatingButton = this._q("#floatingButton");
      this.nowPlayingView = this._q("#nowPlayingView");
      this.lyricsEditView = this._q("#lyricsEditView");
      this.libraryView = this._q("#libraryView");
      this.queueDrawer = this._q("#queueDrawer");
      this.queueCloseBtn = this._q("#queueCloseBtn");
      this.queueToggleButton = this._q("#queueToggleButton");
      this.editTrackTitle = this._q("#editTrackTitle");
      this.exitEditModeBtn = this._q("#exitEditModeBtn");
      this.saveEditBtn = this._q("#saveEditBtn");
      this.exportDropdownBtn = this._q("#exportDropdownBtn");
      this.exportDropdownMenu = this._q("#exportDropdownMenu");
      this.volumeIcon = this._q("#volumeIcon");
      this.winMinimizeBtn = this._q("#winMinimizeBtn");
      this.winMaximizeBtn = this._q("#winMaximizeBtn");
      this.winCloseBtn = this._q("#winCloseBtn");
    }

    _q(selector) {
      return this.doc?.querySelector ? this.doc.querySelector(selector) : null;
    }

    init() {
      if (this._initialized || !this.doc) return;
      this._initialized = true;

      if (this.floatingButton) {
        this.floatingButton.addEventListener("click", () => {
          this.toggleFloating();
        });
      }

      if (this.api?.onFloatingClosed) {
        this.api.onFloatingClosed(() => {
          this.state.floatingVisible = false;
          this.updateFloatingButtonUI(false);
          this.storage?.setItem?.("floating_visible", "false");
        });
      }

      if (this.api?.onPlaybackCommand) {
        this.api.onPlaybackCommand((command) => {
          this.handlePlaybackCommand(command);
        });
      }

      this.doc.addEventListener("keydown", (e) => {
        this._handleKeyDown(e);
      });

      if (this.queueToggleButton && this.queueDrawer) {
        this.queueToggleButton.addEventListener("click", () => {
          this.setQueueDrawerOpen(!this.queueDrawer.classList.contains("open"));
        });
      }

      if (this.queueCloseBtn && this.queueDrawer) {
        this.queueCloseBtn.addEventListener("click", () => {
          this.setQueueDrawerOpen(false);
        });
      }

      if (this.volumeIcon) {
        this.volumeIcon.style.cursor = "pointer";
        this.volumeIcon.addEventListener("click", () => {
          this.toggleMute();
        });
      }

      if (this.navNowPlayingBtn && this.navLibraryBtn) {
        this.navNowPlayingBtn.addEventListener("click", () => {
          if (this.state.editMode) {
            this.lyricsViewer?.toggleEditMode?.(false);
          } else {
            this.switchView("now-playing");
          }
        });

        this.navLibraryBtn.addEventListener("click", () => {
          this.switchView("library");
        });
      }

      if (this.navEditLyricsBtn) {
        this.navEditLyricsBtn.addEventListener("click", () => {
          this.lyricsViewer?.toggleEditMode?.(true);
        });
      }

      if (this.exitEditModeBtn) {
        this.exitEditModeBtn.addEventListener("click", () => {
          this.lyricsViewer?.toggleEditMode?.(false);
        });
      }

      if (this.saveEditBtn) {
        this.saveEditBtn.addEventListener("click", () => {
          this.callbacks.onSaveEdit?.();
          this.lyricsViewer?.toggleEditMode?.(false);
        });
      }

      if (this.exportDropdownBtn && this.exportDropdownMenu) {
        this.exportDropdownBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.exportDropdownMenu.classList.toggle("show");
        });

        this.doc.addEventListener("click", (e) => {
          if (!e.target?.closest?.(".dropdown-wrap")) {
            this.exportDropdownMenu.classList.remove("show");
          }
        });

        this.exportDropdownMenu.addEventListener("click", () => {
          this.exportDropdownMenu.classList.remove("show");
        });
      }

      if (this.winMinimizeBtn && this.api?.minimizeWindow) {
        this.winMinimizeBtn.addEventListener("click", () => this.api.minimizeWindow());
      }

      if (this.winMaximizeBtn && this.api?.toggleMaximizeWindow) {
        this.winMaximizeBtn.addEventListener("click", async () => {
          const res = await this.api.toggleMaximizeWindow();
          if (typeof res?.isMaximized === "boolean") {
            this.updateMaximizeButtonUI(res.isMaximized);
          }
        });
      }

      if (this.winCloseBtn && this.api?.closeWindow) {
        this.winCloseBtn.addEventListener("click", () => this.api.closeWindow());
      }

      if (this.api?.onWindowMaximizedChanged) {
        this.api.onWindowMaximizedChanged((isMaximized) => {
          this.updateMaximizeButtonUI(isMaximized);
        });
      }
    }

    initMediaSession() {
      const nav = this.win?.navigator || (typeof navigator !== "undefined" ? navigator : null);
      if (!nav || !("mediaSession" in nav)) return;

      nav.mediaSession.setActionHandler("play", () => {
        if (this.state.playlist.length === 0) return;
        this.player?.play?.();
      });

      nav.mediaSession.setActionHandler("pause", () => {
        this.player?.pause?.();
      });

      nav.mediaSession.setActionHandler("previoustrack", () => {
        this.player?.prev?.();
      });

      nav.mediaSession.setActionHandler("nexttrack", () => {
        this.player?.next?.();
      });

      nav.mediaSession.setActionHandler("seekto", (details) => {
        const dur = this.player?.getDuration?.();
        if (Number.isFinite(dur)) {
          this.player.setCurrentTime(details.seekTime);
          this.player.updatePlaybackPosition?.();
        }
      });
    }

    updateMediaSessionMetadata(track) {
      const nav = this.win?.navigator || (typeof navigator !== "undefined" ? navigator : null);
      const MediaMetaCtor = this.win?.MediaMetadata || (typeof MediaMetadata !== "undefined" ? MediaMetadata : null);
      if (!track || !nav || !("mediaSession" in nav) || !MediaMetaCtor) return;

      const artwork = [];
      if (track.albumArt) {
        const isPng = track.albumArt.startsWith("data:image/png");
        artwork.push({
          src: track.albumArt,
          sizes: "512x512",
          type: isPng ? "image/png" : "image/jpeg"
        });
      }

      const lyricsCoreRef = this.win?.lyricsCore || root?.lyricsCore || null;
      const meta = lyricsCoreRef?.resolveTrackMeta
        ? lyricsCoreRef.resolveTrackMeta(track)
        : { title: track.title || "No track selected", artist: track.artist || "-", album: track.album || "" };

      nav.mediaSession.metadata = new MediaMetaCtor({
        title: meta.title,
        artist: meta.artist === "-" ? "Local Track" : meta.artist,
        album: meta.album || "ALP",
        artwork
      });
    }

    switchView(viewName) {
      if (this.nowPlayingView) this.nowPlayingView.classList.remove("active");
      if (this.lyricsEditView) this.lyricsEditView.classList.remove("active");
      if (this.libraryView) this.libraryView.classList.remove("active");

      if (viewName === "lyrics-edit") {
        if (this.lyricsEditView) this.lyricsEditView.classList.add("active");
        this.callbacks.onEnterEditView?.();
        this.lyricsViewer?.renderEditView?.();
      } else if (viewName === "library") {
        if (this.libraryView) this.libraryView.classList.add("active");
        if (this.navLibraryBtn) this.navLibraryBtn.classList.add("active");
        if (this.navNowPlayingBtn) this.navNowPlayingBtn.classList.remove("active");
        if (this.state.editMode) {
          this.state.editMode = false;
        }
        this.playlist?.renderLibraryTable?.();
      } else {
        if (this.nowPlayingView) this.nowPlayingView.classList.add("active");
        if (this.navNowPlayingBtn) this.navNowPlayingBtn.classList.add("active");
        if (this.navLibraryBtn) this.navLibraryBtn.classList.remove("active");
        this.lyricsViewer?.render?.();
      }
    }

    setQueueDrawerOpen(open) {
      if (!this.queueDrawer) return;
      this.queueDrawer.classList.toggle("open", open);
      if (this.queueToggleButton) {
        this.queueToggleButton.classList.toggle("active", open);
        this.queueToggleButton.setAttribute("aria-pressed", String(open));
      }
    }

    updateFloatingButtonUI(visible) {
      if (!this.floatingButton) return;
      this.floatingButton.classList.toggle("active", visible);
      this.floatingButton.title = visible ? "외부 플로팅 가사창 닫기" : "외부 투명 플로팅 가사창 열기";
      this.floatingButton.setAttribute("aria-label", this.floatingButton.title);
      this.floatingButton.setAttribute("aria-pressed", String(visible));
    }

    setFloatingEnabled(enabled) {
      if (this.floatingButton) {
        this.floatingButton.disabled = !enabled;
      }
    }

    async toggleFloating() {
      if (!this.api?.toggleFloating) return;
      this.state.floatingVisible = !this.state.floatingVisible;
      const visible = await this.api.toggleFloating(this.state.floatingVisible);
      this.state.floatingVisible = Boolean(visible);
      this.updateFloatingButtonUI(this.state.floatingVisible);
      this.lyricsViewer?.updateActive?.(this.player?.getCurrentTime?.(), this.player?.isPlaying?.());
      this.storage?.setItem?.("floating_visible", String(this.state.floatingVisible));
    }

    toggleMute() {
      const currentVol = this.player?.audio?.volume ?? 0;
      const { nextVolume, savedVolume } = computeMutedVolumeToggle(currentVol, this.state.savedVolume);
      this.state.savedVolume = savedVolume;
      this.player?.setVolume?.(nextVolume);
    }

    handlePlaybackCommand(command) {
      if (command === "toggle-play") {
        this.player?.togglePlay?.();
      } else if (command === "prev-track") {
        this.player?.prev?.();
      } else if (command === "next-track") {
        this.player?.next?.();
      } else if (command === "close-floating" && this.state.floatingVisible) {
        this.toggleFloating();
      }
    }

    updateMaximizeButtonUI(isMaximized) {
      if (!this.winMaximizeBtn) return;
      this.winMaximizeBtn.innerHTML = isMaximized ? ICON_RESTORE : ICON_MAXIMIZE;
      this.winMaximizeBtn.title = isMaximized ? "이전 크기로 복원" : "최대화";
      this.winMaximizeBtn.setAttribute("aria-label", this.winMaximizeBtn.title);
    }

    _handleKeyDown(e) {
      if (shouldIgnoreShortcutTarget(this.doc?.activeElement)) {
        return;
      }

      const action = resolveShortcutAction(e.code, this.state.settings?.shortcuts || DEFAULT_SHORTCUTS);
      if (!action) return;

      switch (action) {
        case "togglePlay":
          e.preventDefault(); // 스페이스바 브라우저 스크롤 방지
          this.player?.togglePlay?.();
          break;
        case "seekBackward": {
          e.preventDefault();
          const curTimeLeft = this.player?.getCurrentTime?.();
          if (Number.isFinite(curTimeLeft)) {
            this.player.setCurrentTime(Math.max(0, curTimeLeft - 5));
          }
          break;
        }
        case "seekForward": {
          e.preventDefault();
          const curTimeRight = this.player?.getCurrentTime?.();
          const duration = this.player?.getDuration?.();
          if (Number.isFinite(curTimeRight) && Number.isFinite(duration)) {
            this.player.setCurrentTime(Math.min(duration, curTimeRight + 5));
          }
          break;
        }
        case "volumeUp": {
          e.preventDefault();
          const curVolUp = this.player?.audio?.volume ?? 0;
          this.player?.setVolume?.(Math.min(1.0, Number((curVolUp + 0.05).toFixed(2))));
          break;
        }
        case "volumeDown": {
          e.preventDefault();
          const curVolDown = this.player?.audio?.volume ?? 0;
          this.player?.setVolume?.(Math.max(0.0, Number((curVolDown - 0.05).toFixed(2))));
          break;
        }
        case "nextTrack":
          this.player?.next?.();
          break;
        case "prevTrack":
          this.player?.prev?.();
          break;
        case "toggleMute":
          this.toggleMute();
          break;
        case "toggleFloating":
          if (!this.floatingButton?.disabled) {
            this.toggleFloating();
          }
          break;
      }
    }
  }

  const exportsObj = {
    ShellControls,
    DEFAULT_SHORTCUTS,
    shouldIgnoreShortcutTarget,
    resolveShortcutAction,
    computeMutedVolumeToggle
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }

  if (root) {
    root.ShellControls = ShellControls;
    root.shellControlsHelpers = {
      DEFAULT_SHORTCUTS,
      shouldIgnoreShortcutTarget,
      resolveShortcutAction,
      computeMutedVolumeToggle
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
