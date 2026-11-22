# 📋 Auto Lyrics Player — Todo

## 🎨 UI·UX 구조 개선 프로젝트 (music-player-ui-ux-plan.md)

### Phase 1: 하단 공통 재생바(Persistent Player Bar) 분리
- [x] 하단 고정 공통 재생바 마크업 (`#playerBar`) 및 스타일링 (`player-bar.css`)
- [x] 재생 진행 막대(SeekBar) 상단 배치 및 시간(0:00 / 0:00) 연동
- [x] 미니 트랙 정보(앨범 커버, 곡 제목, 아티스트) 실시간 동기화
- [x] 재생·일시정지(주요 시각적 강조), 이전, 다음, 셔플, 볼륨, 플로팅 가사 컨트롤 이관
- [x] 기존 좌측 패널의 중복 재생 조작 제거 및 화면 전환 시 재생 연속성 확보

### Phase 2: 중앙 뷰 전환 구조 및 감상 화면(Now Playing View) 재편
- [x] 상단 내비게이션 바 구현 ([감상] / [라이브러리] 탭, [가사 편집], [대기열], [설정])
- [x] 감상 화면 정돈: 큰 앨범 커버 + 곡 제목/아티스트 구분 표시 (카드 테두리 제거)
- [x] 순수 가사 중심 뷰: 가사 행별 카드 테두리 및 타임스탬프 제거, 타이포그래피 중심 강조
- [x] 수동 스크롤 감지 및 `[현재 가사로 이동]` 플로팅 버튼 구현
- [x] 긴 곡 제목 및 메타데이터 없는 파일명 깔끔한 처리

### Phase 3: 독립된 가사 편집 화면(Lyrics Edit View) 구축
- [x] 중앙 콘텐츠 영역을 전용 편집 화면으로 전환하는 구조 구현
- [x] 상단 바: `[← 감상으로 돌아가기]`, 곡 제목, `[완료/저장]`, `[내보내기 ▼]` 통합 드롭다운(LRC/VTT/음원 태그)
- [x] 좌측: 타임스탬프 + 가사 텍스트 목록 패널
- [x] 우측 패널 1: `선택한 줄 편집` (텍스트, 시작 시각, 0.1s/0.5s 미세 조정)
- [x] 우측 패널 2: `곡 전체 싱크 조정` (전체 오프셋 ±0.5s/±0.1s, 싱크 리셋)
- [x] 우측 패널 3: `AI 분석 도구` (Analyze, AI Align, 프로그레스 바)

### Phase 4: 라이브러리 화면 & 우측 슬라이드 대기열(Queue Drawer) 분리
- [ ] 우측 슬라이드 서랍형 재생 대기열(Queue Drawer) 구현 (가사 영역과의 공간 경쟁 해소)
- [ ] 대기열 항목 조작 (대기열에서 제거 vs 라이브러리에서 제거 동작 분리)
- [ ] 독립된 `라이브러리(Library)` 탭 구현 (전체 음원 검색, 정렬, 추가, 상태 테이블)

### Phase 5: 공통 디자인 시스템 및 의미 기반 토큰 정리
- [ ] 계획서 8절에 따른 의미 기반 CSS 변수 정비 (`--surface-*`, `--text-*`, `--border-*`)
- [ ] 여백(8px / 16px / 24px / 32px), 컴포넌트 높이, 폰트 위계, 포커스 링 일관화

---

## 📌 일반 기능 구현 과제
- 더 많은 플레이리스트 정렬방식 (앨범명→ 앨범내 곡 번호, 커스텀 정렬 저장 가능)
- 플레이리스트 저장 및 불러오기

---

## ✅ 완료된 작업

