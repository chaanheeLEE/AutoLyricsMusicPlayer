const ICON_PLAY = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5.5v13l11-6.5-11-6.5z"/></svg>`;
const ICON_PAUSE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>`;
const ICON_VOLUME_ON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
const ICON_VOLUME_MUTE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

class PlayerController {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks; // { onTimeUpdate, onStateChange, onEnded, onPrev, onNext }
    this.audio = document.querySelector("#audio");
    this.playButton = document.querySelector("#playButton");
    this.prevButton = document.querySelector("#prevButton");
    this.nextButton = document.querySelector("#nextButton");
    this.seekBar = document.querySelector("#seekBar");
    this.volumeBar = document.querySelector("#volumeBar");
    this.volumeIcon = document.querySelector("#volumeIcon");
    this.currentTimeLabel = document.querySelector("#currentTime");
    this.durationLabel = document.querySelector("#duration");
    this.shuffleButton = document.querySelector("#shuffleButton");

    this._initEvents();
  }

  _initEvents() {
    this.playButton.addEventListener("click", () => this.togglePlay());
    this.prevButton.addEventListener("click", () => this.prev());
    this.nextButton.addEventListener("click", () => this.next());
    this.shuffleButton.addEventListener("click", () => this.toggleShuffle());

    this.volumeBar.addEventListener("input", () => {
      this.audio.volume = Number(this.volumeBar.value);
      this.updateVolumeIcon();
    });

    this.seekBar.addEventListener("input", () => {
      if (Number.isFinite(this.audio.duration)) {
        this.audio.currentTime = (Number(this.seekBar.value) / 1000) * this.audio.duration;
      }
    });

    this.audio.addEventListener("loadedmetadata", () => {
      this.durationLabel.textContent = window.lyricsCore.formatClock(this.audio.duration);
      this.seekBar.value = "0";
      this.updatePlaybackPosition();
    });

    this.audio.addEventListener("play", () => {
      this.playButton.innerHTML = ICON_PAUSE;
      this.callbacks.onStateChange("Playing");
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
      }
      this.updatePlaybackPosition();
    });

    this.audio.addEventListener("pause", () => {
      this.playButton.innerHTML = ICON_PLAY;
      this.callbacks.onStateChange("Paused");
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }
      this.updatePlaybackPosition();
    });

    this.audio.addEventListener("seeking", () => {
      this.updatePlaybackPosition();
    });

    this.audio.addEventListener("timeupdate", () => {
      this.currentTimeLabel.textContent = window.lyricsCore.formatClock(this.audio.currentTime);
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.seekBar.value = String(Math.round((this.audio.currentTime / this.audio.duration) * 1000));
      }
      this.callbacks.onTimeUpdate(this.audio.currentTime);
    });

    this.audio.addEventListener("ended", () => {
      this.playButton.innerHTML = ICON_PLAY;
      this.callbacks.onStateChange("Ended");
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "none";
      }
      this.callbacks.onEnded();
    });

    this.audio.volume = Number(this.volumeBar.value);
    this.updateVolumeIcon();
  }

  updateVolumeIcon() {
    if (!this.volumeIcon) return;
    const isMuted = this.audio.volume <= 0;
    this.volumeIcon.innerHTML = isMuted ? ICON_VOLUME_MUTE : ICON_VOLUME_ON;
    this.volumeIcon.title = isMuted ? "음소거 해제" : "음소거";
  }

  loadTrack(track, autoPlay = true) {
    this.audio.src = track.url;
    if (autoPlay) {
      this.audio.play().catch(() => {});
    }
  }

  play() {
    this.audio.play().catch(() => {});
  }

  pause() {
    this.audio.pause();
  }

  togglePlay() {
    if (this.state.playlist.length === 0) return;
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  toggleShuffle() {
    this.state.shuffle = !this.state.shuffle;
    this.shuffleButton.title = `셔플: ${this.state.shuffle ? "ON" : "OFF"}`;
    this.shuffleButton.classList.toggle("active", this.state.shuffle);
    localStorage.setItem("shuffle", String(this.state.shuffle));
  }

  prev() {
    this.callbacks.onPrev();
  }

  next() {
    this.callbacks.onNext();
  }

  getCurrentTime() {
    return this.audio.currentTime;
  }

  setCurrentTime(time) {
    this.audio.currentTime = time;
  }

  getDuration() {
    return this.audio.duration;
  }

  isPlaying() {
    return !this.audio.paused;
  }

  updatePlaybackPosition() {
    if (!("mediaSession" in navigator)) return;
    if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
      navigator.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate || 1.0,
        position: this.audio.currentTime
      });
    }
  }

  setVolume(vol) {
    this.audio.volume = vol;
    this.volumeBar.value = String(vol);
    this.updateVolumeIcon();
  }

  setEnabled(enabled) {
    this.playButton.disabled = !enabled;
    this.prevButton.disabled = !enabled;
    this.nextButton.disabled = !enabled;
    this.seekBar.disabled = !enabled;
    this.shuffleButton.disabled = !enabled;
  }
}

window.PlayerController = PlayerController;
