const elCard = document.querySelector(".floating-card");
const previousLine = document.querySelector("#previousLine");
const currentLine = document.querySelector("#currentLine");
const nextLine = document.querySelector("#nextLine");
const floatingPlayPause = document.querySelector("#floatingPlayPause");
const floatingPrev = document.querySelector("#floatingPrev");
const floatingNext = document.querySelector("#floatingNext");
const floatingLock = document.querySelector("#floatingLock");
const floatingHide = document.querySelector("#floatingHide");

let locked = false;
let currentIgnoreState = null;

function updateIgnoreMouseEvents(ignore, options) {
  const key = `${ignore}_${options ? JSON.stringify(options) : ""}`;
  if (currentIgnoreState === key) return;
  currentIgnoreState = key;
  window.lyricsPlayer.setIgnoreMouseEvents(ignore, options);
}

window.lyricsPlayer.onFloatingLine((payload) => {
  previousLine.textContent = payload.previous || "";
  currentLine.textContent = payload.current || "No lyric line";
  nextLine.textContent = payload.next || "";
  floatingPlayPause.textContent = payload.isPlaying ? "❚❚" : "▶";
});

window.lyricsPlayer.onFloatingLocked((nextLocked) => {
  locked = nextLocked;
  floatingLock.textContent = locked ? "Unlock" : "Lock";
  if (locked) {
    updateIgnoreMouseEvents(true, { forward: true });
  } else {
    updateIgnoreMouseEvents(false);
  }
});

floatingPlayPause.addEventListener("click", () => {
  window.lyricsPlayer.sendPlaybackCommand("toggle-play");
});

floatingPrev.addEventListener("click", () => {
  window.lyricsPlayer.sendPlaybackCommand("prev-track");
});

floatingNext.addEventListener("click", () => {
  window.lyricsPlayer.sendPlaybackCommand("next-track");
});

floatingLock.addEventListener("click", () => {
  locked = !locked;
  floatingLock.textContent = locked ? "Unlock" : "Lock";
  window.lyricsPlayer.setFloatingLocked(locked);
});

floatingHide.addEventListener("click", () => {
  window.lyricsPlayer.sendPlaybackCommand("close-floating");
});

// 컨트롤 영역 및 가사 영역 DOM 획득
const elControls = document.querySelector(".floating-controls");
const elLines = document.querySelector(".floating-lines");

// 마우스 클릭 시작 시점에 선제적으로 관통 해제 처리
// 마우스 움직임에 따라 동적으로 관통 모드 제어
window.addEventListener("mousemove", (e) => {
  // 드래그 중이거나 클릭이 진행 중인 경우 (왼쪽 버튼이 눌려 있는 상태): 관통 상태 전환 방지
  if (e.buttons & 1) {
    updateIgnoreMouseEvents(false);
    return;
  }

  const x = e.clientX;
  const y = e.clientY;

  const rectControls = elControls.getBoundingClientRect();
  const rectLines = elLines.getBoundingClientRect();

  // 가사 드래그 영역에는 15px의 선제 감지 버퍼(패딩)를 두어 반응성 극대화
  const paddingLines = 15;

  const isOverControls = (
    x >= rectControls.left &&
    x <= rectControls.right &&
    y >= rectControls.top &&
    y <= rectControls.bottom
  );

  const isOverLines = (
    x >= rectLines.left - paddingLines &&
    x <= rectLines.right + paddingLines &&
    y >= rectLines.top - paddingLines &&
    y <= rectLines.bottom + paddingLines
  );

  if (locked) {
    // 잠금 상태: 컨트롤 버튼 영역 위에서만 조작 허용
    if (isOverControls) {
      updateIgnoreMouseEvents(false);
    } else {
      updateIgnoreMouseEvents(true, { forward: true });
    }
  } else {
    // 잠금 해제 상태: 컨트롤 버튼 영역 및 가사 표시 영역(버퍼 포함) 위에서 조작 허용, 그 외의 공백 영역은 관통
    if (isOverControls || isOverLines) {
      updateIgnoreMouseEvents(false);
    } else {
      updateIgnoreMouseEvents(true, { forward: true });
    }
  }

  // 가사 영역이 아닌 오직 버튼들 영역(.floating-controls) 위에 마우스가 직접 올라갔을 때만 버튼 활성화
  const shouldShowHover = isOverControls;
  if (shouldShowHover) {
    elCard.classList.add("mouse-over");
  } else {
    elCard.classList.remove("mouse-over");
  }
});

// 마우스가 창 범위를 완전히 벗어난 경우의 복구 처리
document.addEventListener("mouseleave", () => {
  elCard.classList.remove("mouse-over");
  if (locked) {
    // 잠금 상태: 창 밖에서는 이벤트를 관통시킴
    updateIgnoreMouseEvents(true, { forward: true });
  } else {
    // 잠금 해제 상태: 창 밖에서는 기본적으로 비관통(false)으로 대기하여 재진입 시 즉시 드래그 및 버튼 클릭 가능
    updateIgnoreMouseEvents(false);
  }
});

// 초기화 시점: 기본적으로 잠금 해제 상태이므로 비관통(false) 상태로 시작
updateIgnoreMouseEvents(false);

// 메인 프로세스(app.js)로부터 설정창 비주얼 설정을 전달받아 CSS 변수 실시간 바인딩
window.lyricsPlayer.onApplyVisuals((settings) => {
  if (!settings) return;
  const root = document.documentElement;
  
  if (settings.fontSize) {
    root.style.setProperty("--floating-font-size", `${settings.fontSize}px`);
  }
  if (settings.opacity !== undefined) {
    root.style.setProperty("--floating-bg-opacity", settings.opacity);
  }
  if (settings.bgColor) {
    root.style.setProperty("--floating-bg-color", settings.bgColor);
  }
  if (settings.fontColor) {
    root.style.setProperty("--floating-font-color", settings.fontColor);
  }
  if (settings.align) {
    root.style.setProperty("--floating-text-align", settings.align);
  }
});
