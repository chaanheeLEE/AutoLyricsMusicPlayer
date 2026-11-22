# Updated — Auto Lyrics Player (ALP)

완료된 주요 업데이트 내역을 최신순(내림차순)으로 정리한 문서입니다.

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
