class SettingsView {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks; // { onSave }
    
    this.settingsButton = document.querySelector("#settingsButton");
    this.settingsDialog = document.querySelector("#settingsDialog");
    this.closeSettingsBtn = document.querySelector("#closeSettingsBtn");
    this.saveSettingsButton = document.querySelector("#saveSettingsButton");
    
    this.tabAppBtn = document.querySelector("#tabAppBtn");
    this.tabGeneralBtn = document.querySelector("#tabGeneralBtn");
    this.tabFloatingBtn = document.querySelector("#tabFloatingBtn");
    this.tabShortcutsBtn = document.querySelector("#tabShortcutsBtn");
    this.tabAppContent = document.querySelector("#tabAppContent");
    this.tabGeneralContent = document.querySelector("#tabGeneralContent");
    this.tabFloatingContent = document.querySelector("#tabFloatingContent");
    this.tabShortcutsContent = document.querySelector("#tabShortcutsContent");
    this.whisperSettingsCard = document.querySelector("#whisperSettingsCard");
    
    this.settingTheme = document.querySelector("#settingTheme");
    this.settingLyricsFont = document.querySelector("#settingLyricsFont");
    this.customLyricsFontGroup = document.querySelector("#customLyricsFontGroup");
    this.settingLyricsFontCustom = document.querySelector("#settingLyricsFontCustom");
    this.settingFloatingFont = document.querySelector("#settingFloatingFont");
    this.customFloatingFontGroup = document.querySelector("#customFloatingFontGroup");
    this.settingFloatingFontCustom = document.querySelector("#settingFloatingFontCustom");
    this.settingEngine = document.querySelector("#settingEngine");
    this.settingModel = document.querySelector("#settingModel");
    this.settingWhisperDevice = document.querySelector("#settingWhisperDevice");
    this.settingGeminiModel = document.querySelector("#settingGeminiModel");
    this.settingLanguage = document.querySelector("#settingLanguage");
    this.settingGeminiKey = document.querySelector("#settingGeminiKey");
    this.settingAutoAnalyzeMode = document.querySelector("#settingAutoAnalyzeMode");
    this.autoAnalyzeDesc = document.querySelector("#autoAnalyzeDesc");
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
    this.settingVocalIsolation = document.querySelector("#settingVocalIsolation");

    this.tempShortcuts = {};
    this.capturingAction = null;
    this.shortcutBtns = document.querySelectorAll(".shortcut-capture-btn");

    this.modelPanel = new window.ModelSettingsPanel({ state, callbacks });

