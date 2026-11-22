class LyricsViewer {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks; // { onSeek, onOffsetChange, onLyricTextChange, onToggleEditView, onGetCurrentTime }
    this.lyricsList = document.querySelector("#lyricsList");
    this.syncOffsetBadge = document.querySelector("#syncOffsetBadge");
    this.editModeButton = document.querySelector("#editModeButton");
    this.resumeScrollBtn = document.querySelector("#resumeScrollBtn");

    // 전용 가사 편집 화면 요소들
    this.editLyricsList = document.querySelector("#editLyricsList");
    this.editLineCount = document.querySelector("#editLineCount");
    this.editLineTextInput = document.querySelector("#editLineTextInput");
    this.editLineTimeInput = document.querySelector("#editLineTimeInput");
    this.editSyncCurrentBtn = document.querySelector("#editSyncCurrentBtn");
    this.editLineDec5 = document.querySelector("#editLineDec5");
    this.editLineDec1 = document.querySelector("#editLineDec1");
    this.editLineInc1 = document.querySelector("#editLineInc1");
    this.editLineInc5 = document.querySelector("#editLineInc5");
    this.selectedEditLineId = null;

    this.isUserScrolling = false;
    this.scrollTimeout = null;

    this._initEvents();
  }

  _initEvents() {
    if (this.editModeButton) {
      this.editModeButton.addEventListener("click", () => this.toggleEditMode());
    }

    if (this.resumeScrollBtn) {
      this.resumeScrollBtn.addEventListener("click", () => this.resumeAutoScroll());
    }

    // 수동 스크롤 감지 (마우스 휠, 터치)
    this.lyricsList.addEventListener("wheel", () => this.handleUserScroll(), { passive: true });
    this.lyricsList.addEventListener("touchmove", () => this.handleUserScroll(), { passive: true });

    // 감상 뷰 가사 줄 클릭 시 해당 시점으로 이동
    this.lyricsList.addEventListener("click", (event) => {
      const seekButton = event.target.closest(".lyric-seek");
      if (!seekButton) return;

      const start = Number(seekButton.dataset.start);
      this.callbacks.onSeek(Math.max(start - this.state.syncOffset, 0));
    });

    // --- 가사 편집 뷰 전용 이벤트 바인딩 ---
    if (this.editLyricsList) {
      this.editLyricsList.addEventListener("click", (event) => {
        const item = event.target.closest(".edit-line-item");
        if (!item) return;
        const lineId = item.dataset.lineId;
        this.selectEditLine(lineId, true);
      });
    }

    if (this.editLineTextInput) {
      this.editLineTextInput.addEventListener("input", () => {
        const line = this.getSelectedEditLine();
        if (!line) return;
        line.text = this.editLineTextInput.value;
        const row = this.editLyricsList?.querySelector(`.edit-line-item[data-line-id="${line.id}"]`);
        if (row) {
          const textEl = row.querySelector(".edit-line-text");
          if (textEl) textEl.textContent = line.text;
        }
        this.callbacks.onLyricTextChange();
      });
    }

    if (this.editLineTimeInput) {
      const applyTimeInput = () => {
        const line = this.getSelectedEditLine();
        if (!line) return;
        const nextVal = window.lyricsCore.parseTimeString(this.editLineTimeInput.value);
        if (!isNaN(nextVal)) {
          line.start = window.lyricsCore.adjustTimestamp(nextVal, 0);
        }
        this.updateSelectedLineUI(line);
        this.callbacks.onLyricTextChange();
      };

      this.editLineTimeInput.addEventListener("change", applyTimeInput);
      this.editLineTimeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          applyTimeInput();
          this.editLineTimeInput.blur();
        }
      });
    }

    if (this.editSyncCurrentBtn) {
      this.editSyncCurrentBtn.addEventListener("click", () => this.syncSelectedLineWithAudio());
    }

    if (this.editLineDec5) this.editLineDec5.addEventListener("click", () => this.adjustSelectedLine(-0.5));
    if (this.editLineDec1) this.editLineDec1.addEventListener("click", () => this.adjustSelectedLine(-0.1));
    if (this.editLineInc1) this.editLineInc1.addEventListener("click", () => this.adjustSelectedLine(0.1));
    if (this.editLineInc5) this.editLineInc5.addEventListener("click", () => this.adjustSelectedLine(0.5));
  }

    // 편집 모드에서의 시간 조절 클릭 이벤트 핸들러
    this.lyricsList.addEventListener("click", (event) => {
      if (!this.state.editMode) return;

      const updateRowTimestampUI = (lineRow, line) => {
        if (!lineRow || !line) return;
        const timeStr = window.lyricsCore.formatClock(line.start, true);
        const timestampEl = lineRow.querySelector(".lyric-timestamp");
        const timestampTextEl = lineRow.querySelector(".lyric-timestamp-text");
        const seekBtnEl = lineRow.querySelector(".lyric-seek");
        if (timestampEl) timestampEl.textContent = timeStr;
        if (timestampTextEl) timestampTextEl.textContent = timeStr;
        if (seekBtnEl) seekBtnEl.dataset.start = line.start;
      };

      const adjustLineTime = (btnEl, delta) => {
        const lineId = btnEl.dataset.lineId;
        const line = this.state.lyrics.find((l) => l.id === lineId);
        if (line) {
          line.start = window.lyricsCore.adjustTimestamp(line.start, delta);
          updateRowTimestampUI(btnEl.closest(".lyric-line"), line);
          this.callbacks.onLyricTextChange();
        }
      };

      // (1) 현재 재생 시간 동기화 (Sync 🎯)
      const syncBtn = event.target.closest(".lyric-sync-btn");
      if (syncBtn) {
        const lineId = syncBtn.dataset.lineId;
        const line = this.state.lyrics.find((l) => l.id === lineId);
        if (line && this.callbacks.onGetCurrentTime) {
          const currentAudioTime = this.callbacks.onGetCurrentTime();
          if (Number.isFinite(currentAudioTime)) {
            line.start = window.lyricsCore.adjustTimestamp(currentAudioTime - this.state.syncOffset, 0);
            updateRowTimestampUI(syncBtn.closest(".lyric-line"), line);
            this.callbacks.onLyricTextChange();
          }
        }
        return;
      }

      // (2) 시간 증감 버튼 («, -, +, ») 단일화 (DRY)
      const dec5Btn = event.target.closest(".lyric-time-adjust-btn.dec5");
      if (dec5Btn) return adjustLineTime(dec5Btn, -0.5);

      const decBtn = event.target.closest(".lyric-time-adjust-btn.dec");
      if (decBtn) return adjustLineTime(decBtn, -0.1);

      const incBtn = event.target.closest(".lyric-time-adjust-btn.inc");
      if (incBtn) return adjustLineTime(incBtn, 0.1);

      const inc5Btn = event.target.closest(".lyric-time-adjust-btn.inc5");
      if (inc5Btn) return adjustLineTime(inc5Btn, 0.5);
    });

    // 시간 텍스트 더블클릭 시 타이핑 가능한 입력창으로 전환
    this.lyricsList.addEventListener("dblclick", (event) => {
      if (!this.state.editMode) return;

      const timeSpan = event.target.closest(".lyric-timestamp-text");
      if (!timeSpan) return;

      const lineId = timeSpan.dataset.lineId;
      const line = this.state.lyrics.find((l) => l.id === lineId);
      if (!line) return;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "lyric-timestamp-input";
      input.value = window.lyricsCore.formatClock(line.start, true);

      const lineRow = timeSpan.closest(".lyric-line");
      timeSpan.replaceWith(input);
      input.focus();
      input.select();

      const finishEdit = () => {
        const nextVal = window.lyricsCore.parseTimeString(input.value);
        if (!isNaN(nextVal)) {
          line.start = window.lyricsCore.adjustTimestamp(nextVal, 0);
        }

        const timeStr = window.lyricsCore.formatClock(line.start, true);
        const newSpan = document.createElement("span");
        newSpan.className = "lyric-timestamp-text";
        newSpan.dataset.lineId = line.id;
        newSpan.title = "더블 클릭하여 직접 시간 입력";
        newSpan.textContent = timeStr;

        if (input.parentNode) {
          input.replaceWith(newSpan);
        }

        if (lineRow) {
          const timestampEl = lineRow.querySelector(".lyric-timestamp");
          const seekBtnEl = lineRow.querySelector(".lyric-seek");
          if (timestampEl) timestampEl.textContent = timeStr;
          if (seekBtnEl) seekBtnEl.dataset.start = line.start;
        }

        this.callbacks.onLyricTextChange();
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          finishEdit();
        }
      });

      input.addEventListener("blur", finishEdit);
    });
  }

  // escapeHtml은 window.lyricsCore.escapeHtml로 일원화되었습니다.

  render() {
    this.isUserScrolling = false;
    if (this.resumeScrollBtn) {
      this.resumeScrollBtn.classList.remove("visible");
    }

    if (this.state.lyrics.length === 0) {
      this.lyricsList.className = "lyrics-list empty" + (this.state.editMode ? " edit-mode" : "");
      if (this.state.embeddedLyricsLines && this.state.embeddedLyricsLines.length > 0) {
        this.lyricsList.innerHTML = `
          <div class="empty-state">
            <h3>내장 가사 감지됨 (${this.state.embeddedLyricsLines.length}줄)</h3>
            <p>Analyze를 실행하여 Whisper로 타임스탬프를 추출한 뒤,<br>AI Align으로 싱크를 적용하세요.</p>
          </div>
        `;
      } else {
        this.lyricsList.innerHTML = `
          <div class="empty-state">
            <h3>No lyrics yet</h3>
            <p>Open a track and press Analyze to generate synchronized lyrics.</p>
          </div>
        `;
      }
      return;
    }

    this.state.activeLineId = null;

    this.lyricsList.className = "lyrics-list" + (this.state.editMode ? " edit-mode" : "");
    this.lyricsList.innerHTML = this.state.lyrics
      .map(
        (line) => {
          const timeStr = window.lyricsCore.formatClock(line.start, this.state.editMode);
          const timeControls = this.state.editMode ? `
            <div class="lyric-time-controls" data-line-id="${line.id}">
              <button class="lyric-sync-btn" type="button" data-line-id="${line.id}" title="현재 재생 시간으로 동기화 (sync)">
                <span class="btn-icon">🎯</span>
                <span class="btn-text">sync</span>
              </button>
              <button class="lyric-time-adjust-btn dec5" type="button" data-line-id="${line.id}" title="0.5초 앞당기기">«</button>
              <button class="lyric-time-adjust-btn dec" type="button" data-line-id="${line.id}" title="0.1초 앞당기기">-</button>
              <span class="lyric-timestamp-text" data-line-id="${line.id}" title="더블 클릭하여 직접 시간 입력">${timeStr}</span>
              <button class="lyric-time-adjust-btn inc" type="button" data-line-id="${line.id}" title="0.1초 늦추기">+</button>
              <button class="lyric-time-adjust-btn inc5" type="button" data-line-id="${line.id}" title="0.5초 늦추기">»</button>
            </div>
          ` : "";

          return `
            <div class="lyric-line" data-line-id="${line.id}">
              <div class="lyric-seek-wrap">
                <span class="lyric-timestamp">${timeStr}</span>
                ${timeControls}
                <button class="lyric-seek" type="button" data-start="${line.start}">
                  <strong>${window.lyricsCore.escapeHtml(line.text)}</strong>
                </button>
                <input class="lyric-edit" data-line-id="${line.id}" type="text" value="${window.lyricsCore.escapeHtml(line.text)}" aria-label="Edit lyric" />
              </div>
            </div>
          `;
        }
      )
      .join("");
  }

  handleUserScroll() {
    if (this.state.editMode || !this.state.lyrics || !this.state.lyrics.length) return;
    this.isUserScrolling = true;
    if (this.resumeScrollBtn) {
      this.resumeScrollBtn.classList.add("visible");
    }
    clearTimeout(this.scrollTimeout);
    this.scrollTimeout = setTimeout(() => {
      this.resumeAutoScroll();
    }, 4500);
  }

  resumeAutoScroll() {
    this.isUserScrolling = false;
    if (this.resumeScrollBtn) {
      this.resumeScrollBtn.classList.remove("visible");
    }
    clearTimeout(this.scrollTimeout);
    this.scrollToActiveLine(true);
  }

  scrollToActiveLine(smooth = false) {
    if (!this.state.activeLineId) return;
    const activeRow = this.lyricsList.querySelector(`.lyric-line[data-line-id="${this.state.activeLineId}"]`);
    if (!activeRow) return;

    const container = this.lyricsList;
    const containerRect = container.getBoundingClientRect();
    const activeRect = activeRow.getBoundingClientRect();
    const relativeTop = activeRect.top - containerRect.top;
    const targetTop = container.scrollTop + relativeTop - (container.clientHeight / 2) + (activeRow.offsetHeight / 2);

    container.scrollTo({
      top: targetTop,
      behavior: smooth ? "smooth" : "instant"
    });
  }

  updateActive(currentTime, isPlaying) {
    const activeIndex = window.lyricsCore.getActiveLineIndex(this.state.lyrics, currentTime, this.state.syncOffset);
    const activeLine = this.state.lyrics[activeIndex] || null;
    const activeLineId = activeLine ? activeLine.id : null;

    if (activeLineId !== this.state.activeLineId) {
      const prevActiveLineId = this.state.activeLineId;
      this.state.activeLineId = activeLineId;

      if (prevActiveLineId) {
        const prevRow = this.lyricsList.querySelector(`.lyric-line[data-line-id="${prevActiveLineId}"]`);
        if (prevRow) prevRow.classList.remove("active");
      }

      if (activeLineId) {
        const activeRow = this.lyricsList.querySelector(`.lyric-line[data-line-id="${activeLineId}"]`);
        if (activeRow) {
          activeRow.classList.add("active");
          if (!this.state.editMode && !this.isUserScrolling) {
            this.scrollToActiveLine(false);
          }
        }
      }
    }

    window.lyricsPlayer.updateFloatingLine({
      previous: this.state.lyrics[activeIndex - 1]?.text || "",
      current: activeLine?.text || "No lyric line",
      next: this.state.lyrics[activeIndex + 1]?.text || "",
      isPlaying: isPlaying
    });
  }

  setOffset(offset) {
    this.state.syncOffset = Number(Number(offset).toFixed(1));
    this.syncOffsetBadge.textContent = `Offset ${this.state.syncOffset >= 0 ? "+" : ""}${this.state.syncOffset.toFixed(1)}s`;
    this.syncOffsetBadge.style.color = this.state.syncOffset === 0 ? "var(--muted)" : "var(--warning)";
    
    this.callbacks.onOffsetChange();
  }

  toggleEditMode(forceState = null) {
    const wasEditMode = this.state.editMode;
    this.state.editMode = typeof forceState === "boolean" ? forceState : !this.state.editMode;
    if (this.editModeButton) {
      this.editModeButton.textContent = this.state.editMode ? "감상으로 복귀" : "가사 편집";
      this.editModeButton.classList.toggle("active", this.state.editMode);
    }

    if (wasEditMode && !this.state.editMode) {
      // 편집 완료(Done 클릭) 시점에만 타임스탬프 순서대로 가사를 한 번에 정렬
      this.state.lyrics.sort((a, b) => a.start - b.start);
      this.selectedEditLineId = null;
    }

    if (this.state.editMode) {
      this.renderEditView();
    } else {
      this.render();
    }

    if (this.callbacks.onToggleEditView) {
      this.callbacks.onToggleEditView(this.state.editMode);
    }

    if (wasEditMode && !this.state.editMode && this.callbacks.onEditDone) {
      this.callbacks.onEditDone();
    } else {
      this.callbacks.onLyricTextChange();
    }
  }

  getSelectedEditLine() {
    if (!this.selectedEditLineId) return null;
    return this.state.lyrics.find((l) => l.id === this.selectedEditLineId) || null;
  }

  selectEditLine(lineId, seekAudio = true) {
    this.selectedEditLineId = lineId;
    const line = this.getSelectedEditLine();

    // 1. 목록 선택 하이라이트 갱신
    if (this.editLyricsList) {
      const allItems = this.editLyricsList.querySelectorAll(".edit-line-item");
      allItems.forEach((el) => {
        el.classList.toggle("selected", el.dataset.lineId === lineId);
      });
    }

    // 2. 우측 도구 패널 인풋 및 버튼 활성화/값 바인딩
    if (line) {
      this.updateSelectedLineUI(line);
      if (seekAudio && this.callbacks.onSeek) {
        this.callbacks.onSeek(Math.max(line.start - this.state.syncOffset, 0));
      }
    } else {
      this.clearSelectedLineUI();
    }
  }

  updateSelectedLineUI(line) {
    if (!line) return;
    const timeFormatted = window.lyricsCore.formatClock(line.start, true);
    if (this.editLineTextInput) {
      this.editLineTextInput.value = line.text;
      this.editLineTextInput.disabled = false;
    }
    if (this.editLineTimeInput) {
      this.editLineTimeInput.value = timeFormatted;
      this.editLineTimeInput.disabled = false;
    }
    if (this.editSyncCurrentBtn) this.editSyncCurrentBtn.disabled = false;
    if (this.editLineDec5) this.editLineDec5.disabled = false;
    if (this.editLineDec1) this.editLineDec1.disabled = false;
    if (this.editLineInc1) this.editLineInc1.disabled = false;
    if (this.editLineInc5) this.editLineInc5.disabled = false;

    // 좌측 목록 UI 반영
    const row = this.editLyricsList?.querySelector(`.edit-line-item[data-line-id="${line.id}"]`);
    if (row) {
      const timeEl = row.querySelector(".edit-line-time");
      if (timeEl) timeEl.textContent = timeFormatted;
      const textEl = row.querySelector(".edit-line-text");
      if (textEl) textEl.textContent = line.text;
    }
  }

  clearSelectedLineUI() {
    if (this.editLineTextInput) {
      this.editLineTextInput.value = "";
      this.editLineTextInput.disabled = true;
    }
    if (this.editLineTimeInput) {
      this.editLineTimeInput.value = "";
      this.editLineTimeInput.disabled = true;
    }
    if (this.editSyncCurrentBtn) this.editSyncCurrentBtn.disabled = true;
    if (this.editLineDec5) this.editLineDec5.disabled = true;
    if (this.editLineDec1) this.editLineDec1.disabled = true;
    if (this.editLineInc1) this.editLineInc1.disabled = true;
    if (this.editLineInc5) this.editLineInc5.disabled = true;
  }

  adjustSelectedLine(delta) {
    const line = this.getSelectedEditLine();
    if (!line) return;
    line.start = window.lyricsCore.adjustTimestamp(line.start, delta);
    this.updateSelectedLineUI(line);
    this.callbacks.onLyricTextChange();
  }

  syncSelectedLineWithAudio() {
    const line = this.getSelectedEditLine();
    if (!line || !this.callbacks.onGetCurrentTime) return;
    const currentAudioTime = this.callbacks.onGetCurrentTime();
    if (Number.isFinite(currentAudioTime)) {
      line.start = window.lyricsCore.adjustTimestamp(currentAudioTime - this.state.syncOffset, 0);
      this.updateSelectedLineUI(line);
      this.callbacks.onLyricTextChange();
    }
  }

  renderEditView() {
    if (!this.editLyricsList) return;

    if (this.editLineCount) {
      this.editLineCount.textContent = `총 ${this.state.lyrics.length}줄`;
    }

    if (this.state.lyrics.length === 0) {
      this.editLyricsList.innerHTML = `
        <div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--muted);">
          <p>등록된 가사가 없습니다.<br>우측 AI 가사 분석(Analyze)을 실행해 가사를 생성하세요.</p>
        </div>
      `;
      this.clearSelectedLineUI();
      return;
    }

    this.editLyricsList.innerHTML = this.state.lyrics.map((line) => {
      const isSelected = line.id === this.selectedEditLineId;
      return `
        <div class="edit-line-item ${isSelected ? "selected" : ""}" data-line-id="${line.id}">
          <span class="edit-line-time">${window.lyricsCore.formatClock(line.start, true)}</span>
          <span class="edit-line-text">${window.lyricsCore.escapeHtml(line.text)}</span>
        </div>
      `;
    }).join("");

    // 선택된 라인이 없거나 유효하지 않으면 첫 번째 라인 자동 선택
    if (!this.selectedEditLineId || !this.state.lyrics.some(l => l.id === this.selectedEditLineId)) {
      this.selectEditLine(this.state.lyrics[0].id, false);
    } else {
      this.selectEditLine(this.selectedEditLineId, false);
    }
  }

  setEnabled(enabled) {
    this.editModeButton.disabled = !enabled;
  }
}

window.LyricsViewer = LyricsViewer;
