# Auto Lyrics Player

Auto Lyrics Player는 오디오 파일을 재생하고, AI 기반 로컬 음성 전사(STT) 기술을 사용해 노래로부터 실시간 가사 싱크를 자동으로 추출하여 보여주는 데스크톱 뮤직 플레이어입니다.

---

## 필수 설치 요구사항

이 앱은 사용 환경(일반 사용자 vs 개발자) 및 환경설정(`STT & AI` 탭)에서 선택한 음성 인식 엔진에 따라 요구사항이 다릅니다.

### 1. 일반 사용자 (배포 패키지 사용 시)
* **설치 요구사항 없음 (Zero-Dependency)**
  * 배포용 설치 마법사(`AutoLyricsPlayer Setup.exe`)를 통해 설치하는 경우, 플레이어 구동에 필요한 FFmpeg/FFprobe, 컴파일된 로컬 STT 엔진(`transcribe.exe`), 그리고 GPU 가속에 필요한 NVIDIA CUDA/cuDNN 필수 DLL 라이브러리가 모두 기본으로 내장되어 배포됩니다.
  * 따라서 일반 사용자는 Python, FFmpeg 등을 수동으로 설치하지 않고도 로컬 Whisper(CPU 및 CUDA GPU 가속) 분석과 Gemini 클라우드 분석 기능을 즉시 사용할 수 있습니다.

### 2. 개발 및 소스 빌드 환경
소스 코드를 클론하여 로컬에서 개발하거나 직접 빌드 패키징하려는 경우 다음 도구들이 필요합니다.

* **FFmpeg & FFprobe**:
  * 빌드 및 실행 시 `scripts/setup-binaries.js` 스크립트가 시스템 환경변수(PATH) 또는 WinGet 패키지 경로를 검색하여 자동으로 복사합니다. 만약 로컬에 존재하지 않는 경우, 스크립트가 공식 Gyan.FFmpeg 바이너리를 웹에서 자동으로 다운로드하여 배치하므로 수동 설치 과정이 생략됩니다.
* **Python 3.9 이상**:
  * 로컬 STT 분석 스크립트(`transcribe.py`) 실행 및 빌드를 위해 필요합니다. 파이썬 설치 시 **"Add python.exe to PATH"** 옵션을 반드시 체크해 주십시오.
  * PyInstaller 빌드 스크립트가 Conda 환경명을 참조하므로, Conda 환경을 사용하는 경우 가상환경 이름을 **`lyrics_player`**로 구성하는 것을 권장합니다.
  * 터미널에서 아래 명령어를 실행하여 필수 모듈들을 설치합니다.
    ```bash
    pip install faster-whisper ctranslate2 pyinstaller
    ```

* **Gemini API (클라우드 분석) 사용 시**:
  * 별도의 로컬 AI 구동 환경(Python 등)이 필요하지 않습니다. 설정창(`STT & AI` 탭)에서 사용자의 Gemini API Key만 입력하면 바로 사용 가능합니다.

---

## 로컬 실행 방법

1. 소스 코드를 내려받은 후, 프로젝트 루트 폴더에서 의존성 패키지를 설치합니다.
   ```bash
   npm install
   ```

2. 플레이어를 실행합니다.
   ```bash
   npm start
   ```

---

## 주요 기능 및 사용법

### 1. 오디오 재생 및 목록 관리
* MP3, WAV, FLAC, M4A 등 다양한 오디오 파일을 추가하여 재생할 수 있습니다.
* 파일 내장 앨범 아트를 자동으로 추출해 화면에 표시해 줍니다.

### 2. 원클릭 AI 가사 분석 (Analyze)
* 가사가 없는 곡을 로드한 뒤 Analyze 버튼을 누르면 인공지능 기반 가사 전사(STT)가 수행됩니다.
* **로컬 분석 (Local Whisper)** 또는 **클라우드 분석 (Gemini API - gemini-3.1-flash-lite, gemini-3.5-flash 등)** 중 원하는 엔진을 선택하여 구동할 수 있습니다.
* 실시간 전사 진행률(%)이 표시되며 완료 시 타임스탬프를 획득합니다.

### 3. Whisper Device (STT 가속 장치) 설정 지원
* 로컬 Whisper 엔진을 사용할 때 연산을 담당할 하드웨어 장치를 직접 선택할 수 있습니다.
  * **Auto-detect (기본값)**: NVIDIA CUDA GPU 환경이 감지되면 GPU(float16)로 고속 구동하며, 실패하거나 지원되지 않는 경우 CPU(int8)로 자동 안전하게 폴백합니다.
  * **CPU Only**: GPU를 강제로 사용하지 않고 오직 CPU 연산으로만 분석을 수행합니다. (저사양 시스템이거나 분석 중 다른 그래픽 부하 작업을 원활히 병행할 때 유용)
  * **GPU Only (CUDA)**: CUDA GPU 가속을 강제로 사용하도록 지정합니다. (CUDA를 지원하지 않는 시스템에서는 구동 시 에러가 발생합니다)

