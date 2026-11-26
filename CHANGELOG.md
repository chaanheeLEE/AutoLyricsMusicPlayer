# Changelog — Auto Lyrics Player (ALP)

릴리즈별 업데이트 이력을 최신순(내림차순)으로 보관합니다.

---

## v1.1.1 (2026-11-26)

## 2026-11-26 — Python 전사 스크립트(`transcribe.py`) 최상위 함수 구조화 (`v1.1.1` Stage 6)
- **`src/main/services/transcribe.py` 단일 파일 내 최상위 함수 승격 (`docs/todo.md`)**:
  - PyInstaller `--onefile` 번들 호환을 유지한 채 `main()` 내부 중첩 함수·단계(`parse_args`, `configure_windows_cuda_dlls`, `download_whisper_model`, `format_ort_provider`, `prepare_vocal_audio`, `detect_vocal_language`, `collect_segments`, `check_cuda_runtime`, `create_whisper_model`, `resolve_whisper_model`, `run_transcription`)를 최상위 함수로 승격해 가독성과 단계별 검증성을 높였습니다.
  - 중복 `import os` 및 미사용 `download_model` 임포트를 제거하고 무거운 런타임 의존성(`faster_whisper`, `ctranslate2`, `numpy`, `huggingface_hub`, `vocal_separator`)은 지연 임포트로 유지했으며, `docs/todo.md`의 버전 로드맵 요약을 `v1.1.1` 마감·Phase A~D 체계로 최신화했습니다.

---

## 2026-11-26 — 메인 프로세스 IPC 라우터 도메인별 분할 및 채널 상수 일원화 (`v1.1.1` Stage 5)
- **`src/main/ipc/` 5개 도메인 모듈 + `channels.js` 분리 및 회귀 테스트 추가 (`ipc-router.js`, `window-manager.js`, `package.json`, `test/ipc-router.test.js`)**:
  - 모든 Main ↔ Renderer IPC 채널 45종을 `src/main/ipc/channels.js`(`IPC_CHANNELS`)에 일원화하고 `window-manager.js`의 이벤트 송신 리터럴도 상수로 통일했습니다. (샌드박스 환경 호환을 위해 `preload.js`는 수정하지 않고 계약 테스트로 정합성을 검증)
  - 513줄의 `src/main/core/ipc-router.js`를 `track-ipc.js`, `lyrics-ipc.js`, `transcription-ipc.js`, `models-ipc.js`, `window-settings-ipc.js` 5개 도메인 등록 모듈로 분할하고 `ipc-router.js`는 의존성 조립 엔트리(`registerIpcHandlers(windowManager, overrides)`)로 경량화했습니다.
  - `test/ipc-router.test.js`를 추가해 `preload.js` 전체 채널·`IPC_CHANNELS` 일치 여부, 트랙 열기/메타/프리페치, LRC/VTT 내보내기·태그 임베딩, Whisper/Gemini 취소 격리 및 `lyrics:align` 선점 중단, 모델 다운로드 진행률 전달, 플로팅·창 제어 동작을 검증했습니다.

---

## 2026-11-26 — AI 정합 시간 역행 연쇄 누락(LIS 이상치 제거) 및 엄격한 1:1 프롬프트 복원
- **시간 역행 연쇄 무효화 및 미래 후렴 ID 선점 버그 해결 (`src/main/helpers/lyrics-aligner.js`)**:
  - 기존 순차 탐욕 검사(`invalidateTimeReversals`)가 미래 절/후렴으로 잘못 점프한 단일 매칭을 기준점으로 고정해 뒤따르는 정상 구간의 싱크를 연쇄 삭제하던 문제를, **최장 단조 비감소 부분 수열(LIS) + 인접 점프 제곱합 최소화** 기반 이상치 제거로 교체했습니다.
  - DP 점수(`dpScore`)에서 고유 `whisper_id` 전환(`+1`)이 인접 중복 공유(`+0.01`)보다 우선되도록 가중치를 부여하고, 비연속 동일 `whisper_id`는 같은 체인에 공존할 수 없도록 제한했으며 `buildOfficialTimeMap()`도 상대 위치 기반 클러스터 선택을 지원해 실제 후렴 줄이 올바른 `whisper_id`를 보존하도록 보강했습니다.
