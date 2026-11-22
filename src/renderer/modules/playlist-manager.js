class PlaylistManager {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks; // { onSelectTrack, onPlaylistChange, onClearPlaylist, onTrackMetadataUpdated }
    this.playlistCount = document.querySelector("#playlistCount");
    this.playlistList = document.querySelector("#playlistList");
    this.playlistSortSelect = document.querySelector("#playlistSortSelect");
    this.playlistSearchButton = document.querySelector("#playlistSearchButton");
    this.playlistSearchInput = document.querySelector("#playlistSearchInput");
    this.playlistClearButton = document.querySelector("#playlistClearButton");
    this.openTrackButton = document.querySelector("#openTrackButton");

    // 라이브러리 뷰 요소들
    this.libraryTrackCount = document.querySelector("#libraryTrackCount");
    this.libraryTableBody = document.querySelector("#libraryTableBody");
    this.librarySearchInput = document.querySelector("#librarySearchInput");
    this.librarySortSelect = document.querySelector("#librarySortSelect");
    this.libraryAddTrackBtn = document.querySelector("#libraryAddTrackBtn");
    this.libraryClearBtn = document.querySelector("#libraryClearBtn");

    // 곡 상세 정보 모달
    this.trackInfoModal = document.querySelector("#trackInfoModal");
    this.closeTrackInfoBtn = document.querySelector("#closeTrackInfoBtn");
    this.trackInfoBody = document.querySelector("#trackInfoBody");

    this.dragSourceIndex = null;
    this._metaSyncTimer = null;
    this._initEvents();
  }

  _initEvents() {
    if (this.openTrackButton) this.openTrackButton.addEventListener("click", () => this.openAddTracks());
    if (this.playlistClearButton) this.playlistClearButton.addEventListener("click", () => this.clearPlaylist());
    if (this.playlistSearchButton) this.playlistSearchButton.addEventListener("click", () => this.toggleSearch());
    if (this.playlistSearchInput) this.playlistSearchInput.addEventListener("input", () => this.filterPlaylist());

    // 라이브러리 툴바 이벤트
    if (this.libraryAddTrackBtn) this.libraryAddTrackBtn.addEventListener("click", () => this.openAddTracks());
    if (this.libraryClearBtn) this.libraryClearBtn.addEventListener("click", () => this.clearPlaylist());
    if (this.librarySearchInput) this.librarySearchInput.addEventListener("input", () => this.renderLibraryTable());

    if (this.librarySortSelect) {
      this.librarySortSelect.addEventListener("change", () => {
        this._sortByOption(this.librarySortSelect.value);
      });
    }

    if (this.libraryTableBody) {
      this.libraryTableBody.addEventListener("click", (event) => {
        const infoBtn = event.target.closest(".library-item-info");
        if (infoBtn) {
          event.stopPropagation();
          const idx = parseInt(infoBtn.dataset.index, 10);
          this.showTrackInfoModal(idx);
          return;
        }

        const removeBtn = event.target.closest(".library-item-remove");
        if (removeBtn) {
          event.stopPropagation();
          const indexToRemove = parseInt(removeBtn.dataset.index, 10);
          this.removeTrack(indexToRemove);
          return;
        }

        const row = event.target.closest(".library-row");
        if (row) {
          const idx = parseInt(row.dataset.index, 10);
          this.callbacks.onSelectTrack(idx);
        }
      });
    }

    if (this.playlistSortSelect) {
      this.playlistSortSelect.addEventListener("change", () => {
        this._sortByOption(this.playlistSortSelect.value);
        this.playlistSortSelect.value = "";
      });
    }

    if (this.closeTrackInfoBtn && this.trackInfoModal) {
      this.closeTrackInfoBtn.addEventListener("click", () => this.trackInfoModal.close());
    }
    if (this.trackInfoModal) {
      this.trackInfoModal.addEventListener("click", (e) => {
        if (e.target === this.trackInfoModal) {
          this.trackInfoModal.close();
        }
      });
    }

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

  _splitTrackMeta(trackOrTitle) {
    return window.lyricsCore.resolveTrackMeta(trackOrTitle);
  }

  _sortByOption(mode) {
    if (!mode) return;
    if (mode === "reset") {
      this.sort((a, b) => (a.originalOrder ?? 0) - (b.originalOrder ?? 0));
      return;
    }

    this.sort((a, b) => {
      const metaA = this._splitTrackMeta(a);
      const metaB = this._splitTrackMeta(b);

      if (mode === "album") {
        const albumA = metaA.album || "\uffff";
        const albumB = metaB.album || "\uffff";
        const albumCmp = albumA.localeCompare(albumB);
        if (albumCmp !== 0) return albumCmp;

        const discA = metaA.discNumber ?? 9999;
        const discB = metaB.discNumber ?? 9999;
        if (discA !== discB) return discA - discB;

        const trackA = metaA.trackNumber ?? 9999;
        const trackB = metaB.trackNumber ?? 9999;
        if (trackA !== trackB) return trackA - trackB;

        return metaA.title.localeCompare(metaB.title);
      }

      if (mode === "artist") {
        const artA = metaA.artist === "-" ? "\uffff" : metaA.artist;
        const artB = metaB.artist === "-" ? "\uffff" : metaB.artist;
        return artA.localeCompare(artB) || metaA.album.localeCompare(metaB.album) || metaA.title.localeCompare(metaB.title);
      }

      if (mode === "year") {
        const yearA = metaA.year || "";
        const yearB = metaB.year || "";
        if (yearA !== yearB) return yearB.localeCompare(yearA);
        return metaA.title.localeCompare(metaB.title);
      }

      if (mode === "duration") {
        const durA = metaA.duration ?? 0;
        const durB = metaB.duration ?? 0;
        return durB - durA || metaA.title.localeCompare(metaB.title);
      }

      // default "az"
      return metaA.title.localeCompare(metaB.title);
    });
  }

  _matchesQuery(meta, query) {
    if (!query) return true;
    const fields = [meta.title, meta.artist, meta.album, meta.genre, meta.year, meta.fileName];
    return fields.some((field) => field && String(field).toLowerCase().includes(query));
  }

  showTrackInfoModal(index) {
    const track = this.state.playlist[index];
    if (!track || !this.trackInfoModal || !this.trackInfoBody) return;

    const meta = this._splitTrackMeta(track);
    const esc = window.lyricsCore.escapeHtml;
    const formatNumTotal = (num, total) => (num ? (total ? `${num} / ${total}` : String(num)) : "-");
    const techSummary = [meta.codec, meta.bitrate, meta.sampleRate].filter(Boolean).join(" · ") || "-";

    const rows = [
      ["곡 제목", meta.title || "-"],
      ["아티스트", meta.artist || "-"],
      ["앨범명", meta.album || "-"],
      ["앨범 아티스트", meta.albumArtist || "-"],
      ["트랙 번호", formatNumTotal(meta.trackNumber, meta.totalTracks)],
      ["디스크 번호", formatNumTotal(meta.discNumber, meta.totalDiscs)],
      ["발매 연도", meta.year || "-"],
      ["장르", meta.genre || "-"],
      ["재생 길이", meta.duration ? window.lyricsCore.formatClock(meta.duration) : "-"],
      ["오디오 정보", techSummary],
      ["원본 파일명", meta.fileName || "-"],
      ["파일 경로", track.path || "-"]
    ];

    this.trackInfoBody.innerHTML = `
      <div class="track-info-grid">
        ${rows.map(([label, val]) => `
          <div class="track-info-label">${esc(label)}</div>
          <div class="track-info-value">${esc(String(val))}</div>
        `).join("")}
      </div>
    `;
    this.trackInfoModal.showModal();
  }

  updateHeader() {
    const total = this.state.playlist.length;
    const currentNum = this.state.currentIndex >= 0 ? this.state.currentIndex + 1 : 0;
    if (this.playlistCount) {
      this.playlistCount.textContent = total > 0 ? `${currentNum}/${total}곡` : "0곡";
    }
    if (this.libraryTrackCount) {
      this.libraryTrackCount.textContent = `총 ${total}곡`;
    }
  }

  renderLibraryTable() {
    if (!this.libraryTableBody) return;

    if (this.state.playlist.length === 0) {
      this.libraryTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 48px 0; color: var(--muted);">
            라이브러리에 등록된 음악이 없습니다. 우측 상단의 '+ 음악 추가' 버튼을 눌러 곡을 추가하세요.
          </td>
        </tr>
      `;
      return;
    }

    const query = (this.librarySearchInput?.value || "").trim().toLowerCase();
    let renderedCount = 0;
    let html = "";

    this.state.playlist.forEach((track, index) => {
      const meta = this._splitTrackMeta(track);
      if (!this._matchesQuery(meta, query)) {
        return;
      }

      renderedCount++;
      const isPlaying = index === this.state.currentIndex;
      const rowClass = isPlaying ? "library-row playing" : "library-row";
      const numDisplay = isPlaying ? "▶" : String(index + 1);
      const trackPill = meta.trackNumber ? `<span class="track-num-pill">${String(meta.trackNumber).padStart(2, "0")}</span>` : "";
      const durationStr = meta.duration ? window.lyricsCore.formatClock(meta.duration) : "-";

      html += `
        <tr class="${rowClass}" data-index="${index}">
          <td class="col-num">${numDisplay}</td>
          <td class="col-title" title="${window.lyricsCore.escapeHtml(meta.title)}">
            ${trackPill}<strong style="font-weight: 600;">${window.lyricsCore.escapeHtml(meta.title)}</strong>
          </td>
          <td class="col-artist" title="${window.lyricsCore.escapeHtml(meta.artist)}">${window.lyricsCore.escapeHtml(meta.artist)}</td>
          <td class="col-album" title="${window.lyricsCore.escapeHtml(meta.album || "-")}">${window.lyricsCore.escapeHtml(meta.album || "-")}</td>
          <td class="col-duration">${durationStr}</td>
          <td class="col-status">
            <span class="status-chip ${isPlaying && this.state.lyrics?.length > 0 ? "ready" : ""}">
              ${isPlaying && this.state.lyrics?.length > 0 ? `가사 있음 (${this.state.lyrics.length}줄)` : "대기"}
            </span>
          </td>
          <td class="col-actions">
            <div class="library-actions-wrap">
              <button class="sort-action-btn library-item-info" data-index="${index}" type="button" title="상세 메타데이터 보기">정보</button>
              <button class="sort-action-btn danger-action-btn library-item-remove" data-index="${index}" type="button" title="라이브러리에서 제거">삭제</button>
            </div>
          </td>
        </tr>
      `;
    });

    if (renderedCount === 0) {
      this.libraryTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 32px 0; color: var(--muted);">
            검색 결과와 일치하는 음악이 없습니다.
          </td>
        </tr>
      `;
    } else {
      this.libraryTableBody.innerHTML = html;
    }
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

  _lazyLoadQueueArtwork(items) {
    if (!window.lyricsPlayer?.getTrackAlbumArt) return;
    items.forEach((item, index) => {
      if (item.albumArt || item._artRequested || !item.path) return;
      item._artRequested = true;
      window.lyricsPlayer.getTrackAlbumArt(item).then((art) => {
        if (!art) return;
        item.albumArt = art;
        const row = this.playlistList?.querySelector(`.playlist-item[data-index="${index}"]`);
        if (!row) return;
        const wrap = row.querySelector(".playlist-item-art-wrap");
        if (wrap) {
          wrap.innerHTML = `<img class="playlist-item-art" src="${art}" alt="" />`;
        }
      }).catch(() => {});
    });
  }

  _scheduleMetadataSync(updatedTrack) {
    if (updatedTrack && this.state.track === updatedTrack && this.callbacks.onTrackMetadataUpdated) {
      this.callbacks.onTrackMetadataUpdated(updatedTrack);
    }
    clearTimeout(this._metaSyncTimer);
    this._metaSyncTimer = setTimeout(() => {
      this.saveCache();
      this.renderLibraryTable();
    }, 150);
  }

  _lazyLoadQueueMetadata(items) {
    if (!window.lyricsPlayer?.getTrackMetadata) return;
    items.forEach((item, index) => {
      if (item.metadataLoaded || item._metaRequested || !item.path) return;
      item._metaRequested = true;
      window.lyricsPlayer.getTrackMetadata(item).then((meta) => {
        if (!meta) return;
        Object.assign(item, meta);
        const resolved = this._splitTrackMeta(item);
        const row = this.playlistList?.querySelector(`.playlist-item[data-index="${index}"]`);
        if (row) {
          const titleEl = row.querySelector(".playlist-item-title");
          const artistEl = row.querySelector(".playlist-item-artist");
          const durEl = row.querySelector(".playlist-item-duration");
          if (titleEl) titleEl.textContent = resolved.title;
          if (artistEl) artistEl.textContent = resolved.artist;
          if (durEl) durEl.textContent = resolved.duration ? window.lyricsCore.formatClock(resolved.duration) : "";
        }
        this._scheduleMetadataSync(item);
      }).catch(() => {});
    });
  }

  render() {
    if (this.state.playlist.length === 0) {
      this.playlistList.innerHTML = `<div class="settings-note" style="text-align: center; padding: 12px 0;">No tracks added</div>`;
      this.updateHeader();
      this.renderLibraryTable();
      return;
    }

    const query = (this.state.playlistFilter || "").trim().toLowerCase();
    let html = "";
    let renderedCount = 0;

    this.state.playlist.forEach((item, index) => {
      const meta = this._splitTrackMeta(item);
      if (!this._matchesQuery(meta, query)) {
        return;
      }
      renderedCount++;
      const activeClass = index === this.state.currentIndex ? "active" : "";
      const artHtml = item.albumArt
        ? `<img class="playlist-item-art" src="${item.albumArt}" alt="" />`
        : `<span class="playlist-item-art-placeholder">♪</span>`;
      const durStr = meta.duration ? window.lyricsCore.formatClock(meta.duration) : "";

      html += `
        <div class="playlist-item ${activeClass}" data-index="${index}" draggable="true" title="${window.lyricsCore.escapeHtml(meta.album ? `${meta.title} — ${meta.artist} (${meta.album})` : `${meta.title} — ${meta.artist}`)}">
          <div class="playlist-item-art-wrap">${artHtml}</div>
          <div class="playlist-item-meta">
            <span class="playlist-item-title">${window.lyricsCore.escapeHtml(meta.title)}</span>
            <span class="playlist-item-artist">${window.lyricsCore.escapeHtml(meta.artist)}</span>
          </div>
          <span class="playlist-item-duration">${durStr}</span>
          <button class="playlist-item-remove" data-index="${index}" type="button" title="대기열에서 제외">✕</button>
        </div>
      `;
    });

    if (renderedCount === 0) {
      this.playlistList.innerHTML = `<div class="settings-note" style="text-align: center; padding: 12px 0;">No matching tracks</div>`;
    } else {
      this.playlistList.innerHTML = html;
      this.bindDragEvents();
      this._lazyLoadQueueArtwork(this.state.playlist);
      this._lazyLoadQueueMetadata(this.state.playlist);
    }

    this.updateHeader();
    this.renderLibraryTable();
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
    if (this.playlistClearButton) this.playlistClearButton.disabled = !enabled;
    if (this.libraryClearBtn) this.libraryClearBtn.disabled = !enabled;
  }
}

window.PlaylistManager = PlaylistManager;
