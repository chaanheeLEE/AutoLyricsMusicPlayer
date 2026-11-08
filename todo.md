# 📋 Auto Lyrics Player — Todo

## 📌 남은 기능 구현
- 더 많은 플레이리스트 정렬방식 (앨범명→ 앨범내 곡 번호, 커스텀 정렬 저장 가능)
- 플레이리스트 저장 및 불러오기
- Gemini 최신 모델로 Transcribe 및 Align 업데이트

---

## ✅ 완료된 작업

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