- **Gemini 정합 프롬프트 1:1 매핑 원칙 복원 및 점프 억제 강화 (`src/main/services/gemini-prompts.js`)**:
  - 인접 병합 소절의 동일 `whisper_id` 중복 공유 예외를 제거해 엄격한 1:1 고유 매핑을 복원하고, 현재 시간대 주변에 부합하는 STT가 없거나 전후 라인과 시간 순서가 꼬이는 경우 다른 절·후렴구 ID로 건너뛰지 말고 즉시 `null`을 반환해 보간에 위임하도록 규칙을 명확화했습니다.
  - 실제 로그 재현 회귀 테스트를 `test/alignment-pipeline.test.js`에 추가하고, 타임스탬프 정확도 고도화 및 정량 벤치마크 테스트 구축 과제를 `docs/todo.md` `[P1]` 항목으로 등록했습니다.

---

## 2026-11-26 — AI 정합·로컬 가사 파이프라인 내부 구조화 (`v1.1.1` Stage 4)
- **`lyrics-aligner.js`·`lyrics-sources.js`·`lyrics-scraper.js` 순수 단계 분리 및 중복 계산 제거 (`test/alignment-pipeline.test.js`)**:
  - `lyrics-aligner.js`: `alignAndInterpolateLyrics()` 내부 후처리를 `invalidateTimeReversals`, `buildOfficialTimeMap`, `interpolateMissingLines`, `clampLyricDurations` 순수 함수로 분해하고 중복 `alignment.find()`·미사용 변수를 정리했습니다.
  - `lyrics-sources.js`: 내장 가사와 `.txt` 사이드카에서 중복되던 텍스트 파싱을 `parseRawLyricsText`로 통합하고 상단 우선순위 주석을 3순위(`.txt`)까지 최신화했습니다.
  - `lyrics-scraper.js`: `evaluateLyricsCandidate` 도입으로 거절 로그 시 수행되던 유사도·가사 추출 이중 재계산을 제거하고, 신규 단위 테스트 3건을 추가해 동등성을 검증했습니다.

---

## 2026-11-26 — 설정 모달 모델·가속 팩·보컬 모델 패널 분리 (`v1.1.1` Stage 3 Unit 3-B)
- **`src/renderer/modules/model-settings-panel.js` 분리 및 단위 테스트 추가 (`settings-view.js`, `index.html`, `package.json`, `test/model-settings-panel.test.js`)**:
  - `settings-view.js`에서 Whisper 모델 카드, NVIDIA CUDA 가속 팩, ONNX 보컬 분리 모델 상태 조회·렌더링·진행률 바·취소/삭제 UI(~470줄)를 `ModelSettingsPanel`과 순수 상태 기술 헬퍼(`buildInstalledModelSelectOptions`, `describeCudaStatusView`, `describeVocalModelStatusView`, `applyProgressBarUpdate`)로 분리했습니다.
  - `test/model-settings-panel.test.js`를 추가해 설치 모델 선택 옵션, CUDA/보컬 4종·3종 상태 계산, 진행률 바 공통 갱신 및 종료 시 재조회 동작을 검증했습니다.

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

---

## v1.1.0 (2026-11-24)

## 2026-11-24 — 트랙 프리페치·셔플 덱 고도화, 자동화 진입 속도 개선 및 설정·용어 정비
- **순차·셔플 다음 트랙 프리페치 및 가사 즉시 로딩 (`app.js`, `cache-manager.js`, `lyrics-core.js`, `player-controller.js`)**:
  - `state.playlist` 기준 프리페치를 복구하고 미보유 가사도 RAM 캐시(`null`)에 기록해 중복 디스크 스캔을 제거했습니다.
  - Fisher-Yates 기반 비반복 셔플 순서표(`syncShuffleQueue`)와 앞으로가기 스택(`forwardHistory`)을 도입해, 랜덤 재생에서도 다음 예정 곡을 정확히 사전 적재하고 `이전 곡 → 다음 곡` 이동 시 원래 곡으로 일관되게 복귀하도록 개선했습니다.
  - 곡 전환 시 이전 작업 취소(`cancelPromise`) 대기와 가사 캐시 로드를 분리해 싱크 가사를 즉시 렌더링하고, 프리페치(`180ms`)와 자동 분석 진입(`200ms` 디바운스)을 비동기로 예약해 연속 스킵 시 반응 속도를 높였습니다.
