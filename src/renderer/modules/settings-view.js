class SettingsView {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks; // { onSave }
    
    this.settingsButton = document.querySelector("#settingsButton");
    this.settingsDialog = document.querySelector("#settingsDialog");
    this.saveSettingsButton = document.querySelector("#saveSettingsButton");
    
    this.tabGeneralBtn = document.querySelector("#tabGeneralBtn");
    this.tabFloatingBtn = document.querySelector("#tabFloatingBtn");
    this.tabGeneralContent = document.querySelector("#tabGeneralContent");
    this.tabFloatingContent = document.querySelector("#tabFloatingContent");
    
    this.settingModel = document.querySelector("#settingModel");
    this.settingLanguage = document.querySelector("#settingLanguage");
    this.settingGeminiKey = document.querySelector("#settingGeminiKey");
    this.settingAutoAnalyzeMode = document.querySelector("#settingAutoAnalyzeMode");
    
    this.settingFloatingFontSize = document.querySelector("#settingFloatingFontSize");
    this.settingFloatingOpacity = document.querySelector("#settingFloatingOpacity");
    this.settingFloatingBgColor = document.querySelector("#settingFloatingBgColor");
    this.settingFloatingFontColor = document.querySelector("#settingFloatingFontColor");
    this.settingFloatingAlign = document.querySelector("#settingFloatingAlign");
    
    this.valFloatingFontSize = document.querySelector("#valFloatingFontSize");
    this.valFloatingOpacity = document.querySelector("#valFloatingOpacity");
    
    this.clearCacheButton = document.querySelector("#clearCacheButton");
    this.cachePathLabel = document.querySelector("#cachePathLabel");

    this._initEvents();
  }

  _initEvents() {
    this.settingsButton.addEventListener("click", () => this.open());
    
    this.tabGeneralBtn.addEventListener("click", () => {
      this.tabGeneralBtn.classList.add("active");
      this.tabFloatingBtn.classList.remove("active");
      this.tabGeneralContent.classList.add("active");
      this.tabFloatingContent.classList.remove("active");
    });
    
    this.tabFloatingBtn.addEventListener("click", () => {
      this.tabFloatingBtn.classList.add("active");
      this.tabGeneralBtn.classList.remove("active");
      this.tabFloatingContent.classList.add("active");
      this.tabGeneralContent.classList.remove("active");
    });

    this.settingFloatingFontSize.addEventListener("input", () => {
      this.valFloatingFontSize.textContent = this.settingFloatingFontSize.value;
    });
    
    this.settingFloatingOpacity.addEventListener("input", () => {
      this.valFloatingOpacity.textContent = this.settingFloatingOpacity.value;
    });

    this.settingGeminiKey.addEventListener("input", () => this.updateAutoAnalyzeDropdownState());
    
    this.saveSettingsButton.addEventListener("click", () => this.save());
    
    this.clearCacheButton.addEventListener("click", () => this.clearCache());
  }

  open() {
    this.tabGeneralBtn.click();
    this.updateAutoAnalyzeDropdownState();
    this.settingsDialog.showModal();
  }

  close() {
    this.settingsDialog.close();
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
    const next = {
      model: this.settingModel.value,
      language: this.settingLanguage.value || null,
      geminiApiKey: this.settingGeminiKey.value || "",
      autoAnalyzeMode: this.settingAutoAnalyzeMode.value,
      floatingFontSize: this.settingFloatingFontSize.value,
      floatingOpacity: this.settingFloatingOpacity.value,
      floatingBgColor: this.settingFloatingBgColor.value,
      floatingFontColor: this.settingFloatingFontColor.value,
      floatingAlign: this.settingFloatingAlign.value,
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
    this.settingModel.value = settings.model;
    this.settingLanguage.value = settings.language || "";
    this.settingGeminiKey.value = settings.geminiApiKey || "";
    this.settingAutoAnalyzeMode.value = settings.autoAnalyzeMode || "off";

    this.settingFloatingFontSize.value = settings.floatingFontSize || 18;
    this.valFloatingFontSize.textContent = this.settingFloatingFontSize.value;

    this.settingFloatingOpacity.value = settings.floatingOpacity !== undefined ? settings.floatingOpacity : 0.85;
    this.valFloatingOpacity.textContent = this.settingFloatingOpacity.value;

    this.settingFloatingBgColor.value = settings.floatingBgColor || "#0b0d11";
    this.settingFloatingFontColor.value = settings.floatingFontColor || "#ffffff";
    this.settingFloatingAlign.value = settings.floatingAlign || "center";

    this.cachePathLabel.textContent = dataPath;
  }
}

window.SettingsView = SettingsView;
