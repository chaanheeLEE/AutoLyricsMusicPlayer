# Updated — Auto Lyrics Player (ALP)

다음 릴리즈에 반영될 완료 업데이트 내역을 작성합니다. (이전 버전 이력은 [CHANGELOG.md](./CHANGELOG.md) 참고)

---

## 2026-11-26 — Gemini 가사 전사·정합 프롬프트 및 후처리 안정화 (`v1.1.1` Step 2)
- **`transcribeSystemInstruction` 및 `alignSystemInstruction` 정밀 다듬기 (`src/main/services/gemini-prompts.js`)**:
  - 전사 시 전주·간주에 `[간주]` / `♪` 같은 비가사 마커를 생성하지 않고, 메인 보컬 뒤의 약한 화음/에코를 별도 줄로 중복 분리하지 않도록 기준을 보강했습니다.
  - 정합 시 1·2절 반복 후렴구 ID 재사용은 엄격히 금지하되, Whisper가 연속된 2~3줄을 하나로 합친 경우에만 `lyrics-aligner.js`의 글자 수 비율 분할과 맞물려 동일 `whisper_id`를 공유할 수 있도록 규칙을 정합화하고 첫 줄·간주 직후 앵커 라인 매칭 안내를 추가했습니다.
- **Gemini 호출 일관성 및 `lyrics-aligner.js` 후처리 보강 (`gemini-service.js`, `ipc-router.js`, `lyrics-aligner.js`)**:
  - Gemini 정합(`temperature: 0`) 및 클라우드 전사(`temperature: 0.1`)에 저온도 설정을 적용하고, 설정에서 특정 분석 언어 지정 시에만 주 언어 힌트를 전달(`Auto-detect` 시 미포함)하도록 개선했습니다.
  - 비연속 중복 `whisper_id` 분할 가드를 추가하고, 전주가 긴 곡에서 선두 `null` 라인을 `0.0초` 고정이 아닌 첫 매칭 라인 직전 구간으로 역산 보간하도록 개선했습니다.

---

## 2026-11-24 — UI·UX 마감 (`v1.1.1` Step 1): 앱 아이콘 재디자인, 대기열 상단 정돈 및 가사 글씨체 커스텀
- **앱 아이콘(`src/assets/icon.svg`, `src/assets/icon.png`) 재디자인 (`Lyra Wave & Sync Lyrics`)**:
  - 기존 아이콘의 고정 격자무늬 배경을 제거하고 실제 투명 배경(512×512 32-bit RGBA PNG) + 벡터(`SVG`) 마스터 원본으로 재제작했습니다.
  - `Lyra Lavender` 다크 스쿼클 위에 재생 심볼·음파와 하이라이트된 싱크 가사 라인을 결합했습니다.
- **우측 대기열(`#queueDrawer`) 상단 컨트롤 배치 정돈 (`index.html`, `playlist.css`)**:
  - 흩어져 있던 정렬 드롭다운(`#playlistSortSelect`), 검색(`#playlistSearchButton`), `Clear` 버튼을 좌측 정렬 + 우측 액션 그룹(`.queue-tools-actions`) 구조로 묶고 헤더 여백(`18px`)과 버튼 높이(`26px`)를 통일했습니다.
- **메인·플로팅 가사 글씨체 개별 선택 및 시스템 폰트 커스텀 옵션 추가 (`index.html`, `settings-view.js`, `settings-manager.js`, `window-manager.js`, `lyrics-core.js`, `lyrics.css`, `floating.css`, `floating.js`)**:
  - `설정 > 일반 > 화면 및 테마`(**메인 가사 글씨체**)와 `설정 > 플로팅 가사창 > 가사 텍스트 및 정렬`(**플로팅 가사 글씨체**)에 각각 독립된 글꼴 선택 옵션(기본 고딕 · 감성 명조 · 부드러운 라운드 · 고정폭 · 직접 입력)을 추가해, 감상 화면과 플로팅 창에 서로 다른 글씨체를 지정할 수 있습니다.