- **자동화 설정 탭 통합, `AI 정합` 용어 통일 및 버튼 상태 정밀화 (`index.html`, `settings-view.js`, `lyrics-job-manager.js`, `lyrics-viewer.js`, `embed-manager.js`)**:
  - `자동화 워크플로우` 카드를 `AI 및 음성 분석` 탭으로 통합하고 Gemini API Key 입력 여부에 따른 동적 안내 문구를 추가했습니다.
  - 가사 편집 화면과 설정 창의 `AI 정렬` / 영문 혼용 라벨을 `AI 가사 분석` · `AI 재분석` · `분석 취소` · `AI 정합` · `AI 재정합`으로 통일했습니다.
  - 곡 전환 시 가사 상태 초기화 순서를 바로잡고 가사 출처(`state.lyricsSource`)를 구분해, 미분석 곡이나 내장/외부 LRC 곡에 `AI 재분석`이 오표시되던 문제를 해결했습니다.

---

## 2026-11-24 — 메인 화면 UI·UX 정리 및 상단 창 드래그 영역 확대
- **상단 글로벌 바 창 드래그 영역 확대 (`layout.css`)**:
  - `.app-nav` 내 컨테이너(`.nav-brand`, `.nav-tabs`, `.nav-actions`, `.window-controls`)의 `no-drag`를 해제하고 실제 버튼·입력 요소에만 `no-drag`를 제한해 상단 바 빈 공간 전체에서 창 이동이 가능하도록 개선했습니다.
- **우측 하단 재생바 간소화, 대기열 토글 일원화 및 중앙 정렬 (`index.html`, `app.js`, `player-bar.css`)**:
  - 상단 바의 중복 대기열 버튼(`#navQueueToggleBtn`)을 제거하고 우측 하단 재생바에 플로팅 가사창(`#floatingButton`)·재생 대기열(`#queueToggleButton`) 아이콘 전용 버튼을 나란히 배치했습니다.
  - `.player-bar-body`를 3열 대칭 그리드(`minmax(0, 1fr) auto minmax(0, 1fr)`)로 재구성해 좌우 트랙 정보·액션 길이에 무관하게 중앙 5버튼 컨트롤이 항상 화면 정중앙에 오도록 맞췄습니다.
- **좌측 감상 패널 곡 정보 ↔ AI 제어 영역 위계 분리 및 좌우 대칭 보정 (`index.html`, `layout.css`)**:
  - 곡 메타정보와 하단 AI 상태 배지·버튼 영역(`.track-ai-section`) 사이에 여백 및 은은한 구분선(`border-top`)을 추가해 가독성을 높였습니다.
  - 감상 화면 좌측 컬럼 너비를 `272px`(`.track-copy` `max-width: 240px`)로 고정해 좌측 여백(`32px`)과 우측 구분선 앞 여백(`32px`)을 대칭으로 맞췄습니다.

---

## 2026-11-24 — AI 분석·정합 안정화, Cross-track 오염 차단 및 Gemini 멀티 모델 폴백
- **곡 전환 시 Cross-track 가사 오염 차단 (`lyrics-job-manager.js`, `app.js`, `ipc-router.js`, `transcription-worker.js`)**:
  - 분석·정합 시작 시 대상 트랙·설정·내장 가사를 스냅샷으로 고정하고 작업 토큰(`jobId`)으로 진행률·결과 이벤트를 격리해, 작업 중 곡을 넘겨도 새 곡의 가사/상태를 덮어쓰지 않고 완료된 결과만 원곡 캐시에 안전 저장하도록 개선했습니다.
  - `persistLyricsSoon()`을 트랙별 `saveTimers` 스냅샷 저장으로 전환하고, `selectPlaylistItem()`에 시퀀스 가드·자동 분석 타이머 정리·이전 작업 취소(`ffmpeg`/Whisper/Gemini/Align 통합 중단) 병행 대기를 적용했습니다.
