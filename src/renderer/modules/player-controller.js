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
      this.playButton.textContent = "❚❚";
      this.callbacks.onStateChange("Playing");
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
      }
      this.updatePlaybackPosition();
    });

    this.audio.addEventListener("pause", () => {
      this.playButton.textContent = "▶";
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
      this.playButton.textContent = "▶";
      this.callbacks.onStateChange("Ended");
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "none";
      }
      this.callbacks.onEnded();
    });

    this.audio.volume = Number(this.volumeBar.value);
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
    this.shuffleButton.textContent = `Shuffle: ${this.state.shuffle ? "ON" : "OFF"}`;
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
