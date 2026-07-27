class LyricsViewer {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks; // { onSeek, onOffsetChange, onLyricTextChange }
    this.lyricsList = document.querySelector("#lyricsList");
    this.syncOffsetBadge = document.querySelector("#syncOffsetBadge");
    this.editModeButton = document.querySelector("#editModeButton");

    this._initEvents();
  }

  _initEvents() {
    this.editModeButton.addEventListener("click", () => this.toggleEditMode());

    this.lyricsList.addEventListener("click", (event) => {
      if (this.state.editMode) return;
      const seekButton = event.target.closest(".lyric-seek");
      if (!seekButton) return;

      const start = Number(seekButton.dataset.start);
      this.callbacks.onSeek(Math.max(start - this.state.syncOffset, 0));
    });

    this.lyricsList.addEventListener("input", (event) => {
      const editField = event.target.closest(".lyric-edit");
      if (!editField) return;

      const lineId = editField.dataset.lineId;
      const line = this.state.lyrics.find((item) => item.id === lineId);
      if (!line) return;

      line.text = editField.value;
      const lineRow = editField.closest(".lyric-line");
      lineRow.querySelector("strong").textContent = line.text;
      
      this.callbacks.onLyricTextChange();
    });

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

      // (1) 현재 재생 시간 동기화 (Sync 🎯)
      const syncBtn = event.target.closest(".lyric-sync-btn");
      if (syncBtn) {
        const lineId = syncBtn.dataset.lineId;
        const line = this.state.lyrics.find(l => l.id === lineId);
        if (line && this.callbacks.onGetCurrentTime) {
          const currentAudioTime = this.callbacks.onGetCurrentTime();
          if (Number.isFinite(currentAudioTime)) {
            line.start = Number(Math.max(0, currentAudioTime - this.state.syncOffset).toFixed(3));
            updateRowTimestampUI(syncBtn.closest(".lyric-line"), line);
            this.callbacks.onLyricTextChange();
          }
        }
        return;
      }

      // (2) 0.5초 줄이기 («)
      const dec5Btn = event.target.closest(".lyric-time-adjust-btn.dec5");
      if (dec5Btn) {
        const lineId = dec5Btn.dataset.lineId;
        const line = this.state.lyrics.find(l => l.id === lineId);
        if (line) {
          line.start = Number(Math.max(0, line.start - 0.5).toFixed(3));
          updateRowTimestampUI(dec5Btn.closest(".lyric-line"), line);
          this.callbacks.onLyricTextChange();
        }
        return;
      }

      // (3) 0.1초 줄이기 (-)
      const decBtn = event.target.closest(".lyric-time-adjust-btn.dec");
      if (decBtn) {
        const lineId = decBtn.dataset.lineId;
        const line = this.state.lyrics.find(l => l.id === lineId);
        if (line) {
          line.start = Number(Math.max(0, line.start - 0.1).toFixed(3));
          updateRowTimestampUI(decBtn.closest(".lyric-line"), line);
          this.callbacks.onLyricTextChange();
        }
        return;
      }

      // (4) 0.1초 늘리기 (+)
      const incBtn = event.target.closest(".lyric-time-adjust-btn.inc");
      if (incBtn) {
        const lineId = incBtn.dataset.lineId;
        const line = this.state.lyrics.find(l => l.id === lineId);
        if (line) {
          line.start = Number((line.start + 0.1).toFixed(3));
          updateRowTimestampUI(incBtn.closest(".lyric-line"), line);
          this.callbacks.onLyricTextChange();
        }
        return;
      }

      // (5) 0.5초 늘리기 (»)
      const inc5Btn = event.target.closest(".lyric-time-adjust-btn.inc5");
      if (inc5Btn) {
        const lineId = inc5Btn.dataset.lineId;
        const line = this.state.lyrics.find(l => l.id === lineId);
        if (line) {
          line.start = Number((line.start + 0.5).toFixed(3));
          updateRowTimestampUI(inc5Btn.closest(".lyric-line"), line);
          this.callbacks.onLyricTextChange();
        }
        return;
      }
    });

    // 시간 텍스트 더블클릭 시 타이핑 가능한 입력창으로 직접 전환
    this.lyricsList.addEventListener("dblclick", (event) => {
      if (!this.state.editMode) return;

      const timeSpan = event.target.closest(".lyric-timestamp-text");
      if (!timeSpan) return;

      const lineId = timeSpan.dataset.lineId;
      const line = this.state.lyrics.find(l => l.id === lineId);
      if (!line) return;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "lyric-timestamp-input";
      input.value = window.lyricsCore.formatClock(line.start, true);
      
      const lineRow = timeSpan.closest(".lyric-line");
      timeSpan.replaceWith(input);
      input.focus();
      input.select();

      const parseTime = (val) => {
        const trimmed = val.trim();
        if (!trimmed) return NaN;

        if (/^\d+(\.\d+)?$/.test(trimmed)) {
          return Number(trimmed);
        }

        const parts = trimmed.split(":");
        if (parts.length >= 2) {
          let seconds = 0;
          let multiplier = 1;
          for (let i = parts.length - 1; i >= 0; i--) {
            const num = Number(parts[i]);
            if (isNaN(num)) return NaN;
            seconds += num * multiplier;
            multiplier *= 60;
          }
          return seconds;
        }

        return NaN;
      };

      const finishEdit = () => {
        let nextVal = parseTime(input.value);
        if (!isNaN(nextVal)) {
          line.start = Number(nextVal.toFixed(3));
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
        if (e.key === "Enter") {
          finishEdit();
        } else if (e.key === "Escape") {
          finishEdit();
        }
      });

      input.addEventListener("blur", () => {
        finishEdit();
      });
    });
  }

  // escapeHtml은 window.lyricsCore.escapeHtml로 일원화되었습니다.

  render() {
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
          if (!this.state.editMode) {
            const container = this.lyricsList;
            if (container) {
              const containerRect = container.getBoundingClientRect();
              const activeRect = activeRow.getBoundingClientRect();
              const relativeTop = activeRect.top - containerRect.top;
              const targetTop = container.scrollTop + relativeTop - (container.clientHeight / 2) + (activeRow.offsetHeight / 2);

              container.scrollTo({
                top: targetTop,
                behavior: "instant"
              });
            }
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

  toggleEditMode() {
    const wasEditMode = this.state.editMode;
    this.state.editMode = !this.state.editMode;
    this.editModeButton.textContent = this.state.editMode ? "Done" : "Edit";
    this.editModeButton.classList.toggle("active", this.state.editMode);

    if (wasEditMode && !this.state.editMode) {
      // 편집 완료(Done 클릭) 시점에만 타임스탬프 순서대로 가사를 한 번에 정렬
      this.state.lyrics.sort((a, b) => a.start - b.start);
    }

    this.render();

    if (wasEditMode && !this.state.editMode && this.callbacks.onEditDone) {
      this.callbacks.onEditDone();
    } else {
      this.callbacks.onLyricTextChange();
    }
  }

  setEnabled(enabled) {
    this.editModeButton.disabled = !enabled;
  }
}

window.LyricsViewer = LyricsViewer;