### 4. AI 가사 싱크 정밀 대조 (AI Align / Realign)
* 오디오에서 받아온 타임스탬프 정보와 음원에 내장된 평문(텍스트) 가사를 대조하여 정밀한 타임라인 싱크를 완성하는 하이브리드 파이프라인을 지원합니다.
* 사용자가 선택한 제미나이 모델(기본값: **Gemini 3.1 Flash-Lite** 또는 고성능 **Gemini 3.5 Flash**)을 연동하여 다국어 발음/시맨틱 유사성 등을 고려해 매핑을 수행합니다.
* 1차 분석 시에도 음원의 실제 재생 길이(Duration) 정보를 프롬프트 가이드라인으로 주입하여, 생성된 타임스탬프가 음원 길이를 초과하지 않도록 안전하게 가드 처리하였습니다.
* 반복되는 가사(1절/2절 후렴 등)가 동일한 타임스탬프를 복사해 와 싱크가 꼬이는 것을 방지하기 위해 중복 할당 제거 후처리(Deduplication)를 거쳐 자연스럽게 선형 보간 시스템으로 가사를 인계합니다.
* AI Realign(재정합) 시, 1차 정합된 가사 라인별 기존 타임스탬프 범위(`[시작 시간 ~ 종료 시간]`)를 Gemini 프롬프트에 동봉해 피드백으로 던집니다. AI가 이 시간축의 흐름을 적극 활용해 싱크 오차와 반복 구절의 시간대를 더 정밀하게 교정합니다.

### 5. 화면 투명 플로팅 가사
* 항상 화면 맨 위에 떠 있는 투명 가사 창을 지원합니다.
* 가사가 없는 빈 영역을 마우스로 클릭하면 클릭이 관통되어 뒤에 있는 웹브라우저나 프로그램들을 그대로 조작할 수 있습니다.

### 6. 가사 편집 및 싱크 오프셋
* 가사 텍스트를 플레이어 내에서 즉시 수정할 수 있는 편집(Edit) 모드를 제공합니다.
* 단축키나 버튼을 이용해 가사의 속도를 0.1초 혹은 0.5초 단위로 미세하게 앞당기거나 늦출 수 있습니다.

---

## 배포 및 패키징 방법

앱을 설치 가능한 실행 파일로 빌드하려면 아래 명령어를 실행합니다.
```bash
npm run build
```

이 명령어는 내부적으로 `node scripts/setup-binaries.js` 스크립트를 거쳐 아래의 자동화된 빌드 과정을 순차적으로 수행합니다:

1. **바이너리 수집 및 경량화**: FFmpeg 및 FFprobe 파일을 로컬 환경에서 감지하거나 없으면 공식 릴리즈를 자동 다운로드하여 `bin/win32`에 적재합니다. 이후 배포 패키지 용량 최적화를 위해 **UPX 압축 필터**를 사용해 실행 파일의 용량을 경량화합니다.
2. **GPU 가속용 필수 DLL 선별 추출**: Conda 가상환경(`lyrics_player`)을 조회하여, 로컬 Whisper가 GPU(CUDA) 가속을 정상적으로 수행할 때 반드시 필요한 핵심 DLL(cuBLAS, cuDNN, zlibwapi 등)만 Whitelist 방식으로 선별 추출하여 패키징에 포함시킵니다. (GPU 구동 관련 라이브러리 미인식 문제 해결 및 배포 용량 절감 효과)
3. **STT 엔진 컴파일**: `transcribe.py` 파일의 최종 수정 일시(mtime)를 검사하여 소스 코드가 업데이트되었을 때만 PyInstaller를 통해 독립 실행 파일 `transcribe.exe`로 자동 컴파일합니다.
4. **NSIS 설치 마법사 패키징**: 최종적으로 `electron-builder`를 사용하여 **NSIS 설치 마법사 프로그램(`AutoLyricsPlayer Setup 0.3.1.exe`)**을 생성합니다.
   * 원클릭 설치가 아닌 사용자가 직접 설치 경로를 지정할 수 있는 기능을 제공합니다.
   * 바탕화면 바로가기 및 시작메뉴 단축아이콘 생성을 완벽히 지원합니다.

---

## 📂 프로젝트 폴더 및 파일 구조

프로젝트는 코드 가독성과 단일 책임 원칙(SRP)을 준수하기 위해 **메인(Main) 프로세스** 및 **렌더러(Renderer) 프로세스** 모두 완벽한 모듈식 리팩토링이 완료되어 있습니다.

