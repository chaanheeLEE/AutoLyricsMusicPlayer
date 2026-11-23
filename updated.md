# Updated — Auto Lyrics Player (ALP)

완료된 주요 업데이트 내역을 최신순(내림차순)으로 정리한 문서입니다.

---

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
- **우측 하단 재생바 간소화 (`index.html`, `app.js`, `player-bar.css`)**:
  - 상단 바와 중복되는 하단 대기열 버튼(`#queueToggleButton`)을 제거하고, 플로팅 가사창 버튼(`#floatingButton`)을 텍스트 없는 아이콘 전용 버튼으로 정리했습니다.
- **좌측 감상 패널 곡 정보 ↔ AI 제어 영역 위계 분리 (`index.html`, `layout.css`)**:
  - 곡 메타정보와 하단 AI 상태 배지·버튼 영역(`.track-ai-section`) 사이에 여백 및 은은한 구분선(`border-top`)을 추가해 가독성을 높였습니다.

---

## 2026-11-24 — AI 분석·정합 안정화, Cross-track 오염 차단 및 Gemini 멀티 모델 폴백
- **곡 전환 시 Cross-track 가사 오염 차단 (`lyrics-job-manager.js`, `app.js`, `ipc-router.js`, `transcription-worker.js`)**:
  - 분석·정합 시작 시 대상 트랙·설정·내장 가사를 스냅샷으로 고정하고 작업 토큰(`jobId`)으로 진행률·결과 이벤트를 격리해, 작업 중 곡을 넘겨도 새 곡의 가사/상태를 덮어쓰지 않고 완료된 결과만 원곡 캐시에 안전 저장하도록 개선했습니다.
  - `persistLyricsSoon()`을 트랙별 `saveTimers` 스냅샷 저장으로 전환하고, `selectPlaylistItem()`에 시퀀스 가드·자동 분석 타이머 정리·이전 작업 취소(`ffmpeg`/Whisper/Gemini/Align 통합 중단) 병행 대기를 적용했습니다.
- **AI 분석·정합 자동화 라인 및 검색·진단 강화 (`lyrics-aligner.js`, `lyrics-scraper.js`, `transcribe.py`, `layout.css`)**:
  - `autoAnalyzeMode === "align"` 시 DOM `.click()`·`500ms` 우회를 제거하고 `_runAlignment()` 직접 체이닝으로 전환했으며, 수동 1차 분석 완료 시 `AI 정합` 버튼 시각 강조(`.align-suggested`)와 안내 문구를 제공합니다.
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
