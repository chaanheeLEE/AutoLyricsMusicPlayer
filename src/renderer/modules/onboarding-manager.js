/**
 * OnboardingManager
 * 첫 실행 시 AI 모델 선택 및 다운로드 온보딩 플로우를 관리합니다.
 */
class OnboardingManager {
  constructor(state) {
    this.state = state;
    this.dialog = document.querySelector("#onboardingDialog");
    this.confirmBtn = document.querySelector("#onboardingConfirmBtn");
    this.skipBtn = document.querySelector("#onboardingSkipBtn");
    this.progressBox = document.querySelector("#onboardingProgressBox");
    this.progressMsg = document.querySelector("#onboardingProgressMsg");
    this.progressPct = document.querySelector("#onboardingProgressPct");
    this.progressBar = document.querySelector("#onboardingProgressBar");
    this.cards = document.querySelectorAll(".onboarding-card");

    this.tagTurbo = document.querySelector("#onboardingTagTurbo");
    this.tagBase = document.querySelector("#onboardingTagBase");

    this._initCardSelection();
    this._initButtons();

    // 다운로드 진행 리스너
    if (window.lyricsPlayer?.onModelDownloadProgress) {
      window.lyricsPlayer.onModelDownloadProgress((msg) => {
        this._handleProgress(msg);
      });
    }
  }

  _initCardSelection() {
    this.cards.forEach(card => {
      card.addEventListener("click", () => {
        this.cards.forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        const radio = card.querySelector("input[type=radio]");
        if (radio) radio.checked = true;
      });
    });
  }

  _initButtons() {
    this.confirmBtn?.addEventListener("click", () => this._onConfirm());
    this.skipBtn?.addEventListener("click", () => this._onSkip());
  }

  async show() {
    if (!this.dialog) return;
    // 설치 상태 태그 업데이트
    await this._updateInstallTags();
    this.dialog.showModal();
  }

  async _updateInstallTags() {
    try {
      const result = await window.lyricsPlayer.listModels();
      if (!result?.models) return;
      for (const m of result.models) {
        if (m.id === "large-v3-turbo" && this.tagTurbo) {
          this.tagTurbo.textContent = m.downloaded ? "✓ 이미 설치됨" : "미설치";
          this.tagTurbo.style.color = m.downloaded ? "var(--accent)" : "";
        }
        if (m.id === "base" && this.tagBase) {
          this.tagBase.textContent = m.downloaded ? "✓ 이미 설치됨" : "미설치";
          this.tagBase.style.color = m.downloaded ? "var(--accent)" : "";
        }
      }
    } catch (e) {
      console.warn("[Onboarding] Failed to check model status:", e);
    }
  }

  _getSelectedModelId() {
    const checked = document.querySelector("input[name=onboardingModelChoice]:checked");
    return checked?.value || "base";
  }

  async _onConfirm() {
    const modelId = this._getSelectedModelId();

    if (modelId === "gemini") {
      // Gemini 선택: 엔진을 gemini로 설정하고 저장
      await this._applyAndFinish("gemini", null);
      return;
    }

    // Whisper 모델: 설치 여부 확인 후 다운로드
    let alreadyInstalled = false;
    try {
      const result = await window.lyricsPlayer.listModels();
      const found = result?.models?.find(m => m.id === modelId);
      alreadyInstalled = found?.downloaded === true;
    } catch { /* ignore */ }

    if (alreadyInstalled) {
      await this._applyAndFinish("whisper", modelId);
      return;
    }

    // 다운로드 시작
    this._setConfirmBusy(true);
    this.progressBox.style.display = "";

    try {
      await window.lyricsPlayer.downloadModel(modelId);
      await this._applyAndFinish("whisper", modelId);
    } catch (err) {
      console.error("[Onboarding] Download failed:", err);
      this._setConfirmBusy(false);
      this.progressBox.style.display = "none";
      alert(`모델 다운로드에 실패했습니다: ${err.message || err}`);
    }
  }

  async _applyAndFinish(engine, modelId) {
    try {
      const current = await window.lyricsPlayer.loadSettings();
      const next = {
        ...current,
        firstRunCompleted: true,
        sttEngine: engine,
      };
      if (modelId) next.model = modelId;
      const saved = await window.lyricsPlayer.saveSettings(next);
      this.state.settings = saved;
    } catch (e) {
      console.warn("[Onboarding] Failed to save settings:", e);
    }
    this._close();
  }

  async _onSkip() {
    try {
      const current = await window.lyricsPlayer.loadSettings();
      const next = { ...current, firstRunCompleted: true };
      const saved = await window.lyricsPlayer.saveSettings(next);
      this.state.settings = saved;
    } catch { /* ignore */ }
    this._close();
  }

  _handleProgress(msg) {
    if (!this.progressBox) return;
    if (this.progressBox.style.display === "none") return;

    const pct = msg.percent != null ? Math.round(msg.percent * 100) : null;
    if (this.progressMsg) {
      this.progressMsg.textContent = msg.message || `${msg.modelId} 다운로드 중...`;
    }
    if (this.progressBar && pct != null) {
      this.progressBar.style.width = `${pct}%`;
    }
    if (this.progressPct) {
      this.progressPct.textContent = pct != null ? `${pct}%` : "...";
    }
  }

  _setConfirmBusy(busy) {
    if (this.confirmBtn) {
      this.confirmBtn.disabled = busy;
      this.confirmBtn.textContent = busy ? "다운로드 중..." : "선택한 모델 적용 및 시작";
    }
    if (this.skipBtn) this.skipBtn.disabled = busy;
    this.cards.forEach(c => {
      c.style.pointerEvents = busy ? "none" : "";
      c.style.opacity = busy ? "0.5" : "";
    });
  }

  _close() {
    if (this.dialog) this.dialog.close();
  }
}

window.OnboardingManager = OnboardingManager;
