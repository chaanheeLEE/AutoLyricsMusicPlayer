# Auto Lyrics Player

<p align="center">
  <img src="src/assets/app.png" alt="Auto Lyrics Player App Screenshot" width="100%" />
</p>

Auto Lyrics Player는 로컬 음원을 재생하며, AI 음성 인식(STT) 기술을 활용해 실시간 동기화 가사(Timeline)를 자동으로 생성하고 편집할 수 있는 데스크톱 뮤직 플레이어입니다.

---

## 주요 기능

### 1. 하이브리드 AI 가사 생성 (STT)
- **로컬 Faster-Whisper 엔진**: 오프라인 환경에서도 로컬 AI 모델을 통해 음원을 분석하고 타임스탬프 가사를 추출합니다.
- **클라우드 Gemini 엔진**: Google Gemini 최신 모델(`gemini-3.5-flash-lite`, `gemini-3.8-flash`)을 연동하여 지연 없이 빠른 속도로 고품질 자막 세그먼트를 추출합니다.
- **음원 내장 메타데이터 지원**: 음원 파일에 이미 기록된 가사가 있는 경우 이를 우선 추출하여 불필요한 AI 연산을 줄입니다.

### 2. Gemini 기반 정밀 가사 정합 (AI Align)
- 음원의 공식 텍스트 가사와 AI 음성 인식 타임라인을 대조하여, 누락이나 오인식 없이 노래 박자에 정확히 맞는 싱크 가사를 자동 완성합니다.

### 3. 온디맨드 GPU 가속 팩 (CUDA) 관리자
- **설치 프로그램 경량화**: 기본 배포 파일에서 수백 MB에 달하는 거대 CUDA 번들을 분리하여 기본 패키지 용량을 대폭 줄였습니다.
- **원클릭 설치 및 관리**: NVIDIA 그래픽 카드를 사용하는 환경에서는 설정 메뉴에서 클릭 한 번으로 GPU 가속 팩을 다운로드, 설치, 삭제, 재설치할 수 있습니다.
- **런타임 안전 Fallback**: 시스템에 CUDA DLL이 누락되어도 에러로 중단되지 않고 즉시 CPU 모드로 안전하게 전환되어 안정적인 작동을 보장합니다.

### 4. 데스크톱 투명 플로팅 가사창
- 다른 프로그램(작업, 게임, 웹 브라우징 등)을 사용하는 중에도 항상 화면 최상단에 투명한 싱크 가사를 띄울 수 있습니다.
- **마우스 관통 모드**: 가사가 표시되지 않는 빈 공간을 클릭하면 마우스 입력이 뒤쪽 창으로 통과되어 작업 방해 없이 가사를 감상할 수 있습니다.
- 폰트 크기, 투명도, 가사 색상, 정렬 위치를 자유롭게 커스터마이징할 수 있습니다.

### 5. 정밀 가사 편집기 및 태그 내장 (Embed)
- **0.1초 / 0.5초 정밀 싱크 조절**: 단축 버튼 및 타임스탬프 편집을 통해 박자에 맞추어 미세 조정을 수행할 수 있습니다.
- **음원 파일 직접 저장 (Embed Lyrics)**: 편집 및 완성된 동기화 가사를 MP3, FLAC, M4A 등 오디오 파일의 ID3/메타데이터 태그에 직접 영구 기록할 수 있습니다.
- **캐시 관리**: 개별 곡 단위로 AI 생성 가사 캐시를 손쉽게 초기화하고 재분석할 수 있습니다.

---

## 설치 및 실행 방법

### 일반 사용자 (Windows 설치 파일)
1. **[GitHub Releases](https://github.com/chaanheeLEE/AutoLyricsMusicPlayer/releases)** 페이지로 이동합니다.
2. 최신 버전(`v1.0.2` 이상)의 **`AutoLyricsPlayer-Setup.exe`** 설치 파일을 다운로드하여 실행합니다.
3. 별도의 Python 환경 설정 없이 즉시 실행하여 사용할 수 있습니다.

### 개발자 환경 (소스 코드 빌드 및 실행)

```bash
# 1. 저장소 클론
git clone https://github.com/chaanheeLEE/AutoLyricsMusicPlayer.git
cd AutoLyricsMusicPlayer

# 2. 의존성 패키지 설치
npm install

# 3. 개발 모드로 실행
npm start

# 4. 정적 구문 검사 및 단위 테스트
npm run check
npm test

# 5. 프로덕션 빌드 (Windows 패키징)
npm run build
```

---

## 권장 환경 및 설정 가이드

### 1. Gemini API 키 연동 (선택 사항, 권장)
- 플레이어 우측 상단 **설정 (Settings) > STT & AI** 탭에서 Google AI Studio에서 무료 발급받은 Gemini API Key를 입력합니다.
- 대용량 음원도 수 초 만에 분석할 수 있으며, 정밀 싱크 정합(AI Align) 기능을 사용할 수 있습니다.
- 모델 선택 드롭다운에서 `gemini-3.5-flash-lite`(기본값, 빠른 속도) 또는 `gemini-3.8-flash`(고정밀)를 필요에 따라 선택할 수 있습니다.

### 2. NVIDIA GPU 가속 활용
- NVIDIA 외장 그래픽 카드가 장착된 PC의 경우, **설정 > STT & AI** 메뉴 하단의 **GPU 가속 팩** 영역에서 `[GPU 가속 팩 설치]` 버튼을 누르면 Whisper 음성 인식 속도가 수 배 이상 향상됩니다.