- **AI 분석·정합 자동화 라인 및 검색·진단 강화 (`lyrics-aligner.js`, `lyrics-scraper.js`, `transcribe.py`, `layout.css`)**:
  - `autoAnalyzeMode === "align"` 시 DOM `.click()`·`500ms` 우회를 제거하고 `_runAlignment()` 직접 체이닝으로 전환했으며, 수동 1차 분석 완료 및 정합 폴백·실패 시 `AI 정합` 버튼 시각 강조(`.align-suggested`)와 재시도 안내 문구를 제공합니다.
  - LRCLIB 다중 쿼리(`아티스트 + 곡명` → `정제 곡명` → `Artist - Title` 분할), 다국어 유니코드(`\p{L}\p{N}`) 유사도 매칭·최고 유사도 후보 선택, 12초 타임아웃 및 0건 매칭 시 Whisper 안전 폴백을 적용했습니다.
  - 분석 진행 표시의 장치 안내를 `GPU` / `CPU`로 단순화했습니다.
- **Gemini 3.1 Flash-Lite 추가 및 503/429 멀티 모델 자동 폴백 (`gemini-service.js`, `index.html`, `test/alignment-pipeline.test.js`)**:
  - 설정 창 Gemini 모델 선택지에 `gemini-3.1-flash-lite`를 추가하고, `503`/`429` 과부하 발생 시 `3.5-flash-lite ↔ 3.1-flash-lite ↔ 3.8-flash` 간 자동 폴백과 상태 메시지 구분(`503` 서버 혼잡 / `429` 한도 초과)을 구현했습니다.

---

## 2026-11-22 — 경량 ONNX 보컬 분리(Vocal Separation) 전처리 & DirectML GPU 가속
- **순수 `numpy` + `onnxruntime-directml` 보컬 분리 모듈 (`src/main/services/vocal_separator.py`, `transcribe.py`)**:
  - PyTorch/Demucs 없이 `onnxruntime-directml`(`+11.13 MB`) 기반 `CUDA → DirectML(NVIDIA·AMD·Intel GPU) → CPU` 자동 가속 파이프라인을 구축해 `UVR-MDX-NET-Voc_FT.onnx`로 44.1kHz 스테레오 보컬 스템을 추출하고 `16kHz float32` 파형으로 Whisper에 전달합니다.
  - 청크 오버랩 마진을 `dim_t // 12`로 최적화해 중복 추론량을 줄였으며, 연주곡(무음 보컬) 또는 추론 오류 시 원곡으로 자동 폴백합니다.
- **메인·편집 화면 빠른 제어 및 설정 UI (`vocal-model-manager.js`, `ipc-router.js`, `preload.js`, `settings-view.js`, `lyrics-job-manager.js`)**:
  - 메인 감상 화면에 `[AI 가사 분석 / 재분석]`, `[AI 정합]` 버튼과 미니 진행률 바를 추가하고, 진행 단계 라벨을 한글 + 퍼센트(`보컬 분리 중… (35%)`) 표시로 통일했습니다.
  - 환경 설정 `AI 및 음성 분석` 탭에 **분석 전 보컬 분리(기본 OFF)** 설정과 약 64 MB ONNX 모델 설치/취소/삭제 UI를 추가했으며, 모델 설치 시 메인·편집 화면에 빠른 `보컬 분리: OFF / ON` 토글 칩이 연동됩니다.

---

## 2026-11-22 — 로컬 STT(Whisper) 초반 1분 및 음악 가사 분석 정확도 개선
- **초반 30초 `initial_prompt` 오염 제거 (`lyrics-job-manager.js`, `transcribe.py`)**:
  - 내장 가사 전체나 메타데이터 지시문(`"제목 - 가수 가사: "`)을 `initial_prompt`로 넘겨 224토큰 뒷부분(아웃트로) 절단 및 전주 환각이 발생하던 문제를 해결하고, 도입부 4줄(최대 120자) 힌트만 안전하게 전달하도록 수정했습니다.
