class LyricsJobManager {
  constructor(state, player, lyricsViewer, settingsView, callbacks) {
    this.state = state;
    this.player = player;
    this.lyricsViewer = lyricsViewer;
    this.settingsView = settingsView;
    this.callbacks = callbacks; // { persistLyricsSoon, persistLyricsImmediately, updateAlignButtonState, ... }

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

    this.jobSeq = 0;
    this.activeJobId = null;
    this.activeTrackKey = null;
    this.activeStage = null;

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
      if (!this.activeJobId) return;
      if (msg.jobId !== undefined && msg.jobId !== null && msg.jobId !== this.activeJobId) {
        return;
      }

      const STAGE_LABELS = {
        loading_model: "모델 불러오는 중…",
        converting: "오디오 변환 중…",
        isolating_vocals: "보컬 분리 중…",
        transcribing: "AI 가사 분석 중…",
        gemini_uploading: "Gemini에 음원 업로드 중…",
        gemini_transcribing: "Gemini 가사 분석 중…",
        align_scraping: "공식 가사 검색 중…",
        align_gemini: "AI 정밀 가사 정합 중…",
        align_gemini_fallback: "AI 서버 혼잡 · 예비 모델로 정합 재시도 중…",
        saving: "저장 중…",
        cancelled: "취소됨",
      };

      if (msg.type === "progress") {
        const baseLabel = STAGE_LABELS[msg.stage] || "작업 진행 중…";
        const deviceLabel = this._normalizeDeviceLabel(msg.deviceLabel);
        const label = deviceLabel ? `${baseLabel} [${deviceLabel}]` : baseLabel;
        const percent = msg.percent !== undefined ? msg.percent : 0;
        this.showProgress(label, percent);
      } else if (msg.type === "segment") {
        this.showProgress(`가사 수신 중… (${msg.id})`, 0.9);
      } else if (msg.type === "error") {
        this.hideProgress();
        if (!this.activeTrackKey || this.state.track?.cacheKey === this.activeTrackKey) {
          this.trackStatus.textContent = `오류: ${msg.message}`;
        }
      }
    });
  }

  _normalizeDeviceLabel(rawLabel) {
    if (!rawLabel || typeof rawLabel !== "string") return "";
    if (/gpu|cuda|dml|directml/i.test(rawLabel)) return "GPU";
    if (/cpu/i.test(rawLabel)) return "CPU";
    return "";
  }

  _resolveTrackDuration(track) {
    const playerDur = this.player.getDuration();
    if (Number.isFinite(playerDur) && playerDur > 0) return playerDur;
    const metaDur = Number(track?.duration);
    return Number.isFinite(metaDur) && metaDur > 0 ? metaDur : null;
  }

  _isCurrentJob(jobId, trackKey) {
    return this.activeJobId === jobId && Boolean(this.state.track && this.state.track.cacheKey === trackKey);
  }

  _finishJobIfCurrent(jobId) {
    if (this.activeJobId !== jobId) return;
    this.activeJobId = null;
    this.activeTrackKey = null;
    this.activeStage = null;
    this.state.isTranscribing = false;
    this.state.isAutoAnalyzing = false;
    this.hideProgress();
    this._setTranscribingUI(false);
  }

  async _saveBackgroundResult(targetTrack, lyrics, embeddedPlainLyrics, source) {
    if (!targetTrack?.cacheKey || !Array.isArray(lyrics) || lyrics.length === 0) {
      return;
    }
    const payload = {
      track: targetTrack,
      lyrics,
      syncOffset: 0,
      embeddedPlainLyrics: embeddedPlainLyrics || null,
      metadata: { source }
    };
    try {
      if (this.callbacks.persistLyricsImmediately) {
        await this.callbacks.persistLyricsImmediately(payload);
      } else {
        await window.lyricsPlayer.saveCachedLyrics(payload);
      }
      console.log(`[JobManager] Background job completed for switched track (${targetTrack.title}); saved safely to original track cache.`);
    } catch (err) {
      console.warn("[JobManager] Failed to persist background job result:", err);
    }
  }

  _formatAlignFallbackMessage(result) {
    const code = result?.errorCode;
    if (code === "scrape_timeout") {
      return "AI 정합 실패 (공식 가사 검색 시간 초과) · 'AI 정합'으로 다시 시도할 수 있습니다";
    }
    if (code === "scrape_not_found" || code === "empty_official_lyrics") {
      return "AI 정합 실패 (일치하는 공식 가사 미발견) · 'AI 정합'으로 다시 시도할 수 있습니다";
    }
    if (code === "gemini_timeout") {
      return "AI 정합 실패 (Gemini 응답 시간 초과) · 'AI 정합'으로 다시 시도할 수 있습니다";
    }
    if (code === "gemini_overloaded") {
      return "AI 정합 실패 (서버 혼잡 · 503) · 잠시 후 'AI 정합'으로 다시 시도하세요";
    }
    if (code === "gemini_rate_limited") {
      return "AI 정합 실패 (요청 한도 초과 · 429) · 잠시 후 'AI 정합'으로 다시 시도하세요";
    }
    if (code === "gemini_api_error") {
      return "AI 정합 실패 (Gemini API 오류) · 'AI 정합'으로 다시 시도할 수 있습니다";
    }
    if (code === "no_valid_matches") {
      return "AI 정합 실패 (가사 싱크 매칭 불가) · 'AI 정합'으로 다시 시도할 수 있습니다";
    }
    const detail = result?.errorMessage || result?.errorDetail?.split("\n")[0] || "unknown error";
    return `AI Alignment Failed: ${detail}`;
  }

  _setTranscribingUI(isTranscribing, isAligning = false) {
    const analyzeButtons = [this.analyzeButton, this.mainAnalyzeButton];
    const cancelButtons = [this.cancelButton, this.mainCancelButton];
    const alignButtons = [this.alignButton, this.mainAlignButton];

    if (isTranscribing) {
      analyzeButtons.forEach((btn) => {
        if (btn) btn.style.display = "none";
      });
      cancelButtons.forEach((btn) => {
        if (btn) {
          btn.style.display = "";
          btn.disabled = false;
        }
      });
      alignButtons.forEach((btn) => {
        if (btn) {
          btn.disabled = true;
          btn.classList.remove("align-suggested");
        }
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

    if (this.callbacks.updateVocalIsolationChipUI) this.callbacks.updateVocalIsolationChipUI();
    if (this.callbacks.updateTrackStatusBadge) this.callbacks.updateTrackStatusBadge();
  }

  showProgress(label, percent) {
    const clamped = Math.min(Math.max(percent || 0, 0), 1);
    const widthPct = `${clamped * 100}%`;
    const pctNum = Math.round(clamped * 100);
    const displayText = pctNum > 0 && pctNum < 100 ? `${label} (${pctNum}%)` : label;

    const panels = [
      [this.transcriptionProgress, this.progressLabel, this.progressBar],
      [this.mainTranscriptionProgress, this.mainProgressLabel, this.mainProgressBar],
    ];
    for (const [wrap, labelEl, barEl] of panels) {
      if (wrap) wrap.style.display = "block";
      if (labelEl) labelEl.textContent = displayText;
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

  async cancelActiveJob({ silent = false } = {}) {
    const hadActive = Boolean(this.activeJobId || this.state.isTranscribing || this.state.isAutoAnalyzing);

    // 곡 전환·사용자 취소 시 즉시 현재 작업 토큰과 UI 상태를 무효화해 경합 차단
    this.activeJobId = null;
    this.activeTrackKey = null;
    this.activeStage = null;
    this.state.isTranscribing = false;
    this.state.isAutoAnalyzing = false;

    this._setTranscribingUI(false);
    this.hideProgress();
    if (!silent) {
      this.trackStatus.textContent = "Analysis cancelled.";
    }

    if (hadActive) {
      try {
        await window.lyricsPlayer.cancelTranscription();
      } catch (err) {
        console.warn("[JobManager] cancelTranscription failed:", err);
      }
    }
  }

  async handleAnalyzeClick({ isAuto = false, expectedTrackKey = null } = {}) {
    if (!this.state.track) {
      this.state.isAutoAnalyzing = false;
      return;
    }
    if (expectedTrackKey && this.state.track.cacheKey !== expectedTrackKey) {
      return;
    }
    if (this.state.isTranscribing) {
      return;
    }

    // Gemini API Engine 사용 시 API Key 필수 검증
    if (this.state.settings.sttEngine === "gemini" && (!this.state.settings.geminiApiKey || !this.state.settings.geminiApiKey.trim())) {
      this.state.isAutoAnalyzing = false;
      if (isAuto) {
        this.trackStatus.textContent = "자동 분석 건너뜀: Gemini API Key가 설정되지 않았습니다.";
      } else {
        alert("Gemini API Engine을 사용하려면 설정에서 Gemini API Key를 입력해야 합니다.");
        this.settingsView.open();
      }
      return;
    }

    // 작업 시작 시점의 대상 트랙/가사/설정을 스냅샷으로 고정해 곡 전환 오염 차단
    const targetTrack = {
      ...this.state.track,
      duration: this._resolveTrackDuration(this.state.track)
    };
    const originalTrackKey = targetTrack.cacheKey;
    const targetEmbeddedLyrics = Array.isArray(this.state.embeddedLyricsLines)
      ? [...this.state.embeddedLyricsLines]
      : null;
    const targetSettings = { ...(this.state.settings || {}) };

    const jobId = ++this.jobSeq;
    this.activeJobId = jobId;
    this.activeTrackKey = originalTrackKey;
    this.activeStage = "transcribing";
    this.state.isTranscribing = true;
    this.state.isAutoAnalyzing = Boolean(isAuto);
    this.state.alignSuggestedTrackKey = null;
    this._setTranscribingUI(true, false);

    const options = { ...targetSettings, jobId };

    if (options.sttEngine === "gemini") {
      this.showProgress("Gemini에 음원 업로드 중…", 0.1);
      this.trackStatus.textContent = "Uploading & Analyzing…";
    } else {
      this.showProgress("오디오 변환 중…", 0);
      this.trackStatus.textContent = "Analyzing…";
    }

    if (targetEmbeddedLyrics && targetEmbeddedLyrics.length > 0) {
      const openingHint = targetEmbeddedLyrics
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

    const sttSource = options.sttEngine === "gemini" ? "gemini" : "whisper";
    const result = await window.lyricsPlayer.startTranscription(targetTrack, options);

    // 작업 중 다른 곡으로 전환되었거나 취소된 경우: 현재 화면 상태를 건드리지 않고 원곡 캐시만 안전 저장
    if (!this._isCurrentJob(jobId, originalTrackKey)) {
      if (!result?.cancelled && result?.ok && result.lyrics?.length > 0) {
        await this._saveBackgroundResult(targetTrack, result.lyrics, targetEmbeddedLyrics, sttSource);
      }
      return;
    }

    if (result?.cancelled) {
      this._finishJobIfCurrent(jobId);
      return;
    }

    if (result?.ok && result.lyrics?.length > 0) {
      this.state.lyrics = result.lyrics;
      this.state.lyricsSource = sttSource;
      this.lyricsViewer.setOffset(0);
      this.lyricsViewer.render();
      this.lyricsViewer.updateActive(this.player.getCurrentTime(), this.player.isPlaying());

      await (this.callbacks.persistLyricsImmediately
        ? this.callbacks.persistLyricsImmediately({
            track: targetTrack,
            lyrics: result.lyrics,
            syncOffset: 0,
            embeddedPlainLyrics: targetEmbeddedLyrics,
            metadata: { source: sttSource }
          })
        : Promise.resolve());

      if (this.callbacks.updateDeleteCacheButtonState) {
        this.callbacks.updateDeleteCacheButtonState();
      }

      if (isAuto && targetSettings.autoAnalyzeMode === "align") {
        if ((targetSettings.geminiApiKey || "").trim().length > 0) {
          await this._runAlignment({
            jobId,
            targetTrack,
            whisperLyrics: result.lyrics,
            embeddedLyricsLines: targetEmbeddedLyrics,
            settings: targetSettings,
            fromAutoAnalyze: true
          });
          return;
        }
        this.state.alignSuggestedTrackKey = null;
        this.trackStatus.textContent = `1차 분석 완료 (${result.lyrics.length}줄) · Gemini API Key 미설정으로 AI 정합 건너뜀`;
        this._finishJobIfCurrent(jobId);
        return;
      }

      if ((targetSettings.geminiApiKey || "").trim().length > 0) {
        this.state.alignSuggestedTrackKey = originalTrackKey;
        this.trackStatus.textContent = `1차 분석 완료 (${result.lyrics.length}줄) · 'AI 정합'으로 공식 가사에 맞출 수 있습니다.`;
      } else {
        this.state.alignSuggestedTrackKey = null;
        this.trackStatus.textContent = `1차 분석 완료 (${result.lyrics.length}줄).`;
      }
      this._finishJobIfCurrent(jobId);
      return;
    }

    if (result?.ok && result.lyrics?.length === 0) {
      this.trackStatus.textContent = "No speech detected. Check settings or audio file.";
    } else {
      console.error("[JobManager] Transcription failed:", result?.error);
      this.trackStatus.textContent = `Analysis failed: ${result?.error || "unknown error"}`;
    }

    this._finishJobIfCurrent(jobId);
  }

  async handleCancelClick() {
    [this.cancelButton, this.mainCancelButton].forEach((btn) => {
      if (btn) btn.disabled = true;
    });
    await this.cancelActiveJob({ silent: false });
  }

  async handleAlignClick() {
    if (!this.state.track || this.state.lyrics.length === 0) {
      this.trackStatus.textContent = "No lyrics to align. Run Analyze first.";
      return;
    }
    if (this.state.isTranscribing) {
      return;
    }

    const apiKey = this.state.settings.geminiApiKey || "";
    if (!apiKey.trim()) {
      this.trackStatus.textContent = "Gemini API Key is required for AI Alignment. Please configure it in settings.";
      this.settingsView.open();
      return;
    }

    const targetTrack = {
      ...this.state.track,
      duration: this._resolveTrackDuration(this.state.track)
    };
    const whisperLyrics = this.state.lyrics.map((line) => ({ ...line }));
    const embeddedLyricsLines = Array.isArray(this.state.embeddedLyricsLines)
      ? [...this.state.embeddedLyricsLines]
      : null;
    const settings = { ...(this.state.settings || {}) };

    const jobId = ++this.jobSeq;
    this.activeJobId = jobId;
    this.activeTrackKey = targetTrack.cacheKey;

    await this._runAlignment({
      jobId,
      targetTrack,
      whisperLyrics,
      embeddedLyricsLines,
      settings,
      fromAutoAnalyze: false
    });
  }

  async _runAlignment({ jobId, targetTrack, whisperLyrics, embeddedLyricsLines, settings, fromAutoAnalyze = false }) {
    const originalTrackKey = targetTrack.cacheKey;
    if (!this._isCurrentJob(jobId, originalTrackKey)) {
      return;
    }

    this.activeStage = "aligning";
    this.state.isTranscribing = true;
    this.state.alignSuggestedTrackKey = null;
    this._setTranscribingUI(true, true);
    this.showProgress("AI 정밀 가사 정합 준비 중…", 0.2);
    this.trackStatus.textContent = fromAutoAnalyze
      ? "1차 분석 완료 · AI 정밀 가사 정합 중…"
      : "AI 정밀 가사 정합 중…";

    try {
      const result = await window.lyricsPlayer.alignLyrics({
        jobId,
        track: targetTrack,
        whisperLyrics,
        settings,
        embeddedLyricsLines: embeddedLyricsLines || null
      });

      const persistedPlainLyrics = (Array.isArray(embeddedLyricsLines) && embeddedLyricsLines.length > 0)
        ? embeddedLyricsLines
        : (Array.isArray(result?.officialLyricsLines) && result.officialLyricsLines.length > 0
          ? result.officialLyricsLines
          : null);

      if (!this._isCurrentJob(jobId, originalTrackKey)) {
        if (!result?.cancelled && result?.ok && result.source === "gemini" && result.lyrics?.length > 0) {
          await this._saveBackgroundResult(targetTrack, result.lyrics, persistedPlainLyrics, "gemini_align");
        }
        return;
      }

      if (result?.cancelled) {
        return;
      }

      if (result?.ok && result.lyrics?.length > 0) {
        if (persistedPlainLyrics) {
          this.state.embeddedLyricsLines = persistedPlainLyrics;
        }
        this.state.lyrics = result.lyrics;
        this.state.lyricsSource = result.warning === "fallback_to_whisper" ? "whisper" : "gemini_align";
        this.lyricsViewer.setOffset(0);

        if (result.warning === "fallback_to_whisper") {
          console.warn(
            `[Aligner] Fallback to whisper active (stage=${result.failureStage}, code=${result.errorCode}):\n`,
            result.errorDetail
          );
          this.state.alignSuggestedTrackKey = originalTrackKey;
          this.trackStatus.textContent = this._formatAlignFallbackMessage(result);
          if ((!embeddedLyricsLines || embeddedLyricsLines.length === 0) && persistedPlainLyrics && this.callbacks.persistLyricsImmediately) {
            await this.callbacks.persistLyricsImmediately({
              track: targetTrack,
              lyrics: result.lyrics,
              syncOffset: 0,
              embeddedPlainLyrics: persistedPlainLyrics,
              metadata: { source: "whisper" }
            });
          }
        } else {
          const sourceLabel = result.lyricsSource === "embedded" ? "내장 가사" : "웹 가사";
          this.trackStatus.textContent = `AI 가사 정합 완료 (${result.lyrics.length}줄 · ${sourceLabel} 기준)`;
          await (this.callbacks.persistLyricsImmediately
            ? this.callbacks.persistLyricsImmediately({
                track: targetTrack,
                lyrics: result.lyrics,
                syncOffset: 0,
                embeddedPlainLyrics: persistedPlainLyrics,
                metadata: { source: "gemini_align" }
              })
            : Promise.resolve());
        }

        this.lyricsViewer.render();
        this.lyricsViewer.updateActive(this.player.getCurrentTime(), this.player.isPlaying());
        if (this.callbacks.updateDeleteCacheButtonState) {
          this.callbacks.updateDeleteCacheButtonState();
        }
      } else {
        console.error("[JobManager] Alignment failed:", result?.error);
        this.state.alignSuggestedTrackKey = originalTrackKey;
        this.trackStatus.textContent = `AI Alignment failed: ${result?.error || "unknown error"}`;
      }
    } catch (error) {
      console.error("[JobManager] Alignment exception:", error);
      if (this._isCurrentJob(jobId, originalTrackKey)) {
        this.state.alignSuggestedTrackKey = originalTrackKey;
        this.trackStatus.textContent = `AI Alignment failed: ${error.message}`;
      }
    } finally {
      this._finishJobIfCurrent(jobId);
    }
  }
}

window.LyricsJobManager = LyricsJobManager;
