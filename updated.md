# Updated — Auto Lyrics Player (ALP)

다음 릴리즈에 반영될 완료 업데이트 내역을 작성합니다. (이전 버전 이력은 [CHANGELOG.md](./CHANGELOG.md) 참고)

---

## 2026-11-26 — Main 다운로드·런타임·취소 헬퍼 공통화 (`v1.1.1` Stage 3 Unit 3-A)
- **`src/main/helpers/download-helper.js` 추출 및 Main 6개 서비스 중복 제거 (`package.json`, `test/download-helper.test.js`)**:
  - `cuda-manager.js`, `vocal-model-manager.js`, `model-manager.js`에 흩어져 있던 `formatBytes`, `getDirectorySize`, `downloadFileWithRedirects`와 `isCancelledError`를 `download-helper.js`로 통합하고 상대 리다이렉트·중단 시 임시 파일 정리 안전성을 일원화했습니다.
  - `transcription-worker.js`의 `resolvePython`/`hasFasterWhisper`를 `model-manager.js`가 재사용하고, `createCancelledError`를 `gemini-service.js`·`lyrics-scraper.js`·`transcription-worker.js` 간 공유하도록 정리했습니다.
  - `test/download-helper.test.js`를 추가해 크기 포맷, 디렉터리 용량, 리다이렉트 다운로드, HTTP 404/리다이렉트 루프 실패, `AbortController` 취소 시 부분 파일 정리를 검증했습니다.

---

## 2026-11-26 — 비동기 작업 관리자 경계 정밀화 및 회귀 테스트 (`v1.1.1` Stage 2)
- **`src/renderer/modules/lyrics-job-manager.js` UMD 전환 및 순수 헬퍼 분리 (`test/lyrics-job-manager.test.js`)**:
  - 진행률/폴백 오류 메시지 포맷(`formatProgressMessage`, `formatAlignFallbackMessage`), 장치 라벨 정규화(`normalizeDeviceLabel`), 작업 ID 필터(`isProgressMessageForJob`), 오프닝 힌트(`buildOpeningPromptHint`), 상황별 `beamSize`(`resolveAdaptiveBeamSize`), 평문 가사 출처 결정(`resolvePersistedPlainLyrics`)을 DOM 비의존 순수 함수로 추출하고 선택적 런타임 DI를 추가했습니다.
  - `test/lyrics-job-manager.test.js`를 추가해 수동 제어 `Deferred` 기반의 자동 정합 체이닝·폴백·곡 전환 경합 비오염/원곡 캐시 안전 저장·취소 후 구형 작업 이벤트 무시 시나리오를 검증했습니다.

---

## 2026-11-26 — 트랙·히스토리·캐시 컨트롤러 분리 (`v1.1.1` Stage 1 Unit 1-B)
- **`src/renderer/modules/track-controller.js` 추출 및 비동기 특성화 테스트 추가 (`app.js`, `index.html`, `package.json`, `test/track-controller.test.js`)**:
  - `app.js`의 트랙 전환(`trackSelectionSeq` 경합 가드), `history`/`forwardHistory`/셔플 다음 곡 계산, 다음 트랙 프리페치(`prefetchNextTrack`), 자동 분석 디바운스(`scheduleAutoAnalyze`), 트랙별 디바운스 가사 스냅샷 저장(`saveTimers`)을 `TrackController`와 순수 헬퍼로 분리했습니다.
  - `test/track-controller.test.js`를 추가해 스냅샷 격리·내비게이션 인덱스·디바운스/즉시/일괄 저장·곡 전환 경합 비오염·`.txt_plain` 자동 분석 시나리오를 검증했습니다.

---

## 2026-11-26 — 렌더러 셸 컨트롤 모듈 분리 (`v1.1.1` Stage 1 Unit 1-A)
- **`src/renderer/modules/shell-controls.js` 추출 및 특성화 테스트 추가 (`app.js`, `index.html`, `package.json`, `test/shell-controls.test.js`)**:
  - `app.js`에 혼재되어 있던 전역 키보드 단축키, `MediaSession` 메타데이터/액션 핸들러, 뷰 전환(`now-playing`·`library`·`lyrics-edit`), 대기열 드로어 토글, 플로팅 창 버튼·이벤트, 커스텀 윈도우 제어 버튼을 `ShellControls` 클래스 및 순수 헬퍼로 분리했습니다.
  - `test/shell-controls.test.js`를 추가해 단축키 대상 판별·액션 매핑·음소거 토글 및 뷰/드로어/재생 명령 분기 동작을 검증했습니다.

---

