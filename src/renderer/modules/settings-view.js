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
    this.settingLanguage = document.querySelector("#settingLanguage");
    this.settingGeminiKey = document.querySelector("#settingGeminiKey");
    this.settingAutoAnalyzeMode = document.querySelector("#settingAutoAnalyzeMode");
    this.settingModelGroup = document.querySelector("#settingModelGroup");
    
    this.settingFloatingFontSize = document.querySelector("#settingFloatingFontSize");
    this.settingFloatingOpacity = document.querySelector("#settingFloatingOpacity");
    this.settingFloatingBgColor = document.querySelector("#settingFloatingBgColor");
    this.settingFloatingFontColor = document.querySelector("#settingFloatingFontColor");
    this.settingFloatingAlign = document.querySelector("#settingFloatingAlign");
    
    this.valFloatingFontSize = document.querySelector("#valFloatingFontSize");
    this.valFloatingOpacity = document.querySelector("#valFloatingOpacity");
    
    this.clearCacheButton = document.querySelector("#clearCacheButton");
    this.cachePathLabel = document.querySelector("#cachePathLabel");

    this.tempShortcuts = {};
    this.capturingAction = null;
    this.shortcutBtns = document.querySelectorAll(".shortcut-capture-btn");

    this._initEvents();
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

    this.settingGeminiKey.addEventListener("input", () => this.updateAutoAnalyzeDropdownState());
    this.settingEngine.addEventListener("change", () => this.updateSTTEngineUI());
    
    this.saveSettingsButton.addEventListener("click", () => this.save());
    
    this.clearCacheButton.addEventListener("click", () => this.clearCache());

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
    this.capturingAction = null;
    this.settingsDialog.showModal();
  }

  close() {
    this.settingsDialog.close();
  }

  updateSTTEngineUI() {
    const engine = this.settingEngine.value;
    if (engine === "gemini") {
      this.settingModelGroup.style.display = "none";
    } else {
      this.settingModelGroup.style.display = "";
    }
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
  }
}

window.SettingsView = SettingsView;
