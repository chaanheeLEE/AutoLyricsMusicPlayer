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
  }

  escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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

    this.lyricsList.className = "lyrics-list" + (this.state.editMode ? " edit-mode" : "");
    this.lyricsList.innerHTML = this.state.lyrics
      .map(
        (line) => `
          <div class="lyric-line" data-line-id="${line.id}">
            <div class="lyric-seek-wrap">
              <span class="lyric-timestamp">${window.lyricsCore.formatClock(line.start)}</span>
              <button class="lyric-seek" type="button" data-start="${line.start}">
                <strong>${this.escapeHtml(line.text)}</strong>
              </button>
              <input class="lyric-edit" data-line-id="${line.id}" type="text" value="${this.escapeHtml(line.text)}" aria-label="Edit lyric" />
            </div>
          </div>
        `
      )
      .join("");
  }

  updateActive(currentTime, isPlaying) {
    const activeIndex = window.lyricsCore.getActiveLineIndex(this.state.lyrics, currentTime, this.state.syncOffset);
    const activeLine = this.state.lyrics[activeIndex] || null;
    const activeLineId = activeLine ? activeLine.id : null;

    if (activeLineId !== this.state.activeLineId) {
      this.state.activeLineId = activeLineId;
      document.querySelectorAll(".lyric-line").forEach((lineRow) => {
        const isActive = lineRow.dataset.lineId === activeLineId;
        lineRow.classList.toggle("active", isActive);
        if (isActive && !this.state.editMode) {
          const container = this.lyricsList;
          const containerHeight = container.clientHeight;
          const rowTop = lineRow.offsetTop;
          const rowHeight = lineRow.offsetHeight;
          
          container.scrollTo({
            top: rowTop - (containerHeight / 2) + (rowHeight / 2),
            behavior: "smooth"
          });
        }
      });
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
    this.state.editMode = !this.state.editMode;
    this.editModeButton.textContent = this.state.editMode ? "Done" : "Edit";
    this.editModeButton.classList.toggle("active", this.state.editMode);
    this.render();
    this.callbacks.onLyricTextChange(); // Re-highlight active line in edit mode
  }

  setEnabled(enabled) {
    this.editModeButton.disabled = !enabled;
  }
}

window.LyricsViewer = LyricsViewer;