## 2026-11-26 — 정적 검사 안전망 보강 및 가사 출처 계약 일원화 (`v1.1.1` Stage 0)
- **정적 검사(`npm run check`) 대상 보강 (`package.json`)**:
  - 누락되어 있던 Main JS 6개(`cache-manager.js`, `settings-manager.js`, `lyrics-sources.js`, `model-manager.js`, `media-helper.js`, `lyrics-tagger.js`)를 구문 검사 목록에 추가했습니다.
- **가사 출처(`lyricsSource`) 상수·헬퍼 일원화 및 UI 상태/라벨 불일치 수정 (`lyrics-core.js`, `cache-manager.js`, `lyrics-aligner.js`, `app.js`, `lyrics-job-manager.js`)**:
  - `lyrics-core.js`에 `LYRICS_SOURCE` 상수와 `isEmbeddedAudioSource`·`isPlainOnlyLyricsSource`·`isAiAnalyzedLyricsSource`·`resolvePlainLyricsSourceLabel`을 추가해 Main·Renderer 판단 기준을 통합했습니다.
  - `.lrc` / `.txt` 평문 가사가 로드된 곡에서 `AI 재분석`으로 오표시되던 버튼 상태 판별을 바로잡고, 캐시 삭제 시 상태 배지도 함께 초기화하도록 보완했습니다.
  - `.txt` 사이드카 및 캐시된 LRCLIB 평문 가사(`lrclib_cached`)가 `내장 가사`로 통칭되던 문제를 `plainLyricsSource` 추적로 구분해 각각 `로컬 텍스트(.txt) 가사`, `웹 공식 가사`, `내장 가사`로 정확히 표기하도록 개선했습니다.

---

## 2026-11-26 — 로컬 Whisper·보컬 분리 분석 성능 최적화 (`v1.1.1` Step 4)
- **중복 디코딩 제거 및 VRAM 메모리 경합 해소 (`transcribe.py`, `vocal_separator.py`)**:
  - 자동 언어 감지 시 30초 전체 디코딩 대신 `WhisperModel.detect_language()` 경량 호출을 우선 사용해 분석 시작 지연을 줄였습니다.
  - ONNX 보컬 분리 세션을 `WhisperModel` 로딩 전에 먼저 실행하고 `del session` + `gc.collect()`로 해제하도록 순서를 조정해 GPU VRAM 경합을 완화했습니다.
- **CPU 멀티스레드, 상황별 `beamSize` 및 실시간 진행률 스트리밍 (`transcribe.py`, `lyrics-job-manager.js`)**:
  - CPU 모드에서 `cpu_threads=min(os.cpu_count() or 4, 8)`를 명시해 다중 코어를 활용하도록 개선했습니다.
  - `AI 정합` 연계 또는 평문 가사 확보 곡은 `beamSize: 2`, 단독 분석은 `beamSize: 3`으로 추론 속도를 개선하고, 전사 세그먼트 종료 시간 기준으로 UI 진행률을 실시간 출력하도록 보강했습니다.

---

## 2026-11-26 — 평문 가사 자동 확보 고도화 및 로컬 `.txt` 사이드카 지원 (`v1.1.1` Step 3)
- **LRCLIB 정확 조회(`/api/get`) 및 `duration` 가중치 채점 (`lyrics-scraper.js`)**:
  - 아티스트·곡명 메타데이터가 있는 곡은 `/api/get` 정확 조회를 우선 시도(404 시 `/api/search` 자동 폴백)하고, 검색 후보 평가에 텍스트 Bigram 유사도와 트랙 길이(`duration`) 차이를 함께 반영해 TV Size·리믹스 오매칭을 줄였습니다.
- **로컬 `<파일명>.txt` 평문 가사 사이드카 자동 인식 (`lyrics-sources.js`, `cache-manager.js`, `app.js`)**:
  - `.lrc` 파일과 음원 내장 태그에 이어 같은 폴더의 `<파일명>.txt` 파일도 자동 감지(UTF-8 BOM 제거 및 LRC 타임스탬프 포함 `.txt` 호환)해 AI 정합 기준 가사로 바로 활용할 수 있도록 연결했습니다.
- **확보된 공식 평문 가사 캐시 보존·재사용 (`lyrics-aligner.js`, `lyrics-job-manager.js`)**:
  - AI 정합 중 LRCLIB에서 확보한 평문 가사(`officialLyricsLines`)를 성공 및 폴백 시 모두 `embeddedPlainLyrics` 캐시에 보존해, 재시도나 재정합 시 외부 검색을 반복하지 않도록 개선했습니다.

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
