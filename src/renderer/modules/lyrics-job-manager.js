(function attachLyricsJobManager(root) {
  const defaultLyricsCore =
    (root && root.lyricsCore) ||
    (typeof require === "function" ? require("../../shared/lyrics-core") : null);

  const STAGE_LABELS = Object.freeze({
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
  });

  const ALIGN_FALLBACK_MESSAGES = Object.freeze({
    scrape_timeout: "AI 정합 실패 (공식 가사 검색 시간 초과) · 'AI 정합'으로 다시 시도할 수 있습니다",
    scrape_not_found: "AI 정합 실패 (일치하는 공식 가사 미발견) · 'AI 정합'으로 다시 시도할 수 있습니다",
    empty_official_lyrics: "AI 정합 실패 (일치하는 공식 가사 미발견) · 'AI 정합'으로 다시 시도할 수 있습니다",
    gemini_timeout: "AI 정합 실패 (Gemini 응답 시간 초과) · 'AI 정합'으로 다시 시도할 수 있습니다",
    gemini_overloaded: "AI 정합 실패 (서버 혼잡 · 503) · 잠시 후 'AI 정합'으로 다시 시도하세요",
    gemini_rate_limited: "AI 정합 실패 (요청 한도 초과 · 429) · 잠시 후 'AI 정합'으로 다시 시도하세요",
    gemini_api_error: "AI 정합 실패 (Gemini API 오류) · 'AI 정합'으로 다시 시도할 수 있습니다",
    no_valid_matches: "AI 정합 실패 (가사 싱크 매칭 불가) · 'AI 정합'으로 다시 시도할 수 있습니다",
  });

  function normalizeDeviceLabel(rawLabel) {
    if (!rawLabel || typeof rawLabel !== "string") return "";
    if (/gpu|cuda|dml|directml/i.test(rawLabel)) return "GPU";
    if (/cpu/i.test(rawLabel)) return "CPU";
    return "";
  }

  function isProgressMessageForJob(msg, activeJobId) {
    if (!activeJobId) return false;
    if (msg?.jobId !== undefined && msg?.jobId !== null && msg.jobId !== activeJobId) {
      return false;
    }
    return true;
  }

  function formatProgressMessage(msg) {
    if (!msg || typeof msg !== "object") return null;
    if (msg.type === "progress") {
      const baseLabel = STAGE_LABELS[msg.stage] || "작업 진행 중…";
      const deviceLabel = normalizeDeviceLabel(msg.deviceLabel);
      const label = deviceLabel ? `${baseLabel} [${deviceLabel}]` : baseLabel;
      const percent = msg.percent !== undefined ? msg.percent : 0;
      return { kind: "progress", label, percent };
    }
    if (msg.type === "segment") {
      return { kind: "progress", label: `가사 수신 중… (${msg.id})`, percent: 0.9 };
    }
    if (msg.type === "error") {
      return { kind: "error", message: msg.message };
    }
    return null;
  }

  function formatAlignFallbackMessage(result) {
    const code = result?.errorCode;
    if (code && ALIGN_FALLBACK_MESSAGES[code]) {
      return ALIGN_FALLBACK_MESSAGES[code];
    }
    const detail = result?.errorMessage || result?.errorDetail?.split("\n")[0] || "unknown error";
    return `AI Alignment Failed: ${detail}`;
  }

  function buildOpeningPromptHint(embeddedLyricsLines) {
    if (!Array.isArray(embeddedLyricsLines) || embeddedLyricsLines.length === 0) {
      return null;
    }
    const openingHint = embeddedLyricsLines
      .map((line) => (typeof line === "string" ? line.trim() : ""))
      .filter((line) => line && !/^[\[\(].*[\]\)]$/.test(line))
      .slice(0, 4)
      .join(" ")
      .slice(0, 120)
      .trim();
    return openingHint || null;
  }

  function resolveAdaptiveBeamSize({
    explicitBeamSize = undefined,
    isAuto = false,
    autoAnalyzeMode = "off",
    geminiApiKey = "",
    hasPlainLyrics = false
  } = {}) {
    if (explicitBeamSize !== undefined) {
      return explicitBeamSize;
    }
    const willAutoAlign = Boolean(
      isAuto && autoAnalyzeMode === "align" && String(geminiApiKey || "").trim()
    );
    return (willAutoAlign || Boolean(hasPlainLyrics)) ? 2 : 3;
  }

  function resolvePersistedPlainLyrics(embeddedLyricsLines, plainLyricsSource, officialLyricsLines) {
    if (Array.isArray(embeddedLyricsLines) && embeddedLyricsLines.length > 0) {
      return {
        lines: embeddedLyricsLines,
        source: plainLyricsSource || "embedded_plain"
      };
    }
    if (Array.isArray(officialLyricsLines) && officialLyricsLines.length > 0) {
      return {
        lines: officialLyricsLines,
        source: "lrclib_cached"
      };
    }
    return { lines: null, source: null };
  }

  class LyricsJobManager {
    constructor(state, player, lyricsViewer, settingsView, callbacks = {}, runtime = {}) {
      this.state = state;
      this.player = player;
      this.lyricsViewer = lyricsViewer;
      this.settingsView = settingsView;
      this.callbacks = callbacks; // { persistLyricsSoon, persistLyricsImmediately, updateAlignButtonState, ... }

      this.doc = runtime.doc || (typeof document !== "undefined" ? document : null);
      this.api = runtime.api || (root && root.lyricsPlayer) || null;
      this.lyricsCore = runtime.lyricsCore || defaultLyricsCore;
      this.alertFn = runtime.alertFn || (typeof alert === "function" ? alert : () => {});

      this.analyzeButton = this._q("#analyzeButton");
      this.cancelButton = this._q("#cancelButton");
      this.alignButton = this._q("#alignButton");
      this.mainAnalyzeButton = this._q("#mainAnalyzeButton");
      this.mainCancelButton = this._q("#mainCancelButton");
      this.mainAlignButton = this._q("#mainAlignButton");
      this.trackStatus = this._q("#trackStatus");

      this.transcriptionProgress = this._q("#transcriptionProgress");
      this.progressLabel = this._q("#progressLabel");
      this.progressBar = this._q("#progressBar");
      this.mainTranscriptionProgress = this._q("#mainTranscriptionProgress");
      this.mainProgressLabel = this._q("#mainProgressLabel");
      this.mainProgressBar = this._q("#mainProgressBar");

      this.jobSeq = 0;
      this.activeJobId = null;
      this.activeTrackKey = null;
      this.activeStage = null;

      this._initEvents();
    }

    _q(selector) {
      return this.doc?.querySelector ? this.doc.querySelector(selector) : null;
    }

    _setTrackStatus(text) {
      if (this.trackStatus) {
        this.trackStatus.textContent = text;
      }
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
      if (this.api?.onTranscriptionProgress) {
        this.api.onTranscriptionProgress((msg) => {
          this._handleTranscriptionProgress(msg);
        });
      }
    }

    _handleTranscriptionProgress(msg) {
      if (!isProgressMessageForJob(msg, this.activeJobId)) {
        return;
      }
      const action = formatProgressMessage(msg);
      if (!action) return;

      if (action.kind === "progress") {
        this.showProgress(action.label, action.percent);
      } else if (action.kind === "error") {
        this.hideProgress();
        if (!this.activeTrackKey || this.state.track?.cacheKey === this.activeTrackKey) {
          this._setTrackStatus(`오류: ${action.message}`);
        }
      }
    }

    _normalizeDeviceLabel(rawLabel) {
      return normalizeDeviceLabel(rawLabel);
    }

    _resolveTrackDuration(track) {
      const playerDur = this.player?.getDuration?.();
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

    async _saveBackgroundResult(targetTrack, lyrics, embeddedPlainLyrics, source, plainLyricsSource = null) {
      if (!targetTrack?.cacheKey || !Array.isArray(lyrics) || lyrics.length === 0) {
        return;
      }
      const payload = {
        track: targetTrack,
        lyrics,
        syncOffset: 0,
        embeddedPlainLyrics: embeddedPlainLyrics || null,
        plainLyricsSource: plainLyricsSource || null,
        metadata: { source }
      };
      try {
        if (this.callbacks.persistLyricsImmediately) {
          await this.callbacks.persistLyricsImmediately(payload);
        } else if (this.api?.saveCachedLyrics) {
          await this.api.saveCachedLyrics(payload);
        }
        console.log(`[JobManager] Background job completed for switched track (${targetTrack.title}); saved safely to original track cache.`);
      } catch (err) {
        console.warn("[JobManager] Failed to persist background job result:", err);
      }
    }

    _formatAlignFallbackMessage(result) {
      return formatAlignFallbackMessage(result);
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
            btn.classList?.remove?.("align-suggested");
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
        this._setTrackStatus("Analysis cancelled.");
      }

      if (hadActive && this.api?.cancelTranscription) {
        try {
          await this.api.cancelTranscription();
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
          this._setTrackStatus("자동 분석 건너뜀: Gemini API Key가 설정되지 않았습니다.");
        } else {
          this.alertFn("Gemini API Engine을 사용하려면 설정에서 Gemini API Key를 입력해야 합니다.");
          this.settingsView?.open?.();
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
      const targetPlainLyricsSource = this.state.plainLyricsSource || null;
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
        this._setTrackStatus("Uploading & Analyzing…");
      } else {
        this.showProgress("오디오 변환 중…", 0);
        this._setTrackStatus("Analyzing…");
      }

      options.initialPrompt = buildOpeningPromptHint(targetEmbeddedLyrics);
      options.beamSize = resolveAdaptiveBeamSize({
        explicitBeamSize: options.beamSize,
        isAuto,
        autoAnalyzeMode: targetSettings.autoAnalyzeMode,
        geminiApiKey: targetSettings.geminiApiKey,
        hasPlainLyrics: Boolean(targetEmbeddedLyrics && targetEmbeddedLyrics.length > 0)
      });

      const sttSource = options.sttEngine === "gemini" ? "gemini" : "whisper";
      const result = await this.api?.startTranscription?.(targetTrack, options);

      // 작업 중 다른 곡으로 전환되었거나 취소된 경우: 현재 화면 상태를 건드리지 않고 원곡 캐시만 안전 저장
      if (!this._isCurrentJob(jobId, originalTrackKey)) {
        if (!result?.cancelled && result?.ok && result.lyrics?.length > 0) {
          await this._saveBackgroundResult(
            targetTrack,
            result.lyrics,
            targetEmbeddedLyrics,
            sttSource,
            targetPlainLyricsSource
          );
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
        this.lyricsViewer?.setOffset?.(0);
        this.lyricsViewer?.render?.();
        this.lyricsViewer?.updateActive?.(this.player?.getCurrentTime?.(), this.player?.isPlaying?.());

        await (this.callbacks.persistLyricsImmediately
          ? this.callbacks.persistLyricsImmediately({
              track: targetTrack,
              lyrics: result.lyrics,
              syncOffset: 0,
              embeddedPlainLyrics: targetEmbeddedLyrics,
              plainLyricsSource: targetPlainLyricsSource,
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
              plainLyricsSource: targetPlainLyricsSource,
              settings: targetSettings,
              fromAutoAnalyze: true
            });
            return;
          }
          this.state.alignSuggestedTrackKey = null;
          this._setTrackStatus(`1차 분석 완료 (${result.lyrics.length}줄) · Gemini API Key 미설정으로 AI 정합 건너뜀`);
          this._finishJobIfCurrent(jobId);
          return;
        }

        if ((targetSettings.geminiApiKey || "").trim().length > 0) {
          this.state.alignSuggestedTrackKey = originalTrackKey;
          this._setTrackStatus(`1차 분석 완료 (${result.lyrics.length}줄) · 'AI 정합'으로 공식 가사에 맞출 수 있습니다.`);
        } else {
          this.state.alignSuggestedTrackKey = null;
          this._setTrackStatus(`1차 분석 완료 (${result.lyrics.length}줄).`);
        }
        this._finishJobIfCurrent(jobId);
        return;
      }

      if (result?.ok && result.lyrics?.length === 0) {
        this._setTrackStatus("No speech detected. Check settings or audio file.");
      } else {
        console.error("[JobManager] Transcription failed:", result?.error);
        this._setTrackStatus(`Analysis failed: ${result?.error || "unknown error"}`);
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
        this._setTrackStatus("No lyrics to align. Run Analyze first.");
        return;
      }
      if (this.state.isTranscribing) {
        return;
      }

      const apiKey = this.state.settings.geminiApiKey || "";
      if (!apiKey.trim()) {
        this._setTrackStatus("Gemini API Key is required for AI Alignment. Please configure it in settings.");
        this.settingsView?.open?.();
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
      const plainLyricsSource = this.state.plainLyricsSource || null;
      const settings = { ...(this.state.settings || {}) };

      const jobId = ++this.jobSeq;
      this.activeJobId = jobId;
      this.activeTrackKey = targetTrack.cacheKey;

      await this._runAlignment({
        jobId,
        targetTrack,
        whisperLyrics,
        embeddedLyricsLines,
        plainLyricsSource,
        settings,
        fromAutoAnalyze: false
      });
    }

    async _runAlignment({ jobId, targetTrack, whisperLyrics, embeddedLyricsLines, plainLyricsSource = null, settings, fromAutoAnalyze = false }) {
      const originalTrackKey = targetTrack.cacheKey;
      if (!this._isCurrentJob(jobId, originalTrackKey)) {
        return;
      }

      this.activeStage = "aligning";
      this.state.isTranscribing = true;
      this.state.alignSuggestedTrackKey = null;
      this._setTranscribingUI(true, true);
      this.showProgress("AI 정밀 가사 정합 준비 중…", 0.2);
      this._setTrackStatus(
        fromAutoAnalyze
          ? "1차 분석 완료 · AI 정밀 가사 정합 중…"
          : "AI 정밀 가사 정합 중…"
      );

      try {
        const result = await this.api?.alignLyrics?.({
          jobId,
          track: targetTrack,
          whisperLyrics,
          settings,
          embeddedLyricsLines: embeddedLyricsLines || null,
          plainLyricsSource: plainLyricsSource || null
        });

        const {
          lines: persistedPlainLyrics,
          source: persistedPlainLyricsSource
        } = resolvePersistedPlainLyrics(embeddedLyricsLines, plainLyricsSource, result?.officialLyricsLines);

        if (!this._isCurrentJob(jobId, originalTrackKey)) {
          if (!result?.cancelled && result?.ok && result.source === "gemini" && result.lyrics?.length > 0) {
            await this._saveBackgroundResult(
              targetTrack,
              result.lyrics,
              persistedPlainLyrics,
              "gemini_align",
              persistedPlainLyricsSource
            );
          }
          return;
        }

        if (result?.cancelled) {
          return;
        }

        if (result?.ok && result.lyrics?.length > 0) {
          if (persistedPlainLyrics) {
            this.state.embeddedLyricsLines = persistedPlainLyrics;
            this.state.plainLyricsSource = persistedPlainLyricsSource;
          }
          this.state.lyrics = result.lyrics;
          this.state.lyricsSource = result.warning === "fallback_to_whisper" ? "whisper" : "gemini_align";
          this.lyricsViewer?.setOffset?.(0);

          if (result.warning === "fallback_to_whisper") {
            console.warn(
              `[Aligner] Fallback to whisper active (stage=${result.failureStage}, code=${result.errorCode}):\n`,
              result.errorDetail
            );
            this.state.alignSuggestedTrackKey = originalTrackKey;
            this._setTrackStatus(this._formatAlignFallbackMessage(result));
            if ((!embeddedLyricsLines || embeddedLyricsLines.length === 0) && persistedPlainLyrics && this.callbacks.persistLyricsImmediately) {
              await this.callbacks.persistLyricsImmediately({
                track: targetTrack,
                lyrics: result.lyrics,
                syncOffset: 0,
                embeddedPlainLyrics: persistedPlainLyrics,
                plainLyricsSource: persistedPlainLyricsSource,
                metadata: { source: "whisper" }
              });
            }
          } else {
            const sourceLabel = this.lyricsCore?.resolvePlainLyricsSourceLabel
              ? this.lyricsCore.resolvePlainLyricsSourceLabel(result.lyricsSource)
              : (result.lyricsSource === "embedded" ? "내장 가사" : "웹 가사");
            this._setTrackStatus(`AI 가사 정합 완료 (${result.lyrics.length}줄 · ${sourceLabel} 기준)`);
            await (this.callbacks.persistLyricsImmediately
              ? this.callbacks.persistLyricsImmediately({
                  track: targetTrack,
                  lyrics: result.lyrics,
                  syncOffset: 0,
                  embeddedPlainLyrics: persistedPlainLyrics,
                  plainLyricsSource: persistedPlainLyricsSource,
                  metadata: { source: "gemini_align" }
                })
              : Promise.resolve());
          }

          this.lyricsViewer?.render?.();
          this.lyricsViewer?.updateActive?.(this.player?.getCurrentTime?.(), this.player?.isPlaying?.());
          if (this.callbacks.updateDeleteCacheButtonState) {
            this.callbacks.updateDeleteCacheButtonState();
          }
        } else {
          console.error("[JobManager] Alignment failed:", result?.error);
          this.state.alignSuggestedTrackKey = originalTrackKey;
          this._setTrackStatus(`AI Alignment failed: ${result?.error || "unknown error"}`);
        }
      } catch (error) {
        console.error("[JobManager] Alignment exception:", error);
        if (this._isCurrentJob(jobId, originalTrackKey)) {
          this.state.alignSuggestedTrackKey = originalTrackKey;
          this._setTrackStatus(`AI Alignment failed: ${error.message}`);
        }
      } finally {
        this._finishJobIfCurrent(jobId);
      }
    }
  }

  const exportsObj = {
    LyricsJobManager,
    STAGE_LABELS,
    ALIGN_FALLBACK_MESSAGES,
    normalizeDeviceLabel,
    isProgressMessageForJob,
    formatProgressMessage,
    formatAlignFallbackMessage,
    buildOpeningPromptHint,
    resolveAdaptiveBeamSize,
    resolvePersistedPlainLyrics
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }

  if (root) {
    root.LyricsJobManager = LyricsJobManager;
    root.lyricsJobHelpers = {
      STAGE_LABELS,
      ALIGN_FALLBACK_MESSAGES,
      normalizeDeviceLabel,
      isProgressMessageForJob,
      formatProgressMessage,
      formatAlignFallbackMessage,
      buildOpeningPromptHint,
      resolveAdaptiveBeamSize,
      resolvePersistedPlainLyrics
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
