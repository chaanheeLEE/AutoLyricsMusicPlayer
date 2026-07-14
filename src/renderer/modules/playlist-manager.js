class PlaylistManager {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks; // { onSelectTrack, onPlaylistChange, onClearPlaylist }
    this.playlistCount = document.querySelector("#playlistCount");
    this.playlistList = document.querySelector("#playlistList");
    this.playlistSortSelect = document.querySelector("#playlistSortSelect");
    this.playlistSearchButton = document.querySelector("#playlistSearchButton");
    this.playlistSearchInput = document.querySelector("#playlistSearchInput");
    this.playlistClearButton = document.querySelector("#playlistClearButton");
    this.openTrackButton = document.querySelector("#openTrackButton");

    this.dragSourceIndex = null;
    this._initEvents();
  }

  _initEvents() {
    this.openTrackButton.addEventListener("click", () => this.openAddTracks());
    this.playlistClearButton.addEventListener("click", () => this.clearPlaylist());
    this.playlistSearchButton.addEventListener("click", () => this.toggleSearch());
    this.playlistSearchInput.addEventListener("input", () => this.filterPlaylist());
    
    this.playlistSortSelect.addEventListener("change", () => {
      const val = this.playlistSortSelect.value;
      if (val === "az") {
        this.sort((a, b) => a.title.localeCompare(b.title));
      } else if (val === "reset") {
        this.sort((a, b) => a.originalOrder - b.originalOrder);
      }
      this.playlistSortSelect.value = "";
    });

    this.playlistList.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".playlist-item-remove");
      if (removeBtn) {
        event.stopPropagation();
        const indexToRemove = parseInt(removeBtn.dataset.index, 10);
        this.removeTrack(indexToRemove);
        return;
      }

      const playlistItem = event.target.closest(".playlist-item");
      if (playlistItem) {
        const idx = parseInt(playlistItem.dataset.index, 10);
        this.callbacks.onSelectTrack(idx);
      }
    });
  }

  updateHeader() {
    const total = this.state.playlist.length;
    const currentNum = this.state.currentIndex >= 0 ? this.state.currentIndex + 1 : 0;
    this.playlistCount.textContent = total > 0 ? `(${currentNum}/${total})` : "";
  }

  bindDragEvents() {
    const items = this.playlistList.querySelectorAll(".playlist-item");

    items.forEach((item) => {
      item.addEventListener("dragstart", (e) => {
        this.dragSourceIndex = parseInt(item.dataset.index, 10);
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", this.dragSourceIndex);
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        item.classList.add("drag-over");
      });

      item.addEventListener("dragleave", () => {
        item.classList.remove("drag-over");
      });

      item.addEventListener("dragend", () => {
        items.forEach((i) => {
          i.classList.remove("dragging");
          i.classList.remove("drag-over");
        });
      });

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");

        const targetIndex = parseInt(item.dataset.index, 10);
        if (this.dragSourceIndex === null || this.dragSourceIndex === targetIndex) return;

        // 1. 재생목록 순서 이동
        const draggedItem = this.state.playlist.splice(this.dragSourceIndex, 1)[0];
        this.state.playlist.splice(targetIndex, 0, draggedItem);

        // 2. 재생 중인 인덱스 보정
        let newCurrentIndex = this.state.currentIndex;
        if (this.state.currentIndex === this.dragSourceIndex) {
          newCurrentIndex = targetIndex;
        } else {
          if (this.state.currentIndex > this.dragSourceIndex && this.state.currentIndex <= targetIndex) {
            newCurrentIndex--;
          } else if (this.state.currentIndex < this.dragSourceIndex && this.state.currentIndex >= targetIndex) {
            newCurrentIndex++;
          }
        }
        this.state.currentIndex = newCurrentIndex;

        // 3. 재생 히스토리 보정
        this.state.history = this.state.history.map((histIdx) => {
          if (histIdx === this.dragSourceIndex) {
            return targetIndex;
          }
          if (histIdx > this.dragSourceIndex && histIdx <= targetIndex) {
            return histIdx - 1;
          }
          if (histIdx < this.dragSourceIndex && histIdx >= targetIndex) {
            return histIdx + 1;
          }
          return histIdx;
        });

        // 4. 캐시 및 화면 동기화
        this.saveCache();
        this.render();

        if (this.state.track) {
          this.state.track = this.state.playlist[this.state.currentIndex];
        }
        
        this.callbacks.onPlaylistChange();
      });
    });
  }

  // escapeHtml은 window.lyricsCore.escapeHtml로 일원화되었습니다.

  render() {
    if (this.state.playlist.length === 0) {
      this.playlistList.innerHTML = `<div class="settings-note" style="text-align: center; padding: 12px 0;">No tracks added</div>`;
      this.updateHeader();
      return;
    }

    const query = (this.state.playlistFilter || "").trim().toLowerCase();
    let html = "";
    let renderedCount = 0;

    this.state.playlist.forEach((item, index) => {
      if (query && !item.title.toLowerCase().includes(query)) {
        return;
      }
      renderedCount++;
      const activeClass = index === this.state.currentIndex ? "active" : "";
      html += `
        <div class="playlist-item ${activeClass}" data-index="${index}" draggable="true">
          <span class="playlist-item-title">${index + 1}. ${window.lyricsCore.escapeHtml(item.title)}</span>
          <button class="playlist-item-remove" data-index="${index}" type="button" title="Remove track">✕</button>
        </div>
      `;
    });

    if (renderedCount === 0) {
      this.playlistList.innerHTML = `<div class="settings-note" style="text-align: center; padding: 12px 0;">No matching tracks</div>`;
    } else {
      this.playlistList.innerHTML = html;
      this.bindDragEvents();
    }

    this.updateHeader();
  }

  saveCache() {
    try {
      localStorage.setItem("playlist", JSON.stringify(this.state.playlist));
      localStorage.setItem("playlist_index", String(this.state.currentIndex));
    } catch (e) {
      console.error("Failed to save playlist cache", e);
    }
  }

  async openAddTracks() {
    this.playlistList.innerHTML = `<div class="playlist-loading">Adding track(s)…</div>`;

    try {
      const newTracks = await window.lyricsPlayer.openTrack();
      if (!newTracks || newTracks.length === 0) {
        this.render();
        return;
      }

      const startIndex = this.state.playlist.length;
      newTracks.forEach((track) => {
        if (!this.state.playlist.some((t) => t.path === track.path)) {
          track.originalOrder = this.state.playlist.length;
          this.state.playlist.push(track);
        }
      });

      this.render();
      this.saveCache();

      if (this.state.currentIndex === -1 && this.state.playlist.length > 0) {
        this.callbacks.onSelectTrack(startIndex < this.state.playlist.length ? startIndex : 0);
      }
    } catch (error) {
      console.error("Failed to add tracks", error);
      this.render();
    }
  }

  removeTrack(indexToRemove) {
    this.state.playlist.splice(indexToRemove, 1);

    this.state.history = this.state.history
      .filter((idx) => idx !== indexToRemove)
      .map((idx) => (idx > indexToRemove ? idx - 1 : idx));

    if (this.state.playlist.length === 0) {
      this.state.currentIndex = -1;
      this.state.history = [];
      this.state.track = null;
      this.state.lyrics = [];
      this.state.embeddedLyricsLines = null;
      this.state.playlistFilter = "";
      this.playlistSearchInput.value = "";
      this.playlistSearchInput.style.display = "none";
      
      this.callbacks.onClearPlaylist();
    } else if (this.state.currentIndex === indexToRemove) {
      let nextIndex = indexToRemove;
      if (nextIndex >= this.state.playlist.length) {
        nextIndex = this.state.playlist.length - 1;
      }
      this.callbacks.onSelectTrack(nextIndex);
    } else if (this.state.currentIndex > indexToRemove) {
      this.state.currentIndex--;
    }

    this.render();
    this.saveCache();
  }

  clearPlaylist() {
    if (this.state.playlist.length === 0) return;

    const confirmed = confirm("재생 목록 전체를 비우시겠습니까?");
    if (!confirmed) return;

    this.state.playlist = [];
    this.state.currentIndex = -1;
    this.state.history = [];
    this.state.track = null;
    this.state.lyrics = [];
    this.state.embeddedLyricsLines = null;
    this.state.playlistFilter = "";
    this.playlistSearchInput.value = "";
    this.playlistSearchInput.style.display = "none";

    this.callbacks.onClearPlaylist();
    this.saveCache();
    this.render();
  }

  sort(sortFn) {
    if (this.state.playlist.length <= 1) return;

    const currentTrackPath = this.state.track ? this.state.track.path : null;
    const oldOrderMap = this.state.playlist.map((track, idx) => ({ path: track.path, oldIdx: idx }));

    this.state.playlist.sort(sortFn);

    const indexMapping = {};
    oldOrderMap.forEach((oldItem) => {
      const newIdx = this.state.playlist.findIndex((track) => track.path === oldItem.path);
      indexMapping[oldItem.oldIdx] = newIdx;
    });

    if (currentTrackPath !== null) {
      this.state.currentIndex = this.state.playlist.findIndex((track) => track.path === currentTrackPath);
    }

    this.state.history = this.state.history
      .map((oldIdx) => indexMapping[oldIdx])
      .filter((idx) => idx !== undefined && idx >= 0);

    this.saveCache();
    this.render();
    this.callbacks.onPlaylistChange();
  }

  toggleSearch() {
    const isHidden = this.playlistSearchInput.style.display === "none";
    if (isHidden) {
      this.playlistSearchInput.style.display = "block";
      this.playlistSearchInput.focus();
    } else {
      this.playlistSearchInput.style.display = "none";
      this.playlistSearchInput.value = "";
      this.state.playlistFilter = "";
      this.render();
    }
  }

  filterPlaylist() {
    this.state.playlistFilter = this.playlistSearchInput.value;
    this.render();
  }

  setEnabled(enabled) {
    this.playlistClearButton.disabled = !enabled;
  }
}

window.PlaylistManager = PlaylistManager;