- **곡 중반부 언어 자동 감지 및 음악용 Whisper 디코딩 파라미터 조정 (`transcribe.py`)**:
  - 언어 `자동 감지` 시 첫 30초 전주 대신 곡 중반부 30초 구간에서 먼저 보컬 언어를 탐지하도록 개선하고, 가사 누락 방지를 위해 `vad_filter=False`, 다단계 `temperature=(0.0, 0.2, 0.4, 0.6)`, `compression_ratio_threshold=2.4`, `no_speech_threshold=0.85`를 적용했습니다.
- **개발 모드 Python/FFmpeg 탐색 경로 보강 (`transcription-worker.js`, `model-manager.js`)**:
  - Conda `lyrics_player` 및 Windows Python 경로 탐색 시 `faster_whisper` 설치 여부를 검증하고, 개발 모드에서 `bin/win32/ffmpeg.exe` 및 `transcribe.exe` 폴백을 지원하도록 보강했습니다.

---

## 2026-11-22 — 오디오 메타데이터(태그) 추출 및 활용
- **FFmpeg 기반 메타데이터 추출 및 캐싱 (`media-helper.js`, `ipc-router.js`, `preload.js`)**:
  - 외부 패키지 추가 없이 `ffmpeg -hide_banner -i <파일> -f ffmetadata -` 출력에서 `title`, `artist`, `album`, `albumArtist`, `trackNumber`/`totalTracks`, `discNumber`/`totalDiscs`, `year`, `genre`, `duration`, `codec`/`bitrate`/`sampleRate`, `fileName`을 추출하고 RAM/디스크(`metadata-cache`)에 캐싱하도록 구현했습니다.
  - 기존 `localStorage` 저장 트랙도 `track:get-metadata` 지연 로드를 통해 자동으로 태그와 재생 길이를 보강합니다.
- **공통 메타 해석 유틸리티 (`src/shared/lyrics-core.js`)**:
  - 태그 유무에 따라 메타데이터 우선 적용 및 파일명 폴백을 단일화하는 `resolveTrackMeta()`를 추가했습니다.
- **UI·정렬·검색·상세 정보 모달 (`index.html`, `playlist-manager.js`, `app.js`, `playlist.css`)**:
  - 감상 화면(`#trackAlbumMeta`)에 `앨범명 · 발매 연도 · Track N` 보조 정보를 표시하고, 재생바·대기열(`Up next` 재생 길이 표시)·`MediaSession`에 실제 태그 정보를 연동했습니다.
  - 라이브러리에 **앨범**·**길이** 컬럼, 트랙 번호 배지(`.track-num-pill`), **곡 상세 정보 모달(`#trackInfoModal`)**을 추가했습니다.
  - `앨범순(앨범 → 디스크 번호 → 트랙 번호)`, `아티스트순`, `제목순`, `발매 연도순`, `재생 길이순` 정렬 및 제목·아티스트·앨범·장르·연도·파일명 통합 검색을 구현했습니다.

---

## 2026-11-22 — UI·UX 전면 개편, `ALP` 브랜딩 및 커스텀 창 제어
- **브랜딩 및 상단 내비게이션 개편**:
  - 상단 워드마크(`ALP`)와 언더라인 탭(`감상`, `라이브러리`), 강조 필 버튼(`가사 편집`)으로 화면 역할을 분리했습니다. (기존 캐시·모델 경로 유지를 위해 패키지 식별자 `auto-lyrics-player` 보존)
  - Windows 기본 검은색 `titleBarOverlay`를 제거(`frame: false`)하고, 상단 바 우측에 테마 일체형 커스텀 최소화·최대화/복원·닫기 버튼을 구현했습니다.