### Gemini 최신 모델(3.5-flash-lite / 3.8-flash) 지원 및 구조 단순화 (2026-11-08)
- **UI 및 기본 설정 단순화**: STT/정렬 전반에 가장 안정적이고 뛰어난 성능을 보이는 `gemini-3.5-flash-lite`(기본값), `gemini-3.8-flash` 2종 옵션 반영 (`gemini-3.5-transcribe`는 Developer Instruction 미지원 등 제약으로 배제)
- **Fallback 걷어내기 및 즉시 직결 호출**: 불필요한 모델 재시도 루프와 분기 처리를 제거하고, 사용자가 선택한 모델로 딜레이 없이 즉시 직결 호출되도록 간소화
- **안전한 응답 파서 구축**: `parseTranscriptionResponse`를 통해 표준 JSON뿐만 아니라 SRT, LRC, 마크다운 코드블록, 타임스탬프 텍스트 출력까지 견고하게 정규화 파싱

### GPU 가속 팩(CUDA) 관리자 구현 (2026-11-08)
- `cuda-manager.js` 신규 생성: 시스템 NVIDIA GPU 및 런타임 DLL 상태 감지, 온디맨드 다운로드, 자동 압축 해제, 삭제 기능
- `ipc-router.js` & `preload.js`: `cuda:status`, `cuda:download`, `cuda:cancel-download`, `cuda:delete` IPC 채널 및 렌더러 API 노출
- `settings-view.js` & `settings.css` & `index.html`: 설정 화면 "Whisper 가속 장치" 아래에 실시간 상태 뱃지, 실시간 다운로드 프로그레스 바, **`[GPU 가속 팩 설치]`**, **`[재설치]`**, **`[삭제]`** 버튼 구현
- `transcribe.py`: 지연 로딩(Lazy Loading)으로 인한 cuBLAS DLL 누락 사전 검사 및 런타임 CPU 자동 복구 Fallback 이중 안전장치 적용

### 애플리케이션 및 바이너리 용량 경량화 (2026-11-02)
- **FFprobe 제거 및 메타데이터 추출 단일화**:
  - `lyrics-sources.js`: 음원 내장 가사 태그 추출 방식을 `ffprobe`에서 `ffmpeg -f ffmetadata` 표준 출력 파서로 교체
  - `setup-binaries.js`: `ffprobe.exe` 다운로드/복사 및 번들링 제외 (~58MB 즉시 절감)
- **`transcribe.exe` CUDA DLL 번들 분리 및 경량화**:
  - `transcribe.py`: 외부 CUDA 및 AppData 경로 동적 탐색 기능 추가 (시스템 CUDA 또는 외부 DLL 자동 인식, 미설치 시 CPU `int8` 모드로 안정적 폴백)
  - `setup-binaries.js`: 기본 빌드를 CPU 경량 모드로 변경 (거대 CUDA/cuDNN 번들 제외하여 ~800MB 절감, 필요 시 `--with-cuda` 플래그로 빌드 가능)
  - PyInstaller 불필요 모듈(`tkinter`, `matplotlib`, `scipy`, `unittest`, `test`, `pydoc`) 제외 플래그 추가

### Whisper 모델 관리 기능 (2026-10-21)
- `model-manager.js` 신규 생성: HuggingFace 캐시 경로 조회, 모델 설치 상태 확인, 다운로드, 삭제 기능
- `transcribe.py` `--download_only` 플래그 추가
  - 기존 `download_model()` → `huggingface_hub.snapshot_download()` + tqdm 훅으로 교체
  - 실시간 파일별 다운로드 진행률(`percent`, `downloadedBytes`, `totalBytes`) emit
  - `ImportError` / 네트워크 오류 세분화 처리
- `settingModel` 드롭다운: 설치된 모델만 크기 오름차순으로 동적 표시 (미설치 모델 선택 불가)
- 모델 관리자 UI: 설정창 STT & AI 탭에 접이식 아코디언 토글(`model-manager-accordion`)로 모델 관리자 배치 (필요할 때만 펼쳐 디스크 용량 및 설치/삭제 관리 가능)
- 첫 실행 온보딩 모달: `large-v3-turbo` / `base` / Gemini 선택 후 즉시 다운로드
- `firstRunCompleted` 설정 필드 추가
- IPC 채널: `models:list`, `models:download`, `models:cancel-download`, `models:delete`
- `preload.js` API 노출: `listModels`, `downloadModel`, `deleteModel`, `onModelDownloadProgress`