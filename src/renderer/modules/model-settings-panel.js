(function attachModelSettingsPanel(root) {
  function buildInstalledModelSelectOptions(models, currentVal) {
    const installed = Array.isArray(models) ? models.filter((m) => m.downloaded) : [];
    if (installed.length === 0) {
      return [
        {
          value: "",
          text: "설치된 모델 없음 — 아래에서 다운로드하세요",
          disabled: true,
          selected: true
        }
      ];
    }

    const hasMatch = installed.some((m) => m.id === currentVal);
    return installed.map((m, idx) => {
      const badge = m.badge ? ` (${m.badge})` : "";
      return {
        value: m.id,
        text: `${m.label} — ${m.sizeLabel}${badge}`,
        disabled: false,
        selected: hasMatch ? m.id === currentVal : idx === 0
      };
    });
  }

  function describeCudaStatusView(status) {
    if (!status) return null;

    if (status.installed) {
      const gpuInfo = status.gpuName ? `[${status.gpuName}] ` : "";
      const sizeText =
        status.diskSizeFormatted && status.diskSizeFormatted !== "0 MB"
          ? `(${status.diskSizeFormatted})`
          : "";
      const actionMode = status.isCustomInstalled
        ? "custom-installed"
        : (status.isSystemInstalled ? "system-installed" : "none");

      return {
        badgeClass: "installed",
        badgeText: "GPU 가속 준비 완료 (CUDA)",
        descText: `${gpuInfo}NVIDIA CUDA 가속 환경이 준비되어 고속 Whisper 전사를 지원합니다.`,
        sizeText,
        actionMode
      };
    }

    if (!status.hasNvidia) {
      return {
        badgeClass: "no-gpu",
        badgeText: "NVIDIA GPU 미감지",
        descText: "NVIDIA 외장 그래픽 카드가 감지되지 않았습니다. (외장 GPU가 있는 경우 수동 설치 가능)",
        sizeText: "",
        actionMode: "install"
      };
    }

    const gpuInfo = status.gpuName ? `[${status.gpuName} 감지됨] ` : "";
    return {
      badgeClass: "not-installed",
      badgeText: "미설치 (CPU 모드 동작)",
      descText: `${gpuInfo}GPU 가속 팩(CUDA DLL)을 설치하면 가사 추출 속도가 대폭 향상됩니다.`,
      sizeText: "",
      actionMode: "install"
    };
  }

  function describeVocalModelStatusView(status, isDownloading = false) {
    if (!status) return null;

    const installed = Boolean(status.installed);
    const optionDisabled = !installed;
    const optionLabel = installed ? "사용 (보컬 분리 후 분석)" : "사용 (모델 설치 필요)";
    const sizeText = status.diskSizeFormatted ? `(${status.diskSizeFormatted})` : "";

    if (isDownloading) {
      return {
        badgeClass: "not-installed",
        badgeText: "다운로드 중",
        sizeText,
        actionMode: "downloading",
        optionDisabled,
        optionLabel
      };
    }

    if (installed) {
      return {
        badgeClass: "installed",
        badgeText: "모델 설치됨",
        sizeText,
        actionMode: "installed",
        optionDisabled,
        optionLabel
      };
    }

    return {
      badgeClass: "not-installed",
      badgeText: "모델 미설치",
      sizeText,
      actionMode: "install",
      optionDisabled,
      optionLabel
    };
  }

  function applyProgressBarUpdate({ areaEl, fillEl, textEl }, msg) {
    const isTerminal = msg?.stage === "done" || msg?.stage === "cancelled";
    if (!areaEl) {
      return { isTerminal };
    }

    if (isTerminal) {
      areaEl.style.display = "none";
      return { isTerminal: true };
    }

    areaEl.style.display = "flex";
    if (msg?.percent != null && fillEl) {
      const pct = Math.round(msg.percent * 100);
      fillEl.style.width = `${pct}%`;
    }
    if (msg?.message && textEl) {
      textEl.textContent = msg.message;
    }
    return { isTerminal: false };
  }

  /**
   * 설정 모달 내 Whisper 모델 카드, NVIDIA CUDA 가속 팩, ONNX 보컬 분리 모델의
   * 상태 조회·렌더링·다운로드 진행률·삭제 UI를 전담합니다.
   */
  class ModelSettingsPanel {
    constructor({
      state,
      callbacks = {},
      doc = null,
      api = null,
      alertFn = null,
      confirmFn = null
    } = {}) {
      this.state = state;
      this.callbacks = callbacks;
      this.doc = doc || (typeof document !== "undefined" ? document : null);
      this.api = api || (typeof window !== "undefined" ? window.lyricsPlayer : null);
      this.alertFn = alertFn || (typeof alert === "function" ? alert : () => {});
      this.confirmFn = confirmFn || (typeof confirm === "function" ? confirm : () => false);

      this.settingModel = this._q("#settingModel");
      this.settingModelGroup = this._q("#settingModelGroup");
      this.settingWhisperDeviceGroup = this._q("#settingWhisperDeviceGroup");

      this.modelCardsContainer = this._q("#modelCardsContainer");
      this.modelManagerTotalSize = this._q("#modelManagerTotalSize");
      this.modelManagerAccordion = this._q("#modelManagerGroup");
      this.modelManagerToggle = this._q("#modelManagerToggle");
      this.modelManagerBody = this._q("#modelManagerBody");
      this.currentDownloadingModelId = null;
      this.cachedModelList = [];
      this._accordionOpen = false;

      // CUDA 가속 팩 관리 UI
      this.cudaPackManagerGroup = this._q("#cudaPackManagerGroup");
      this.cudaStatusDesc = this._q("#cudaStatusDesc");
      this.cudaStatusBadge = this._q("#cudaStatusBadge");
      this.cudaSizeLabel = this._q("#cudaSizeLabel");
      this.cudaActionsArea = this._q("#cudaActionsArea");
      this.cudaProgressBarArea = this._q("#cudaProgressBarArea");
      this.cudaProgressFill = this._q("#cudaProgressFill");
      this.cudaProgressText = this._q("#cudaProgressText");
      this.isCudaDownloading = false;

      // ONNX 보컬 분리 모델 관리 UI
      this.vocalIsolationGroup = this._q("#vocalIsolationGroup");
      this.settingVocalIsolation = this._q("#settingVocalIsolation");
      this.vocalModelStatusBadge = this._q("#vocalModelStatusBadge");
      this.vocalModelSizeLabel = this._q("#vocalModelSizeLabel");
      this.vocalModelProgressArea = this._q("#vocalModelProgressArea");
      this.vocalModelProgressFill = this._q("#vocalModelProgressFill");
      this.vocalModelProgressText = this._q("#vocalModelProgressText");
      this.vocalModelActionsArea = this._q("#vocalModelActionsArea");
      this.isVocalModelDownloading = false;

      this._initEvents();
    }

    _q(selector) {
      return this.doc?.querySelector ? this.doc.querySelector(selector) : null;
    }

    _toggleElement(element, show) {
      if (element) {
        element.style.display = show ? "" : "none";
      }
    }

    _createActionButton({ className, text, disabled = false, onClick }) {
      const btn = this.doc.createElement("button");
      btn.type = "button";
      btn.className = className;
      btn.textContent = text;
      btn.disabled = Boolean(disabled);
      btn.addEventListener("click", onClick);
      return btn;
    }

    _initEvents() {
      if (this.modelManagerToggle) {
        this.modelManagerToggle.addEventListener("click", () => this.toggleAccordion());
      }

      if (this.api?.onModelDownloadProgress) {
        this.api.onModelDownloadProgress((msg) => this.handleDownloadProgress(msg));
      }
      if (this.api?.onCudaDownloadProgress) {
        this.api.onCudaDownloadProgress((msg) => this.handleCudaProgress(msg));
      }
      if (this.api?.onVocalModelDownloadProgress) {
        this.api.onVocalModelDownloadProgress((msg) => this.handleVocalModelProgress(msg));
      }
    }

    setWhisperSectionsVisible(show) {
      this._toggleElement(this.settingModelGroup, show);
      this._toggleElement(this.modelManagerAccordion, show);
      this._toggleElement(this.settingWhisperDeviceGroup, show);
      this._toggleElement(this.cudaPackManagerGroup, show);
      this._toggleElement(this.vocalIsolationGroup, show);
    }

    refreshAll() {
      this.refreshModelList();
      this.refreshCudaStatus();
      this.refreshVocalModelStatus();
    }

    refreshOnOpen() {
      this.toggleAccordion(false);
      this.refreshCudaStatus();
      this.refreshVocalModelStatus();
    }

    toggleAccordion(forceState) {
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
      if (!this.modelCardsContainer || !this.api?.listModels) return;
      try {
        const result = await this.api.listModels();
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

    _rebuildModelSelect(models) {
      if (!this.settingModel || !this.doc) return;

      const options = buildInstalledModelSelectOptions(models, this.settingModel.value);
      this.settingModel.innerHTML = "";

      for (const spec of options) {
        const opt = this.doc.createElement("option");
        opt.value = spec.value;
        opt.textContent = spec.text;
        opt.disabled = spec.disabled;
        opt.selected = spec.selected;
        this.settingModel.appendChild(opt);
      }
    }

    renderModelCards(models, currentModel) {
      if (!this.modelCardsContainer || !this.doc) return;
      this.modelCardsContainer.innerHTML = "";

      for (const m of models) {
        const isActive = m.id === currentModel;
        const isDownloading = this.currentDownloadingModelId === m.id;

        const card = this.doc.createElement("div");
        card.className = "model-card" + (isActive ? " current-active" : "");
        card.dataset.modelId = m.id;

        let badgeHtml = "";
        if (m.badge === "최신 추천") badgeHtml = `<span class="model-badge badge-recommend">최신 추천</span>`;
        else if (m.badge === "기본값") badgeHtml = `<span class="model-badge badge-default">기본</span>`;

        const statusHtml = m.downloaded
          ? `<span class="model-status-installed">설치됨 (${m.diskSizeFormatted})</span>`
          : `<span class="model-status-not-installed">미설치 (${m.sizeLabel})</span>`;

        let actionsHtml = "";
        if (isDownloading) {
          actionsHtml = `<button type="button" class="btn-model-action" disabled>다운로드 중...</button>`;
        } else if (m.downloaded) {
          actionsHtml = `
            <button type="button" class="btn-model-action btn-delete" data-action="delete" data-model="${m.id}"${isActive ? " title=\"현재 선택된 모델입니다\"" : ""}>삭제</button>
          `;
        } else {
          actionsHtml = `<button type="button" class="btn-model-action btn-download" data-action="download" data-model="${m.id}">다운로드</button>`;
        }

        card.innerHTML = `
          <div class="model-card-info">
            <div class="model-card-name-row">
              <span class="model-card-name">${m.label}</span>
              ${badgeHtml}
              ${isActive ? `<span class="model-badge badge-primary">사용 중</span>` : ""}
            </div>
            <div class="model-card-desc">${m.description}</div>
            <div class="model-card-meta">${statusHtml}</div>
          </div>
          <div class="model-card-actions">${actionsHtml}</div>
        `;

        card.querySelectorAll("[data-action]").forEach((btn) => {
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
        this.alertFn("이미 다른 모델 다운로드가 진행 중입니다. 완료 후 다시 시도하세요.");
        return;
      }
      this.currentDownloadingModelId = modelId;
      this.renderModelCards(this.cachedModelList, this.state.settings?.model || "base");

      try {
        await this.api?.downloadModel?.(modelId);
        await this.refreshModelList();
      } catch (err) {
        console.error("[ModelManager] Download failed:", err);
        this.alertFn(`모델 다운로드 실패: ${err.message || err}`);
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
      const label = pct != null ? `${pct}%` : "다운로드 중...";
      actionArea.innerHTML = `<button type="button" class="btn-model-action" disabled>${label}</button>`;

      if (msg.stage === "done") {
        this.currentDownloadingModelId = null;
        this.refreshModelList();
      }
    }

    async deleteModel(modelId) {
      const confirmed = this.confirmFn(`"${modelId}" 모델을 삭제하시겠습니까?\n모델 캐시 파일이 디스크에서 영구적으로 삭제됩니다.`);
      if (!confirmed) return;

      const result = await this.api?.deleteModel?.(modelId);
      if (result?.ok) {
        await this.refreshModelList();
      } else {
        this.alertFn(`모델 삭제 실패: ${result?.error || "알 수 없는 오류"}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // NVIDIA GPU 가속 팩 (CUDA) 관리 기능
    // ─────────────────────────────────────────────────────────────────────
    async refreshCudaStatus() {
      if (!this.api?.checkCudaStatus || !this.cudaStatusBadge) return;
      try {
        const status = await this.api.checkCudaStatus();
        this.renderCudaStatus(status);
      } catch (err) {
        console.error("[SettingsView] Failed to check CUDA status:", err);
      }
    }

    renderCudaStatus(status) {
      if (!this.cudaStatusBadge || !this.cudaActionsArea || !this.doc) return;
      const view = describeCudaStatusView(status);
      if (!view) return;

      this.cudaStatusBadge.className = `cuda-status-badge ${view.badgeClass}`;
      this.cudaStatusBadge.textContent = view.badgeText;
      if (this.cudaStatusDesc) this.cudaStatusDesc.textContent = view.descText;
      if (this.cudaSizeLabel) this.cudaSizeLabel.textContent = view.sizeText;
      this.cudaActionsArea.innerHTML = "";

      if (view.actionMode === "custom-installed") {
        this.cudaActionsArea.appendChild(
          this._createActionButton({
            className: "btn-cuda-action btn-reinstall",
            text: "재설치",
            disabled: this.isCudaDownloading,
            onClick: () => this.reinstallCudaPack()
          })
        );
        this.cudaActionsArea.appendChild(
          this._createActionButton({
            className: "btn-cuda-action btn-delete",
            text: "삭제",
            disabled: this.isCudaDownloading,
            onClick: () => this.deleteCudaPack()
          })
        );
      } else if (view.actionMode === "system-installed") {
        const sysLabel = this.doc.createElement("span");
        sysLabel.className = "cuda-size-label";
        sysLabel.textContent = "(시스템 CUDA Toolkit 연동됨)";
        this.cudaActionsArea.appendChild(sysLabel);
      } else if (view.actionMode === "install") {
        this.cudaActionsArea.appendChild(
          this._createActionButton({
            className: "btn-cuda-action btn-download",
            text: "GPU 가속 팩 설치",
            disabled: this.isCudaDownloading,
            onClick: () => this.installCudaPack()
          })
        );
      }
    }

    async installCudaPack() {
      if (this.isCudaDownloading) return;
      this.isCudaDownloading = true;
      applyProgressBarUpdate(
        { areaEl: this.cudaProgressBarArea, fillEl: this.cudaProgressFill, textEl: this.cudaProgressText },
        { stage: "starting", percent: 0, message: "GPU 가속 팩 다운로드 준비 중..." }
      );
      await this.refreshCudaStatus();

      try {
        const res = await this.api?.downloadCudaPack?.();
        if (res?.ok) {
          this.alertFn("NVIDIA GPU 가속 팩(CUDA) 설치가 완료되었습니다!\n이제 Whisper 가속 장치에서 GPU(CUDA)를 사용할 수 있습니다.");
        }
      } catch (err) {
        console.error("[SettingsView] CUDA pack install failed:", err);
        this.alertFn(`GPU 가속 팩 설치 실패: ${err.message || err}`);
      } finally {
        this.isCudaDownloading = false;
        applyProgressBarUpdate(
          { areaEl: this.cudaProgressBarArea, fillEl: this.cudaProgressFill, textEl: this.cudaProgressText },
          { stage: "done" }
        );
        await this.refreshCudaStatus();
      }
    }

    handleCudaProgress(msg) {
      const { isTerminal } = applyProgressBarUpdate(
        { areaEl: this.cudaProgressBarArea, fillEl: this.cudaProgressFill, textEl: this.cudaProgressText },
        msg
      );
      if (isTerminal) {
        this.isCudaDownloading = false;
        this.refreshCudaStatus();
      }
    }

    async deleteCudaPack() {
      const ok = this.confirmFn("GPU 가속 팩을 디스크에서 삭제하시겠습니까?\n삭제 후에는 기본 CPU 모드로 동작하게 됩니다.");
      if (!ok) return;

      try {
        const res = await this.api?.deleteCudaPack?.();
        if (res?.ok) {
          this.alertFn("GPU 가속 팩이 성공적으로 삭제되었습니다.");
        } else {
          this.alertFn(`삭제 실패: ${res?.error || "알 수 없는 오류"}`);
        }
      } catch (err) {
        this.alertFn(`삭제 처리 중 오류 발생: ${err.message}`);
      } finally {
        await this.refreshCudaStatus();
      }
    }

    async reinstallCudaPack() {
      const ok = this.confirmFn("현재 설치된 GPU 가속 팩을 제거하고 새로 재설치하시겠습니까?");
      if (!ok) return;

      try {
        await this.api?.deleteCudaPack?.();
        await this.installCudaPack();
      } catch (err) {
        this.alertFn(`재설치 중 오류 발생: ${err.message}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 경량 ONNX 보컬 분리 모델 관리 기능
    // ─────────────────────────────────────────────────────────────────────
    async refreshVocalModelStatus() {
      if (!this.api?.getVocalModelStatus || !this.vocalModelStatusBadge) return;
      try {
        const status = await this.api.getVocalModelStatus();
        this.renderVocalModelStatus(status);
      } catch (err) {
        console.error("[SettingsView] Failed to check vocal model status:", err);
      }
    }

    renderVocalModelStatus(status) {
      if (!this.vocalModelStatusBadge || !this.vocalModelActionsArea || !status || !this.doc) return;
      const view = describeVocalModelStatusView(status, this.isVocalModelDownloading);
      if (!view) return;

      if (this.settingVocalIsolation) {
        const onOption = this.settingVocalIsolation.querySelector('option[value="on"]');
        if (onOption) {
          onOption.disabled = view.optionDisabled;
          onOption.textContent = view.optionLabel;
        }
        if (!status.installed && this.settingVocalIsolation.value === "on") {
          this.settingVocalIsolation.value = "off";
        }
      }

      if (this.callbacks?.onVocalModelStatusChange) {
        this.callbacks.onVocalModelStatusChange(status);
      }

      this.vocalModelStatusBadge.className = `cuda-status-badge ${view.badgeClass}`;
      this.vocalModelStatusBadge.textContent = view.badgeText;
      this.vocalModelActionsArea.innerHTML = "";
      if (this.vocalModelSizeLabel) {
        this.vocalModelSizeLabel.textContent = view.sizeText;
      }

      if (view.actionMode === "downloading") {
        this.vocalModelActionsArea.appendChild(
          this._createActionButton({
            className: "btn-cuda-action btn-delete",
            text: "다운로드 취소",
            onClick: () => this.cancelVocalModelDownload()
          })
        );
      } else if (view.actionMode === "installed") {
        this.vocalModelActionsArea.appendChild(
          this._createActionButton({
            className: "btn-cuda-action btn-delete",
            text: "모델 삭제",
            onClick: () => this.deleteVocalModel()
          })
        );
      } else {
        this.vocalModelActionsArea.appendChild(
          this._createActionButton({
            className: "btn-cuda-action btn-download",
            text: "보컬 분리 모델 설치",
            onClick: () => this.installVocalModel()
          })
        );
      }
    }

    async cancelVocalModelDownload() {
      if (!this.api?.cancelVocalModelDownload) return;
      try {
        await this.api.cancelVocalModelDownload();
      } catch (err) {
        console.error("[SettingsView] Failed to cancel vocal model download:", err);
      }
    }

    async installVocalModel() {
      if (this.isVocalModelDownloading) return;
      this.isVocalModelDownloading = true;
      applyProgressBarUpdate(
        { areaEl: this.vocalModelProgressArea, fillEl: this.vocalModelProgressFill, textEl: this.vocalModelProgressText },
        { stage: "starting", percent: 0, message: "보컬 분리 모델 다운로드 준비 중..." }
      );
      await this.refreshVocalModelStatus();

      try {
        const res = await this.api?.downloadVocalModel?.();
        if (res?.ok) {
          await this.refreshVocalModelStatus();
        }
      } catch (err) {
        console.error("[SettingsView] Vocal model download failed:", err);
        this.alertFn(`보컬 분리 모델 다운로드 실패: ${err.message || err}`);
      } finally {
        this.isVocalModelDownloading = false;
        applyProgressBarUpdate(
          { areaEl: this.vocalModelProgressArea, fillEl: this.vocalModelProgressFill, textEl: this.vocalModelProgressText },
          { stage: "done" }
        );
        await this.refreshVocalModelStatus();
      }
    }

    handleVocalModelProgress(msg) {
      const { isTerminal } = applyProgressBarUpdate(
        { areaEl: this.vocalModelProgressArea, fillEl: this.vocalModelProgressFill, textEl: this.vocalModelProgressText },
        msg
      );
      if (isTerminal) {
        this.isVocalModelDownloading = false;
        this.refreshVocalModelStatus();
      }
    }

    async deleteVocalModel() {
      const ok = this.confirmFn("보컬 분리 ONNX 모델을 디스크에서 삭제하시겠습니까?\n삭제 시 보컬 분리 옵션은 자동으로 꺼집니다.");
      if (!ok) return;

      try {
        const res = await this.api?.deleteVocalModel?.();
        if (!res?.ok) {
          this.alertFn(`삭제 실패: ${res?.error || "알 수 없는 오류"}`);
        }
      } catch (err) {
        this.alertFn(`삭제 처리 중 오류 발생: ${err.message}`);
      } finally {
        await this.refreshVocalModelStatus();
      }
    }
  }

  const exportsObj = {
    ModelSettingsPanel,
    buildInstalledModelSelectOptions,
    describeCudaStatusView,
    describeVocalModelStatusView,
    applyProgressBarUpdate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exportsObj;
  }

  if (root) {
    root.ModelSettingsPanel = ModelSettingsPanel;
    root.modelSettingsHelpers = {
      buildInstalledModelSelectOptions,
      describeCudaStatusView,
      describeVocalModelStatusView,
      applyProgressBarUpdate
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