- **감상 화면 및 공통 재생바 재편 (Phase 1, 2)**:
  - 좌/우 카드 테두리를 걷어낸 오픈 캔버스 감상 화면(`LISTENING`), 수동 스크롤 감지 및 `[현재 가사로 이동]` 플로팅 버튼을 구현했습니다.
  - 하단 고정 공통 재생바(`#playerBar`)에 시크바/볼륨 채움 트랙, 양 끝 시간 배치, 반복 재생(`전체 / 한 곡 / 끄기`), 단색 SVG 아이콘을 적용했습니다.
- **전용 가사 편집 화면 분리 (Phase 3)**:
  - 상단 미니 커버 컨텍스트 바와 `START | LYRICS` 목록, 선택 줄 편집·전체 오프셋 조정·접이식 AI 도구 패널 및 통합 내보내기 드롭다운(`LRC / VTT / 음원 태그 내장`)을 구축했습니다.
- **라이브러리 & 인라인 대기열 서랍 분리 (Phase 4)**:
  - 독립된 라이브러리 검색/정렬/관리 테이블 뷰와 우측 인라인 도킹 재생 대기열(`Up next`, 38×38px 앨범아트 썸네일 지연 로드)을 분리했습니다.
- **디자인 시스템·테마 및 옵션 창 개선 (Phase 5)**:
  - 의미 기반 CSS 토큰(`--surface-*`, `--text-*`, `--border-subtle`, `--focus-ring`, `--status-*`)을 정비하고 듀얼 컬러 테마(`Lyra Lavender`, `Emerald Dark`) 전환을 지원했습니다.
  - 환경 설정 모달(`#settingsDialog`)을 3단 구조(헤더·세그먼트 탭·푸터)로 개편하고 배경 클릭 닫기 및 실시간 테마 미리보기를 추가했습니다.

---

## 2026-11-08 — Gemini 최신 모델 지원 및 호출 구조 단순화
- **모델 옵션 최적화**: STT/정렬 전반에 안정성이 높은 `gemini-3.5-flash-lite`(기본값), `gemini-3.8-flash` 2종으로 옵션을 정리했습니다.
- **직결 호출 및 파서 보강**: 불필요한 Fallback 재시도 루프를 걷어내 응답 지연을 줄이고, `parseTranscriptionResponse`가 JSON·SRT·LRC·코드블록 출력을 일관되게 파싱하도록 개선했습니다.

---

## 2026-11-08 — NVIDIA GPU 가속 팩(CUDA) 관리자 구현
- **온디맨드 CUDA 관리 (`cuda-manager.js`)**: NVIDIA GPU 감지 및 런타임 DLL 상태 확인, 설치/재설치/삭제, 실시간 다운로드 진행률 표시를 구현했습니다.
- **자동 폴백 안전장치 (`transcribe.py`)**: CUDA DLL 누락 또는 오류 발생 시 CPU `int8` 모드로 자동 복구되도록 이중 안전장치를 적용했습니다.

---

## 2026-11-02 — 애플리케이션 및 바이너리 용량 경량화
- **FFprobe 제거 (`lyrics-sources.js`, `setup-binaries.js`)**: 음원 메타데이터·내장 가사 추출을 `ffmpeg -f ffmetadata` 기반으로 단일화해 `ffprobe.exe` 번들(~58MB)을 제거했습니다.
- **Whisper 빌드 경량화 (`transcribe.py`, `setup-binaries.js`)**: 기본 빌드를 CPU 경량 모드로 전환해 거대 CUDA 번들(~800MB)을 분리하고, 불필요한 PyInstaller 패키지 제외 플래그를 추가했습니다.

---

## 2026-10-21 — Whisper 모델 저장소 관리자 및 온보딩 구현
- **모델 관리 (`model-manager.js`, `settings-view.js`)**: HuggingFace 캐시 조회, 모델별 설치 상태 및 용량 확인, 다운로드/삭제 아코디언 UI와 `settingModel` 설치 목록 동적 필터링을 구현했습니다.
- **첫 실행 온보딩 모달**: 앱 초기 실행 시 `large-v3-turbo`, `base`, `Gemini API` 중 AI 엔진을 선택해 바로 설정할 수 있는 온보딩 플로우를 추가했습니다.