```
music-player/
│
├── package.json               # Electron 의존성 및 빌드/실행 스크립트 정의
├── scripts/                   # 빌드 및 의존성 바이너리 준비 자동화 스크립트 영역
│   ├── setup-binaries.js      # FFmpeg/FFprobe 탐색 및 UPX 압축, PyInstaller 빌드 오케스트레이터
│   └── copy-nvidia-dlls.py    # Conda 환경에서 로컬 GPU 가속용 CUDA/cuDNN 필수 DLL 추출기
│
└── src/
    ├── main/                  # Electron 메인 프로세스 영역 (Core Shell)
    │   ├── main.js            # 메인 프로세스 시작점 (core 모듈들을 부트스트랩하여 기동)
    │   ├── preload.js         # Renderer와 Main 간 안전한 Context Bridge 연결 통로
    │   │
    │   ├── core/              # Electron 시스템 아키텍처 및 쉘 관리 레이어
    │   │   ├── window-manager.js     # Electron 윈도우 인스턴스 생성 및 프레임 생명주기 관리
    │   │   └── ipc-router.js         # 메인 프로세스 측 모든 IPC 채널 이벤트 등록 및 라우팅 위임
    │   │
    │   ├── services/          # 외부 API 및 대형 연동 서비스 엔진
    │   │   ├── gemini-service.js     # Gemini API 호출 및 가사 정합 파이프라인
    │   │   ├── gemini-prompts.js     # Gemini STT 및 정합 관련 시스템 프롬프트(systemInstruction) 분리 보관
    │   │   ├── lyrics-scraper.js     # DuckDuckGo HTML 검색 기반 공식 가사 스크래퍼
    │   │   ├── lyrics-sources.js     # 로컬 파일 가사 (.lrc / 음원 태그 내장 가사) 리더 파이프라인
    │   │   ├── transcription-worker.js # Python STT 서브프로세스 제어 분석기
    │   │   └── transcribe.py         # faster-whisper 기반 로컬 음성인식 파이썬 스크립트
    │   │
    │   └── helpers/           # 로컬 유틸리티 및 데이터 처리 헬퍼
    │       ├── cache-manager.js      # 가사 파일 로컬 캐싱 및 디렉토리 관리
    │       ├── settings-manager.js   # 환경설정 파일 및 플로팅 창 좌표 관리
    │       ├── media-helper.js       # ffmpeg 이용 오디오 앨범아트 추출
    │       └── lyrics-aligner.js     # 정합 보간 및 시간 병합 핵심 알고리즘 격리
    │
    ├── renderer/              # 사용자 화면(UI) 렌더러 프로세스 영역
    │   ├── index.html         # 메인 플레이어 UI 구조 및 리팩토링 모듈 로드
    │   ├── app.js             # 메인 조정자 (Orchestrator) 쉘 (모듈 연동 및 IPC 브릿징)
    │   ├── styles.css         # 수입 모듈 스타일들을 @import로 통합 호출하는 마스터 스타일시트
    │   ├── floating.html      # 플로팅 가사 전용 창 UI
    │   ├── floating.js        # 플로팅 가사창 마우스 감지 제어 및 렌더링
    │   │
    │   ├── css/               # 모듈화되어 분리된 영역별 스타일시트
    │   │   ├── variables.css         # 테마 색상 변수, 폰트 및 공통 태그 리셋 스타일
    │   │   ├── layout.css            # 메인 플레이어 레이아웃 프레임, 재생 제어반 및 분석 진행바
    │   │   ├── playlist.css          # 플레이리스트 영역, 정렬/검색 및 크기 리사이저
    │   │   ├── lyrics.css            # 가사 뷰어 리스트, 싱크 하이라이트 및 시간 싱크 편집 컨트롤
    │   │   ├── settings.css          # 설정 창 모달, 내부 탭 양식 및 단축키 캡처 스타일
    │   │   └── floating.css          # 투명 플로팅 가사창 전용 CSS
    │   │
    │   └── modules/           # app.js에서 분리된 전역 UI 컴포넌트 클래스
    │       ├── player-controller.js  # HTML5 Audio 재생, 볼륨, 탐색 및 미디어세션 바인딩
    │       ├── playlist-manager.js   # 재생 목록 관리, 정렬, 검색 및 파일 드롭 수신
    │       ├── lyrics-viewer.js      # 가사 출력, 스크롤 하이라이팅 및 인라인 텍스트 에디터
    │       ├── lyrics-job-manager.js # 비동기 음성 인식(STT) 및 가사 정합(Align) 잡 스케줄링 및 UI 진행도 제어
    │       └── settings-view.js      # 다이얼로그 모달 제어 및 폼 옵션 저장
    │
    ├── shared/                # 공통 유틸리티 영역
    │   └── lyrics-core.js     # 싱크 검색, HTML 이스케이프(escapeHtml), LRC/WebVTT 포맷 변환 공통 로직
    │
    └── assets/                # 앱 아이콘 및 리소스 디렉토리
```
```
