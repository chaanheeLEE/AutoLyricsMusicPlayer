/**
 * embed-manager.js
 *
 * 음원 메타데이터 가사 내장(Embed to Audio) 관련 UI, 모달 팝업,
 * 푸른색 하이라이트 상태 제어 및 태깅 실행을 캡슐화한 클래스입니다.
 */

class EmbedManager {
  constructor(state, trackStatus, updateAlignButtonState) {
    this.state = state;
    this.trackStatus = trackStatus;
    this.updateAlignButtonState = updateAlignButtonState;

    this.embedAudioButton = document.querySelector("#embedAudioButton");
    this.embedModal = document.querySelector("#embedModal");
    this.embedCurrentSummary = document.querySelector("#embedCurrentSummary");
    this.customLyricsSection = document.querySelector("#customLyricsSection");
    this.customLyricsTextarea = document.querySelector("#customLyricsTextarea");
    this.confirmEmbedBtn = document.querySelector("#confirmEmbedBtn");
    this.closeEmbedModalBtn = document.querySelector("#closeEmbedModalBtn");

    this._initEvents();
  }

  _initEvents() {
    if (this.closeEmbedModalBtn && this.embedModal) {
      this.closeEmbedModalBtn.addEventListener("click", () => this.closeModal());
    }

    document.querySelectorAll("input[name='embedSource']").forEach((radio) => {
      radio.addEventListener("change", (e) => {
        if (this.customLyricsSection) {
          this.customLyricsSection.style.display = e.target.value === "custom" ? "flex" : "none";
        }
      });
    });

    if (this.embedAudioButton && this.embedModal) {
      this.embedAudioButton.addEventListener("click", () => this.openModal());
    }

    if (this.confirmEmbedBtn && this.embedModal) {
      this.confirmEmbedBtn.addEventListener("click", () => this.handleConfirm());
    }
  }

  setEnabled(enabled) {
    if (this.embedAudioButton) {
      this.embedAudioButton.disabled = !enabled;
    }
  }

  updateHighlight(hasEmbedded) {
    if (!this.embedAudioButton) return;
    if (hasEmbedded) {
      this.embedAudioButton.classList.remove("highlight-blue");
    } else {
      this.embedAudioButton.classList.add("highlight-blue");
    }
  }

  openModal() {
    if (!this.state.track) return;

    const count = this.state.lyrics ? this.state.lyrics.length : 0;
    if (this.embedCurrentSummary) {
      this.embedCurrentSummary.textContent = `현재 화면에 ${count}개의 싱크가사 라인이 있습니다.`;
    }

    const defaultRadio = document.querySelector("input[name='embedSource'][value='current']");
    if (defaultRadio) defaultRadio.checked = true;
    if (this.customLyricsSection) this.customLyricsSection.style.display = "none";
    if (this.customLyricsTextarea) this.customLyricsTextarea.value = "";

    this.embedModal.showModal();
  }

  closeModal() {
    if (this.embedModal) {
      this.embedModal.close();
    }
  }

  async handleConfirm() {
    if (!this.state.track) return;

    const selectedSource = document.querySelector("input[name='embedSource']:checked")?.value;
    let targetLyrics = [];
    let targetOffset = this.state.syncOffset;

    if (selectedSource === "current") {
      if (!this.state.lyrics || this.state.lyrics.length === 0) {
        alert("현재 화면에 분석/생성된 가사가 없습니다. 먼저 [Analyze]로 가사를 생성하거나 '외부 가사 직접 입력' 옵션을 선택해 주세요.");
        return;
      }
      targetLyrics = this.state.lyrics;
    } else {
      const rawText = (this.customLyricsTextarea?.value || "").trim();
      if (!rawText) {
        alert("내장할 가사 텍스트를 입력해 주세요.");
        return;
      }

      if (window.lyricsSources?.parseLrc) {
        targetLyrics = window.lyricsSources.parseLrc(rawText);
      }
      if (!targetLyrics || targetLyrics.length === 0) {
        const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
        targetLyrics = lines.map((text, i) => ({
          id: `custom_${i + 1}`,
          start: 0,
          end: 0,
          text
        }));
      }
      targetOffset = 0;
    }

    this.closeModal();

    this.embedAudioButton.disabled = true;
    const originalText = this.embedAudioButton.textContent;
    this.embedAudioButton.textContent = "Embedding...";

    try {
      const result = await window.lyricsPlayer.embedLyricsToFile({
        track: this.state.track,
        lyrics: targetLyrics,
        syncOffset: targetOffset
      });

      if (result?.ok) {
        // 내장 성공 시 state 및 버튼 상태 갱신
        this.state.embeddedLyricsLines = targetLyrics.map((l) => (typeof l === "string" ? l : l.text));
        this.updateHighlight(true); // 푸른색 하이라이트 해제
        if (typeof this.updateAlignButtonState === "function") {
          this.updateAlignButtonState(); // AI Align 버튼 활성화 업데이트
        }

        if (this.trackStatus) {
          this.trackStatus.textContent = "음원 파일에 가사 내장 완료! [AI Align]을 누르면 내장된 가사로 AI 정렬이 시작됩니다.";
        }
        alert("음원 파일 메타데이터에 가사가 성공적으로 내장되었습니다.");
      } else {
        if (this.trackStatus) {
          this.trackStatus.textContent = `Failed to embed lyrics: ${result?.error || "unknown error"}`;
        }
        alert(`가사 내장 실패: ${result?.error || "알 수 없는 오류"}`);
      }
    } catch (err) {
      if (this.trackStatus) {
        this.trackStatus.textContent = `Embed error: ${err.message}`;
      }
      alert(`오류 발생: ${err.message}`);
    } finally {
      this.embedAudioButton.disabled = false;
      this.embedAudioButton.textContent = originalText;
    }
  }
}

window.EmbedManager = EmbedManager;
