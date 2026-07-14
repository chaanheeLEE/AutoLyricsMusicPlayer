# Auto Lyrics Player

Auto Lyrics Player는 오디오 파일을 재생하고, AI 기반 로컬 음성 전사(STT) 기술을 사용해 노래로부터 실시간 가사 싱크를 자동으로 추출하여 보여주는 데스크톱 뮤직 플레이어입니다.

---

## 필수 설치 요구사항

이 앱은 환경설정(STT & AI)에서 선택한 음성 인식 엔진에 따라 필요한 외부 도구가 다릅니다.

* **Local Whisper (로컬 오프라인 분석) 사용 시 (권장)**:
  * 로컬에서 직접 AI 모델을 구동하기 위해 아래 외부 도구들이 필요합니다.
  *(참고: 무설치 단일 실행 파일(`.exe`)로 빌드하여 배포하는 경우, FFmpeg은 빌드 시 자동으로 패키징에 내장되므로 사용자는 **Python** 및 **`faster-whisper`**만 설치하면 됩니다.)*
* **Gemini API (클라우드 분석) 사용 시**:
  * 외부 설치 요구사항이 **없습니다**. 설정창(`STT & AI` 탭)에서 Gemini API Key만 입력하면 즉시 초고속 클라우드 분석이 가능합니다.

### 1. FFmpeg 설치 (로컬 Whisper 개발 환경 전용)
윈도우 환경에서 터미널(PowerShell 또는 CMD)을 열고 아래 명령어를 입력하여 설치합니다.
```bash
winget install Gyan.FFmpeg
```
설치 완료 후, 환경변수(PATH)가 정상적으로 반영되도록 실행 중인 터미널이나 에디터를 재시작해 주십시오.

### 2. Python 및 필수 패키지 설치
컴퓨터에 Python(버전 3.9 이상 권장)이 설치되어 있어야 합니다. 파이썬 설치 시 **"Add python.exe to PATH"** 옵션을 반드시 체크해 주십시오.

그 후, 터미널에서 아래 명령어를 실행하여 음성 인식 핵심 모듈을 설치합니다.
```bash
pip install faster-whisper
```

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
* **로컬 분석 (Local Whisper)** 또는 **클라우드 분석 (Gemini API - 기본값 gemini-3.1-flash-lite 및 gemini-3.5-flash 선택 가능)** 중 원하는 엔진을 선택하여 구동할 수 있습니다.
* 실시간 전사 진행률(%)이 표시되며 완료 시 타임스탬프를 획득합니다.

### 3. AI 가사 싱크 정밀 대조 (AI Align)
* 오디오에서 받아온 타임스탬프 정보와 음원에 내장된 평문(텍스트) 가사를 대조하여 정밀한 타임라인 싱크를 완성하는 하이브리드 파이프라인을 지원합니다.
* 사용자가 선택한 제미나이 모델(기본값: **Gemini 3.1 Flash-Lite** 또는 고성능 **Gemini 3.5 Flash**)을 연동하여 다국어 발음/시맨틱 유사성 등을 고려해 매핑을 수행합니다.
* 1차 분석 시에도 음원의 실제 재생 길이(Duration) 정보를 프롬프트 가이드라인으로 주입하여, 생성된 타임스탬프가 음원 길이를 초과하지 않도록 안전하게 가드 처리하였습니다.
* 반복되는 가사(1절/2절 후렴 등)가 동일한 타임스탬프를 복사해 와 싱크가 꼬이는 것을 방지하기 위해 중복 할당 제거 후처리(Deduplication)를 거쳐 자연스럽게 선형 보간 시스템으로 가사를 인계합니다.
* AI Realign(재정합) 시, 1차 정합된 가사 라인별 기존 타임스탬프 범위(`[시작 시간 ~ 종료 시간]`)를 Gemini 프롬프트에 동봉해 피드백으로 던집니다. AI가 이 시간축의 흐름을 적극 활용해 싱크 오차와 반복 구절의 시간대를 더 정밀하게 교정합니다.

### 4. 화면 투명 플로팅 가사
* 항상 화면 맨 위에 떠 있는 투명 가사 창을 지원합니다.
* 가사가 없는 빈 영역을 마우스로 클릭하면 클릭이 관통되어 뒤에 있는 웹브라우저나 프로그램들을 그대로 조작할 수 있습니다.

### 5. 가사 편집 및 싱크 오프셋
* 가사 텍스트를 플레이어 내에서 즉시 수정할 수 있는 편집(Edit) 모드를 제공합니다.
* 단축키나 버튼을 이용해 가사의 속도를 0.1초 혹은 0.5초 단위로 미세하게 앞당기거나 늦출 수 있습니다.

---

## 배포 및 패키징 방법

타인에게 공유할 수 있는 무설치 단일 실행 파일(.exe)로 빌드하려면 아래 명령어를 실행합니다.
```bash
npm run build
```
빌드가 완료되면 프로젝트 루트에 `dist/` 폴더가 생성되며, 그 내부에 `AutoLyricsPlayer 0.1.0.exe` 파일이 위치하게 됩니다.

> **주의 사항**
> * 만약 사용자가 설정에서 **Gemini API** 엔진을 선택해 사용한다면 Python 등의 추가 설치가 전혀 필요하지 않습니다. (무설치 즉시 사용 가능)
> * 만약 **Local Whisper** 엔진을 사용하는 경우, 배포 대상자의 PC에도 **Python** 및 **`faster-whisper` 패키지**가 설치되어 있어야 분석 기능이 정상 작동합니다. (FFmpeg은 빌드 시 실행 파일 내부에 동봉되어 함께 패키징되므로 배포 대상자가 따로 설치할 필요가 없습니다.)

---

## 📂 프로젝트 폴더 및 파일 구조

프로젝트는 코드 가독성과 단일 책임 원칙(SRP)을 준수하기 위해 **메인(Main) 프로세스** 및 **렌더러(Renderer) 프로세스** 모두 완벽한 모듈식 리팩토링이 완료되어 있습니다.

```
music-player/
│
├── package.json               # Electron 의존성 및 빌드/실행 스크립트 정의
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
