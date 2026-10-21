class SettingsView {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks; // { onSave }
    
    this.settingsButton = document.querySelector("#settingsButton");
    this.settingsDialog = document.querySelector("#settingsDialog");
    this.saveSettingsButton = document.querySelector("#saveSettingsButton");
    
    this.tabGeneralBtn = document.querySelector("#tabGeneralBtn");
    this.tabFloatingBtn = document.querySelector("#tabFloatingBtn");
    this.tabShortcutsBtn = document.querySelector("#tabShortcutsBtn");
    this.tabGeneralContent = document.querySelector("#tabGeneralContent");
    this.tabFloatingContent = document.querySelector("#tabFloatingContent");
    this.tabShortcutsContent = document.querySelector("#tabShortcutsContent");
    
    this.settingEngine = document.querySelector("#settingEngine");
    this.settingModel = document.querySelector("#settingModel");
    this.settingWhisperDevice = document.querySelector("#settingWhisperDevice");
    this.settingGeminiModel = document.querySelector("#settingGeminiModel");
    this.settingLanguage = document.querySelector("#settingLanguage");
    this.settingGeminiKey = document.querySelector("#settingGeminiKey");
    this.settingAutoAnalyzeMode = document.querySelector("#settingAutoAnalyzeMode");
    this.settingModelGroup = document.querySelector("#settingModelGroup");
    this.settingWhisperDeviceGroup = document.querySelector("#settingWhisperDeviceGroup");
    this.settingGeminiModelGroup = document.querySelector("#settingGeminiModelGroup");
    
    this.settingFloatingFontSize = document.querySelector("#settingFloatingFontSize");
    this.settingFloatingOpacity = document.querySelector("#settingFloatingOpacity");
    this.settingFloatingBgColor = document.querySelector("#settingFloatingBgColor");
    this.settingFloatingFontColor = document.querySelector("#settingFloatingFontColor");
    this.settingFloatingAlign = document.querySelector("#settingFloatingAlign");
    
    this.valFloatingFontSize = document.querySelector("#valFloatingFontSize");
    this.valFloatingOpacity = document.querySelector("#valFloatingOpacity");
    
    this.clearCacheButton = document.querySelector("#clearCacheButton");
    this.cachePathLabel = document.querySelector("#cachePathLabel");

    this.modelCardsContainer = document.querySelector("#modelCardsContainer");
    this.modelManagerTotalSize = document.querySelector("#modelManagerTotalSize");
    this.modelManagerAccordion = document.querySelector("#modelManagerGroup");
    this.modelManagerToggle = document.querySelector("#modelManagerToggle");
    this.modelManagerBody = document.querySelector("#modelManagerBody");
    this.currentDownloadingModelId = null;
    this.cachedModelList = [];
    this._accordionOpen = false;

    this.tempShortcuts = {};
    this.capturingAction = null;
    this.shortcutBtns = document.querySelectorAll(".shortcut-capture-btn");

    this._initEvents();

    if (window.lyricsPlayer?.onModelDownloadProgress) {
      window.lyricsPlayer.onModelDownloadProgress((msg) => {
        this.handleDownloadProgress(msg);
      });
    }
  }

  _initEvents() {
    this.settingsButton.addEventListener("click", () => this.open());
    
    this.tabGeneralBtn.addEventListener("click", () => {
      this.tabGeneralBtn.classList.add("active");
      this.tabFloatingBtn.classList.remove("active");
      this.tabShortcutsBtn.classList.remove("active");
      this.tabGeneralContent.classList.add("active");
      this.tabFloatingContent.classList.remove("active");
      this.tabShortcutsContent.classList.remove("active");
    });
    
    this.tabFloatingBtn.addEventListener("click", () => {
      this.tabFloatingBtn.classList.add("active");
      this.tabGeneralBtn.classList.remove("active");
      this.tabShortcutsBtn.classList.remove("active");
      this.tabFloatingContent.classList.add("active");
      this.tabGeneralContent.classList.remove("active");
      this.tabShortcutsContent.classList.remove("active");
    });

    this.tabShortcutsBtn.addEventListener("click", () => {
      this.tabShortcutsBtn.classList.add("active");
      this.tabGeneralBtn.classList.remove("active");
      this.tabFloatingBtn.classList.remove("active");
      this.tabShortcutsContent.classList.add("active");
      this.tabGeneralContent.classList.remove("active");
      this.tabFloatingContent.classList.remove("active");
    });

    this.settingFloatingFontSize.addEventListener("input", () => {
      this.valFloatingFontSize.textContent = this.settingFloatingFontSize.value;
    });
    
    this.settingFloatingOpacity.addEventListener("input", () => {
      this.valFloatingOpacity.textContent = this.settingFloatingOpacity.value;
    });

    this.settingGeminiKey.addEventListener("input", () => {
      this.updateAutoAnalyzeDropdownState();
      this.updateSTTEngineUI();
    });
    this.settingAutoAnalyzeMode.addEventListener("change", () => this.updateSTTEngineUI());
    this.settingEngine.addEventListener("change", () => this.updateSTTEngineUI());
    
    this.saveSettingsButton.addEventListener("click", () => this.save());
    
    this.clearCacheButton.addEventListener("click", () => this.clearCache());

    // 아코디언 토글
    if (this.modelManagerToggle) {
      this.modelManagerToggle.addEventListener("click", () => this._toggleAccordion());
    }
    // 단축키 캡처 버튼 이벤트 바인딩
    this.shortcutBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        if (this.capturingAction) {
          const prevBtn = document.querySelector(`.shortcut-capture-btn.capturing`);
          if (prevBtn) {
            prevBtn.classList.remove("capturing");
            prevBtn.textContent = this.tempShortcuts[this.capturingAction] || "None";
          }
        }
        const action = btn.dataset.action;
        this.capturingAction = action;
        btn.classList.add("capturing");
        btn.textContent = "Press any key...";
      });
    });

    // 전역 keydown 감지 (단축키 캡처 시 가로채기)
    document.addEventListener("keydown", (e) => {
      if (!this.capturingAction) return;

      e.preventDefault();
      e.stopPropagation();

      const btn = document.querySelector(`.shortcut-capture-btn[data-action="${this.capturingAction}"]`);

      if (e.code === "Escape") {
        if (btn) {
          btn.classList.remove("capturing");
          btn.textContent = this.tempShortcuts[this.capturingAction] || "None";
        }
        this.capturingAction = null;
        return;
      }

      const keyName = e.code;
      this.tempShortcuts[this.capturingAction] = keyName;

      if (btn) {
        btn.classList.remove("capturing");
        btn.textContent = keyName;
      }
      this.capturingAction = null;
    }, true);
  }

  open() {
    this.tabGeneralBtn.click();
    this.updateSTTEngineUI();
    this._toggleAccordion(false);
    this.capturingAction = null;
    this.settingsDialog.showModal();
  }

  close() {
    this.settingsDialog.close();
  }

  toggleVisibility(element, show) {
    if (element) {
      element.style.display = show ? "" : "none";
    }
  }

  updateSTTEngineUI() {
    const isGemini = this.settingEngine.value === "gemini";
    const isAlignMode = this.settingAutoAnalyzeMode.value === "align";
    const hasApiKey = !!this.settingGeminiKey.value.trim();
    const showGeminiModel = isGemini || isAlignMode || hasApiKey;

    this.toggleVisibility(this.settingModelGroup, !isGemini);
    this.toggleVisibility(this.modelManagerAccordion, !isGemini);
    this.toggleVisibility(this.settingWhisperDeviceGroup, !isGemini);
    this.toggleVisibility(this.settingGeminiModelGroup, showGeminiModel);
    this.updateAutoAnalyzeDropdownState();
  }

  updateAutoAnalyzeDropdownState() {
    const hasApiKey = !!this.settingGeminiKey.value.trim();
    const alignOption = this.settingAutoAnalyzeMode.querySelector('option[value="align"]');
    if (alignOption) {
      alignOption.disabled = !hasApiKey;
      if (!hasApiKey && this.settingAutoAnalyzeMode.value === "align") {
        this.settingAutoAnalyzeMode.value = "analyze";
      }
    }
  }

  async save() {
    // STT Engine이 Gemini인데 API Key가 없는 경우 경고 및 가드
    if (this.settingEngine.value === "gemini" && !this.settingGeminiKey.value.trim()) {
      alert("Gemini API Engine을 사용하려면 Gemini API Key를 입력해야 합니다.");
      this.settingGeminiKey.focus();
      return;
    }

    const next = {
      sttEngine: this.settingEngine.value,
      model: this.settingModel.value,
      whisperDevice: this.settingWhisperDevice.value,
      geminiModel: this.settingGeminiModel.value,
      language: this.settingLanguage.value || null,
      geminiApiKey: this.settingGeminiKey.value || "",
      autoAnalyzeMode: this.settingAutoAnalyzeMode.value,
      floatingFontSize: this.settingFloatingFontSize.value,
      floatingOpacity: this.settingFloatingOpacity.value,
      floatingBgColor: this.settingFloatingBgColor.value,
      floatingFontColor: this.settingFloatingFontColor.value,
      floatingAlign: this.settingFloatingAlign.value,
      shortcuts: this.tempShortcuts,
    };
    const saved = await window.lyricsPlayer.saveSettings(next);
    this.state.settings = saved;
    this.close();
    this.callbacks.onSave(saved);
  }

  async clearCache() {
    const result = await window.lyricsPlayer.clearCache();
    if (result?.ok) {
      this.clearCacheButton.textContent = `Cleared (${result.cleared} files)`;
      setTimeout(() => { this.clearCacheButton.textContent = "Clear Cache"; }, 2500);
    }
  }

  bindConfigValues(settings, dataPath) {
    this.settingEngine.value = settings.sttEngine || "whisper";
    this.settingModel.value = settings.model;
    this.settingWhisperDevice.value = settings.whisperDevice || "auto";
    this.settingGeminiModel.value = settings.geminiModel || "gemini-3.1-flash-lite";
    this.settingLanguage.value = settings.language || "";
    this.settingGeminiKey.value = settings.geminiApiKey || "";
    this.settingAutoAnalyzeMode.value = settings.autoAnalyzeMode || "off";
    this.updateSTTEngineUI();

    this.settingFloatingFontSize.value = settings.floatingFontSize || 18;
    this.valFloatingFontSize.textContent = this.settingFloatingFontSize.value;

    this.settingFloatingOpacity.value = settings.floatingOpacity !== undefined ? settings.floatingOpacity : 0.85;
    this.valFloatingOpacity.textContent = this.settingFloatingOpacity.value;

    this.settingFloatingBgColor.value = settings.floatingBgColor || "#0b0d11";
    this.settingFloatingFontColor.value = settings.floatingFontColor || "#ffffff";
    this.settingFloatingAlign.value = settings.floatingAlign || "center";

    // 단축키 UI 값 맵핑
    this.tempShortcuts = { ...(settings.shortcuts || {}) };
    this.shortcutBtns.forEach(btn => {
      const action = btn.dataset.action;
      btn.textContent = this.tempShortcuts[action] || "None";
      btn.classList.remove("capturing");
    });

    this.cachePathLabel.textContent = dataPath;

    // 모델 목록 비동기 갱신 (설정창이 열릴 때마다 자동 새로고침)
    this.refreshModelList();
  }

  _toggleAccordion(forceState) {
    this._accordionOpen = typeof forceState === "boolean" ? forceState : !this._accordionOpen;
    if (this.modelManagerAccordion) {
      this.modelManagerAccordion.classList.toggle("expanded", this._accordionOpen);
    }
    if (this.modelManagerToggle) {
      this.modelManagerToggle.setAttribute("aria-expanded", String(this._accordionOpen));
    }
  }

  // ─── Whisper Model Manager ────────────────────────────────────────────
  async refreshModelList() {
    if (!this.modelCardsContainer) return;
    try {
      const result = await window.lyricsPlayer.listModels();
      if (!result) return;
      this.cachedModelList = result.models;
      this.renderModelCards(result.models, this.state.settings?.model || "base");
      this._rebuildModelSelect(result.models);
      if (this.modelManagerTotalSize) {
        this.modelManagerTotalSize.textContent = result.totalDiskSizeFormatted || "0 MB";
      }
    } catch (e) {
      console.warn("[ModelManager] Failed to load models:", e);
    }
  }

  /**
   * settingModel <select>를 설치된 모델만, 크기 오름차순으로 재구성합니다.
   * 현재 설정값이 설치된 모델 중에 없으면 첫 번째 설치 모델로 자동 변경합니다.
   */
  _rebuildModelSelect(models) {
    if (!this.settingModel) return;

    // 크기 오름차순은 SUPPORTED_MODELS 순서(model-manager)가 이미 보장하므로 그대로 활용
    const installed = models.filter(m => m.downloaded);
    const currentVal = this.settingModel.value;

    this.settingModel.innerHTML = "";

    if (installed.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "설치된 모델 없음 — 아래에서 다운로드하세요";
      opt.disabled = true;
      opt.selected = true;
      this.settingModel.appendChild(opt);
      return;
    }

    let matched = false;
    for (const m of installed) {
      const opt = document.createElement("option");
      opt.value = m.id;
      const badge = m.badge ? ` (${m.badge})` : "";
      opt.textContent = `${m.label} — ${m.sizeLabel}${badge}`;
      if (m.id === currentVal) {
        opt.selected = true;
        matched = true;
      }
      this.settingModel.appendChild(opt);
    }

    // 현재 선택값이 설치 목록에 없으면 첫 번째 설치 모델로 fallback
    if (!matched) {
      this.settingModel.selectedIndex = 0;
    }
  }

  renderModelCards(models, currentModel) {
    if (!this.modelCardsContainer) return;
    this.modelCardsContainer.innerHTML = "";

    for (const m of models) {
      const isActive = m.id === currentModel;
      const isDownloading = this.currentDownloadingModelId === m.id;

      const card = document.createElement("div");
      card.className = "model-card" + (isActive ? " current-active" : "");
      card.dataset.modelId = m.id;

      let badgeHtml = "";
      if (m.badge === "최신 추천") badgeHtml = `<span class="model-badge badge-recommend">🚀 최신 추천</span>`;
      else if (m.badge === "기본값") badgeHtml = `<span class="model-badge badge-default">⚡ 기본</span>`;

      const statusHtml = m.downloaded
        ? `<span class="model-status-installed">✓ 설치됨 (${m.diskSizeFormatted})</span>`
        : `<span class="model-status-not-installed">미설치 (${m.sizeLabel})</span>`;

      let actionsHtml = "";
      if (isDownloading) {
        actionsHtml = `<button type="button" class="btn-model-action" disabled>⏳ 다운로드 중...</button>`;
      } else if (m.downloaded) {
        actionsHtml = `
          <button type="button" class="btn-model-action btn-delete" data-action="delete" data-model="${m.id}"${isActive ? " title=\"현재 선택된 모델입니다\"" : ""}>삭제</button>
        `;
      } else {
        actionsHtml = `<button type="button" class="btn-model-action btn-download" data-action="download" data-model="${m.id}">⬇ 다운로드</button>`;
      }

      card.innerHTML = `
        <div class="model-card-info">
          <div class="model-card-name-row">
            <span class="model-card-name">${m.label}</span>
            ${badgeHtml}
            ${isActive ? `<span class="model-badge badge-primary">✓ 사용 중</span>` : ""}
          </div>
          <div class="model-card-desc">${m.description}</div>
          <div class="model-card-meta">${statusHtml}</div>
        </div>
        <div class="model-card-actions">${actionsHtml}</div>
      `;

      card.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const action = btn.dataset.action;
          const modelId = btn.dataset.model;
          if (action === "download") this.startModelDownload(modelId);
          else if (action === "delete") this.deleteModel(modelId);
        });
      });

      this.modelCardsContainer.appendChild(card);
    }
  }

  async startModelDownload(modelId) {
    if (this.currentDownloadingModelId) {
      alert("이미 다른 모델 다운로드가 진행 중입니다. 완료 후 다시 시도하세요.");
      return;
    }
    this.currentDownloadingModelId = modelId;
    this.renderModelCards(this.cachedModelList, this.state.settings?.model || "base");

    try {
      await window.lyricsPlayer.downloadModel(modelId);
      // 완료 후 목록 갱신
      await this.refreshModelList();
    } catch (err) {
      console.error("[ModelManager] Download failed:", err);
      alert(`모델 다운로드 실패: ${err.message || err}`);
    } finally {
      this.currentDownloadingModelId = null;
      await this.refreshModelList();
    }
  }

  handleDownloadProgress(msg) {
    if (!this.modelCardsContainer) return;
    const card = this.modelCardsContainer.querySelector(`[data-model-id="${msg.modelId}"]`);
    if (!card) return;

    const actionArea = card.querySelector(".model-card-actions");
    if (!actionArea) return;

    const pct = msg.percent != null ? Math.round(msg.percent * 100) : null;
    const label = pct != null ? `⏳ ${pct}%` : "⏳ 다운로드 중...";
    actionArea.innerHTML = `<button type="button" class="btn-model-action" disabled>${label}</button>`;

    if (msg.stage === "done") {
      this.currentDownloadingModelId = null;
      this.refreshModelList();
    }
  }

  async deleteModel(modelId) {
    const confirmed = confirm(`"${modelId}" 모델을 삭제하시겠습니까?\n모델 캐시 파일이 디스크에서 영구적으로 삭제됩니다.`);
    if (!confirmed) return;

    const result = await window.lyricsPlayer.deleteModel(modelId);
    if (result?.ok) {
      await this.refreshModelList();
    } else {
      alert(`모델 삭제 실패: ${result?.error || "알 수 없는 오류"}`);
    }
  }
  // ─────────────────────────────────────────────────────────────────────
}

window.SettingsView = SettingsView;