    this._initEvents();
  }

  _initEvents() {
    this.settingsButton.addEventListener("click", () => this.open());

    if (this.closeSettingsBtn) {
      this.closeSettingsBtn.addEventListener("click", () => this.close());
    }

    if (this.settingsDialog) {
      this.settingsDialog.addEventListener("click", (e) => {
        if (e.target === this.settingsDialog) {
          this.close();
        }
      });
      this.settingsDialog.addEventListener("close", () => {
        const savedTheme = this.state.settings?.theme || "lyra";
        document.documentElement.dataset.theme = savedTheme;
        if (this.settingTheme) {
          this.settingTheme.value = savedTheme;
        }
        const savedFontPreset = this.state.settings?.lyricsFontPreset || "default";
        const savedFontCustom = this.state.settings?.lyricsFontCustom || "";
        if (this.settingLyricsFont) {
          this.settingLyricsFont.value = savedFontPreset;
        }
        if (this.settingLyricsFontCustom) {
          this.settingLyricsFontCustom.value = savedFontCustom;
        }
        this._syncLyricsFontUI(savedFontPreset, savedFontCustom);
        const savedFloatingFontPreset = this.state.settings?.floatingFontPreset || "default";
        const savedFloatingFontCustom = this.state.settings?.floatingFontCustom || "";
        if (this.settingFloatingFont) {
          this.settingFloatingFont.value = savedFloatingFontPreset;
        }
        if (this.settingFloatingFontCustom) {
          this.settingFloatingFontCustom.value = savedFloatingFontCustom;
        }
        this._syncFloatingFontUI(savedFloatingFontPreset);
      });
    }

    if (this.tabAppBtn) {
      this.tabAppBtn.addEventListener("click", () => this.switchTab("app"));
    }
    this.tabGeneralBtn.addEventListener("click", () => this.switchTab("general"));
    this.tabFloatingBtn.addEventListener("click", () => this.switchTab("floating"));
    this.tabShortcutsBtn.addEventListener("click", () => this.switchTab("shortcuts"));

    this.settingFloatingFontSize.addEventListener("input", () => {
      this.valFloatingFontSize.textContent = this.settingFloatingFontSize.value;
    });
    
    this.settingFloatingOpacity.addEventListener("input", () => {
      this.valFloatingOpacity.textContent = this.settingFloatingOpacity.value;
    });

    if (this.settingTheme) {
      this.settingTheme.addEventListener("change", () => {
        document.documentElement.dataset.theme = this.settingTheme.value;
      });
    }

    if (this.settingLyricsFont) {
      this.settingLyricsFont.addEventListener("change", () => {
        this._syncLyricsFontUI(
          this.settingLyricsFont.value,
          this.settingLyricsFontCustom?.value || ""
        );
      });
    }

    if (this.settingLyricsFontCustom) {
      this.settingLyricsFontCustom.addEventListener("input", () => {
        this._syncLyricsFontUI(
          this.settingLyricsFont?.value || "custom",
          this.settingLyricsFontCustom.value
        );
      });
    }

    if (this.settingFloatingFont) {
      this.settingFloatingFont.addEventListener("change", () => {
        this._syncFloatingFontUI(this.settingFloatingFont.value);
      });
    }

    this.settingGeminiKey.addEventListener("input", () => {
      this.updateAutoAnalyzeDropdownState();
      this.updateSTTEngineUI();
    });
    this.settingAutoAnalyzeMode.addEventListener("change", () => this.updateSTTEngineUI());
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
        btn.textContent = "키 입력 대기 중...";
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

  switchTab(activeTab) {
    const tabs = [
      { key: "app", btn: this.tabAppBtn, content: this.tabAppContent },
      { key: "general", btn: this.tabGeneralBtn, content: this.tabGeneralContent },
      { key: "floating", btn: this.tabFloatingBtn, content: this.tabFloatingContent },
      { key: "shortcuts", btn: this.tabShortcutsBtn, content: this.tabShortcutsContent },
    ];
    tabs.forEach(({ key, btn, content }) => {
      const isActive = key === activeTab;
      if (btn) {
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-selected", String(isActive));
      }
      if (content) {
        content.classList.toggle("active", isActive);
      }
    });
  }

  open() {
    this.switchTab("app");
    this.updateSTTEngineUI();
    this.modelPanel.refreshOnOpen();
    this.capturingAction = null;
    this.settingsDialog.showModal();
  }

  close() {
    this.settingsDialog.close();
  }

  _syncLyricsFontUI(preset = "default", customFont = "") {
    this.toggleVisibility(this.customLyricsFontGroup, preset === "custom");
    if (window.lyricsCore?.resolveLyricsFontFamily) {
      const fontFamily = window.lyricsCore.resolveLyricsFontFamily(preset, customFont);
      document.documentElement.style.setProperty("--lyrics-font-family", fontFamily);
    }
  }

  _syncFloatingFontUI(preset = "default") {
    this.toggleVisibility(this.customFloatingFontGroup, preset === "custom");
  }

  toggleVisibility(element, show) {
    if (element) {
      element.style.display = show ? "" : "none";
    }
  }

  updateSTTEngineUI() {
    const isGemini = this.settingEngine.value === "gemini";

    this.toggleVisibility(this.whisperSettingsCard, !isGemini);
    this.modelPanel.setWhisperSectionsVisible(!isGemini);
    this.toggleVisibility(this.settingGeminiModelGroup, true);
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
    if (this.autoAnalyzeDesc) {
      this.autoAnalyzeDesc.textContent = hasApiKey
        ? "가사(또는 싱크)가 없는 곡으로 전환하면 자동으로 AI 가사 분석을 시작합니다."
        : "가사(또는 싱크)가 없는 곡으로 전환하면 자동 분석을 시작합니다. 아래에서 Gemini API Key를 입력하면 'AI 정합'까지 자동화할 수 있습니다.";
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
      theme: this.settingTheme?.value || "lyra",
      lyricsFontPreset: this.settingLyricsFont?.value || "default",
      lyricsFontCustom: this.settingLyricsFontCustom?.value?.trim() || "",
      floatingFontPreset: this.settingFloatingFont?.value || "default",
      floatingFontCustom: this.settingFloatingFontCustom?.value?.trim() || "",
      sttEngine: this.settingEngine.value,
      model: this.settingModel.value,
      whisperDevice: this.settingWhisperDevice.value,
      vocalIsolation: this.settingVocalIsolation ? this.settingVocalIsolation.value === "on" : false,
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
    if (saved.theme) {
      document.documentElement.dataset.theme = saved.theme;
      localStorage.setItem("theme", saved.theme);
    }
    this.close();
    this.callbacks.onSave(saved);
  }

  async clearCache() {
    const result = await window.lyricsPlayer.clearCache();
    if (result?.ok) {
      this.clearCacheButton.textContent = `정리 완료 (${result.cleared}개)`;
      setTimeout(() => { this.clearCacheButton.textContent = "캐시 비우기"; }, 2500);
    }
  }

  bindConfigValues(settings, dataPath) {
    const theme = settings.theme || "lyra";
    if (this.settingTheme) {
      this.settingTheme.value = theme;
    }
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);

    const lyricsFontPreset = settings.lyricsFontPreset || "default";
    const lyricsFontCustom = settings.lyricsFontCustom || "";
    if (this.settingLyricsFont) {
      this.settingLyricsFont.value = lyricsFontPreset;
    }
    if (this.settingLyricsFontCustom) {
      this.settingLyricsFontCustom.value = lyricsFontCustom;
    }
    this._syncLyricsFontUI(lyricsFontPreset, lyricsFontCustom);

    const floatingFontPreset = settings.floatingFontPreset || "default";
    const floatingFontCustom = settings.floatingFontCustom || "";
    if (this.settingFloatingFont) {
      this.settingFloatingFont.value = floatingFontPreset;
    }
    if (this.settingFloatingFontCustom) {
      this.settingFloatingFontCustom.value = floatingFontCustom;
    }
    this._syncFloatingFontUI(floatingFontPreset);

    this.settingEngine.value = settings.sttEngine || "whisper";
    this.settingModel.value = settings.model;
    this.settingWhisperDevice.value = settings.whisperDevice || "auto";
    if (this.settingVocalIsolation) {
      this.settingVocalIsolation.value = settings.vocalIsolation ? "on" : "off";
    }
    this.settingGeminiModel.value = settings.geminiModel || "gemini-3.5-flash-lite";
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

    // 모델 목록 및 CUDA / 보컬 분리 모델 상태 비동기 갱신
    this.modelPanel.refreshAll();
  }

  refreshModelList() {
    return this.modelPanel.refreshModelList();
  }

  refreshCudaStatus() {
    return this.modelPanel.refreshCudaStatus();
  }

  refreshVocalModelStatus() {
    return this.modelPanel.refreshVocalModelStatus();
  }
}

window.SettingsView = SettingsView;
