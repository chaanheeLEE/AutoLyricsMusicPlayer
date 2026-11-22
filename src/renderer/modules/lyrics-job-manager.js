class LyricsJobManager {
  constructor(state, player, lyricsViewer, settingsView, callbacks) {
    this.state = state;
    this.player = player;
    this.lyricsViewer = lyricsViewer;
    this.settingsView = settingsView;
    this.callbacks = callbacks; // { persistLyricsSoon, updateAlignButtonState }

    this.analyzeButton = document.querySelector("#analyzeButton");
    this.cancelButton = document.querySelector("#cancelButton");
    this.alignButton = document.querySelector("#alignButton");
    this.mainAnalyzeButton = document.querySelector("#mainAnalyzeButton");
    this.mainCancelButton = document.querySelector("#mainCancelButton");
    this.mainAlignButton = document.querySelector("#mainAlignButton");
    this.trackStatus = document.querySelector("#trackStatus");

    this.transcriptionProgress = document.querySelector("#transcriptionProgress");
    this.progressLabel = document.querySelector("#progressLabel");
    this.progressBar = document.querySelector("#progressBar");
    this.mainTranscriptionProgress = document.querySelector("#mainTranscriptionProgress");
    this.mainProgressLabel = document.querySelector("#mainProgressLabel");
    this.mainProgressBar = document.querySelector("#mainProgressBar");

    this._initEvents();
  }

  _initEvents() {
    [this.analyzeButton, this.mainAnalyzeButton].forEach((btn) => {
      if (btn) btn.addEventListener("click", () => this.handleAnalyzeClick());
    });
    [this.cancelButton, this.mainCancelButton].forEach((btn) => {
      if (btn) btn.addEventListener("click", () => this.handleCancelClick());
    });
    [this.alignButton, this.mainAlignButton].forEach((btn) => {
      if (btn) btn.addEventListener("click", () => this.handleAlignClick());
    });

    // 백엔드 진행 상태 리스너 연동
    window.lyricsPlayer.onTranscriptionProgress((msg) => {
      const STAGE_LABELS = {
        loading_model: "Loading model…",
        converting: "Converting audio…",
        transcribing: "Transcribing…",
        gemini_uploading: "Uploading audio to Gemini…",
        gemini_transcribing: "Analyzing audio with Gemini…",
        saving: "Saving…",
        cancelled: "Cancelled.",
      };

      if (msg.type === "progress") {
        const label = STAGE_LABELS[msg.stage] || "Working…";
        const percent = msg.percent !== undefined ? msg.percent : 0;
        this.showProgress(label, percent);
      }
    });
  }

  _setTranscribingUI(isTranscribing, isAligning = false) {
    const analyzeButtons = [this.analyzeButton, this.mainAnalyzeButton];
    const cancelButtons = [this.cancelButton, this.mainCancelButton];
    const alignButtons = [this.alignButton, this.mainAlignButton];

    if (isTranscribing) {
      if (isAligning) {
        analyzeButtons.forEach((btn) => {
          if (btn) btn.disabled = true;
        });
      } else {
        analyzeButtons.forEach((btn) => {
          if (btn) btn.style.display = "none";
        });
        cancelButtons.forEach((btn) => {
          if (btn) {
            btn.style.display = "";
            btn.disabled = false;
          }
        });
      }
      alignButtons.forEach((btn) => {
        if (btn) btn.disabled = true;
      });
    } else {
      cancelButtons.forEach((btn) => {
        if (btn) {
          btn.style.display = "none";
          btn.disabled = true;
        }
      });
      analyzeButtons.forEach((btn) => {
        if (btn) {
          btn.style.display = "";
          btn.disabled = !this.state.track;
        }
      });
      if (this.callbacks.updateAnalyzeButtonState) this.callbacks.updateAnalyzeButtonState();
      if (this.callbacks.updateAlignButtonState) this.callbacks.updateAlignButtonState();
    }

    if (this.callbacks.updateTrackStatusBadge) this.callbacks.updateTrackStatusBadge();
  }

  showProgress(label, percent) {
    const widthPct = `${Math.min(Math.max(percent * 100, 0), 100)}%`;
    const panels = [
      [this.transcriptionProgress, this.progressLabel, this.progressBar],
      [this.mainTranscriptionProgress, this.mainProgressLabel, this.mainProgressBar],
    ];
    for (const [wrap, labelEl, barEl] of panels) {
      if (wrap) wrap.style.display = "block";
      if (labelEl) labelEl.textContent = label;
      if (barEl) barEl.style.width = widthPct;
    }
  }

  hideProgress() {
    const panels = [
      [this.transcriptionProgress, this.progressBar],
      [this.mainTranscriptionProgress, this.mainProgressBar],
    ];
    for (const [wrap, barEl] of panels) {
      if (wrap) wrap.style.display = "none";
      if (barEl) barEl.style.width = "0%";
    }
  }

  async handleAnalyzeClick() {
    if (!this.state.track) {
      this.state.isAutoAnalyzing = false;
      return;
    }

    // Gemini API Engine 사용 시 API Key 필수 검증
    if (this.state.settings.sttEngine === "gemini" && (!this.state.settings.geminiApiKey || !this.state.settings.geminiApiKey.trim())) {
      alert("Gemini API Engine을 사용하려면 설정에서 Gemini API Key를 입력해야 합니다.");
      this.state.isAutoAnalyzing = false;
      this.settingsView.open();
      return;
    }

    this.state.isTranscribing = true;
    this._setTranscribingUI(true, false);

    const originalTrackKey = this.state.track.cacheKey;

    // Whisper 설정 및 힌트 프롬프트 구성
    const options = { ...(this.state.settings || {}) };
    
    if (options.sttEngine === "gemini") {
      this.showProgress("Uploading audio to Gemini…", 0.1);
      this.trackStatus.textContent = "Uploading & Analyzing…";
    } else {
      this.showProgress("Converting audio…", 0);
      this.trackStatus.textContent = "Analyzing…";
    }
    if (this.state.embeddedLyricsLines && this.state.embeddedLyricsLines.length > 0) {
      const openingHint = this.state.embeddedLyricsLines
        .map((line) => (typeof line === "string" ? line.trim() : ""))
        .filter((line) => line && !/^[\[\(].*[\]\)]$/.test(line))
        .slice(0, 4)
        .join(" ")
        .slice(0, 120)
        .trim();
      options.initialPrompt = openingHint || null;
    } else {
      options.initialPrompt = null;
    }
    if (options.beamSize === undefined) {
      options.beamSize = 5;
    }

    // 음악의 실제 총 길이를 백엔드에 제공하기 위해 duration 속성 주입
    const trackPayload = {
      ...(this.state.track || {}),
      duration: this.player.getDuration()
    };

    const result = await window.lyricsPlayer.startTranscription(trackPayload, options);

    if (!this.state.track || this.state.track.cacheKey !== originalTrackKey) {
      this.state.isAutoAnalyzing = false;
      this.state.isTranscribing = false;
      this._setTranscribingUI(false);
      this.hideProgress();
      return;
    }

    this.state.isTranscribing = false;
    this.hideProgress();

    if (result?.ok && result.lyrics?.length > 0) {
      this.state.lyrics = result.lyrics;
      this.lyricsViewer.setOffset(0);
      this.trackStatus.textContent = `Transcription complete. ${result.lyrics.length} lines found.`;
      this._setTranscribingUI(false);
      this.lyricsViewer.render();
      this.lyricsViewer.updateActive(this.player.getCurrentTime(), this.player.isPlaying());
      this.callbacks.persistLyricsSoon();

      if (this.state.isAutoAnalyzing && this.state.settings.autoAnalyzeMode === "align" && (this.state.settings.geminiApiKey || "").trim().length > 0) {
        setTimeout(() => {
          this.alignButton.click();
        }, 500);
      }
    } else if (result?.ok && result.lyrics?.length === 0) {
      this.trackStatus.textContent = "No speech detected. Check settings or audio file.";
      this._setTranscribingUI(false);
    } else {
      this.trackStatus.textContent = `Analysis failed: ${result?.error || "unknown error"}`;
      this._setTranscribingUI(false);
    }

    this.state.isAutoAnalyzing = false;
  }

  async handleCancelClick() {
    [this.cancelButton, this.mainCancelButton].forEach((btn) => {
      if (btn) btn.disabled = true;
    });
    await window.lyricsPlayer.cancelTranscription();
    this.state.isTranscribing = false;
    this._setTranscribingUI(false);
    this.hideProgress();
    this.trackStatus.textContent = "Analysis cancelled.";
  }

  async handleAlignClick() {
    if (!this.state.track || this.state.lyrics.length === 0) {
      this.trackStatus.textContent = "No lyrics to align. Run Analyze first.";
      return;
    }

    const apiKey = this.state.settings.geminiApiKey || "";
    if (!apiKey.trim()) {
      this.trackStatus.textContent = "Gemini API Key is required for AI Alignment. Please configure it in settings.";
      this.settingsView.open();
      return;
    }

    this.state.isTranscribing = true;
    this._setTranscribingUI(true, true);
    this.showProgress("Searching & alignment in progress…", 0.5);
    this.trackStatus.textContent = "AI Alignment in progress…";

    try {
      const result = await window.lyricsPlayer.alignLyrics({
        track: this.state.track,
        whisperLyrics: this.state.lyrics,
        settings: this.state.settings,
        embeddedLyricsLines: this.state.embeddedLyricsLines || null
      });

      if (result?.ok && result.lyrics?.length > 0) {
        this.state.lyrics = result.lyrics;
        this.lyricsViewer.setOffset(0);
        
        if (result.warning === "fallback_to_whisper") {
          console.error("[Aligner] Fallback to whisper active. AI Align Error detail:\n", result.errorDetail);
          this.trackStatus.textContent = `AI Alignment Failed: ${result.errorDetail.split('\n')[0]}`;
        } else {
          this.trackStatus.textContent = `AI Alignment complete. ${result.lyrics.length} official lines mapped.`;
        }

        this.lyricsViewer.render();
        this.lyricsViewer.updateActive(this.player.getCurrentTime(), this.player.isPlaying());
        this.callbacks.persistLyricsSoon();
        this.callbacks.updateAlignButtonState();
      } else {
        this.trackStatus.textContent = `AI Alignment failed: ${result?.error || "unknown error"}`;
      }
    } catch (error) {
      this.trackStatus.textContent = `AI Alignment failed: ${error.message}`;
    } finally {
      this.state.isTranscribing = false;
      this._setTranscribingUI(false);
      this.hideProgress();
    }
  }
}

window.LyricsJobManager = LyricsJobManager;
