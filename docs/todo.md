# Todo — Auto Lyrics Player (ALP)

향후 추가하거나 개선할 기능 및 과제를 **주제별로 묶고 우선순위(`[P0]`~`[P3]`) 순으로 정렬**한 목록입니다. (완료된 내역은 [updated.md](../updated.md) 및 [CHANGELOG.md](../CHANGELOG.md) 참고)

## 버전 로드맵 요약
- **`v1.1.0`** *(배포 완료)*: `[P0]`·`[P1]` AI 분석·정합 안정화, UI·UX 전면 개선, 셔플 덱·프리페치 복구, CI/자동 릴리즈 파이프라인
- **`v1.1.1`** *(진행 중)*: UI·UX 마감(완료), Gemini 프롬프트·후처리 안정화(완료), 평문 가사 자동 확보 고도화(완료), **핵심 코드 아키텍처 리팩토링**(섹션 6 `[P2]`)
- **`v1.2.0`**: 라이브러리·재생 대기열 분리, 플레이리스트·폴더 입출력, 라이브러리 평문 가사 일괄 채우기 & 외부 다중 소스 폴백(섹션 1 `[P2]` + 섹션 3)
- **`v1.3.0`**: AI 정합 속도·정확도 최적화, 가사 편집기 기능 확장 및 텍스트 기반 강제 정렬(섹션 1 `[P2]` + 섹션 4)
- **`v1.4.0`**: 플로팅 가사창·데스크톱 통합 및 테마 확장(섹션 5 + 섹션 2 `[P3]`)

---

## 1. AI 분석·정합 파이프라인 및 자동화
- [x] **평문 가사 자동 확보 고도화 및 로컬 `.txt` 사이드카 지원 (`lyrics-scraper.js`, `lyrics-sources.js`, `cache-manager.js`, `lyrics-aligner.js`, `lyrics-job-manager.js`, `app.js`)**:
  - `artist`·`title`·`duration` 기반 LRCLIB `/api/get` 정확 조회 우선 및 `/api/search` 후보 선택 시 `duration` 차이·유사도 복합 점수로 TV Size·리믹스 오매칭 감소 (`updated.md` 참고)
  - 확보한 공식 평문 가사를 트랙 캐시(`embeddedPlainLyrics`)에 재사용 가능하게 보관해 재시도·재정합 시 반복 조회 최소화 (`updated.md` 참고)
  - 음원 파일과 동일 폴더의 `<파일명>.txt` 평문 가사 파일 자동 인식(`lyrics-sources.js`, `txt_plain`) 지원 (`updated.md` 참고)
- [ ] **[P2] AI 정합 속도·정확도 최적화 (`lyrics-scraper.js`, `lyrics-aligner.js`, `gemini-service.js`)**:
  - `autoAnalyzeMode === "align"` 시 Whisper 전사와 LRCLIB 가사 조회 병렬화, 정합 요청 ID 경량화(정수 인덱스) 및 단어 타임스탬프 공백 기반 병합 세그먼트 스냅 검토
  - (선택 옵션) LRCLIB `syncedLyrics` + 트랙 길이 일치(`±3초`) 시 Whisper 중앙값 오프셋 보정 고속 정합 검토
- [ ] **[P2] 외부 다중 가사 소스 폴백 체인 확장 (`lyrics-scraper.js`)**: LRCLIB 검색 실패 시 보조 공개 가사 API(`lyrics.ovh` 등) 순차 조회 후 Whisper 텍스트 유사도 검증을 통과한 평문 가사 자동 확보
- [ ] **[P2] Gemini 클라우드 STT 오디오 전송 경량화 (`gemini-service.js`, `transcription-worker.js`)**:
  - FLAC/WAV 등 대용량 음원 업로드 전 64kbps 모노 MP3 경량 인코딩(또는 20MB 미만 `inlineData` 직접 전송)으로 업로드·처리 대기 시간 단축
- [ ] **[P2] 로컬 Whisper 워커 상주화 및 배치 추론 검토 (`transcribe.py`, `transcription-worker.js`)**:
  - 곡마다 반복되는 `transcribe.exe` 압축 해제·모델 VRAM 로딩 콜드 스타트를 제거하는 유휴 타임아웃 기반 상주 워커 데몬 검토
  - GPU 환경에서 `faster-whisper` `BatchedInferencePipeline` 적용 가능성(보컬 분리 스템 기준 정확도 비교) 검증
- [ ] **[P2] 가사 텍스트 기반 강제 정렬(Forced Alignment) 검토**: 음원 내장 평문 가사 또는 외부 가사 검색과 연동해 오타 없이 타임스탬프만 정밀 정렬하는 옵션 검토
- [x] **로컬 Whisper·보컬 분리 분석 성능 및 진행률 스트리밍 개선 (`transcribe.py`, `vocal_separator.py`, `lyrics-job-manager.js`)**: `detect_language()` 경량 언어 감지 전환, ONNX 보컬 분리→Whisper 모델 VRAM 로딩 순서 분리, CPU 멀티스레드(`min(cpu, 8)`)·상황별 `beamSize`(2/3) 조정 및 세그먼트 실시간 진행률 출력 (`updated.md` 참고)
- [x] **Gemini 가사 전사·정합 프롬프트 고도화 (`src/main/services/gemini-prompts.js`)**:
  - 전사(`transcribeSystemInstruction`): 전주/간주 비가사 마커(`[간주]`, `♪`) 배제, 코러스·화음 중복 분리 억제 및 호흡 단위 소절 분할 정제 (`updated.md` 참고)
  - 정합(`alignSystemInstruction`): 1·2절 반복 후렴구 재사용 금지 유지 및 연속 병합 소절에 한정한 `lyrics-aligner.js` 분할 연동, 앵커 라인(첫 줄·간주 직후) 우선 매칭 보강 (`updated.md` 참고)
- [x] **AI 정합 실패 시 재시도 유도 및 버튼 하이라이트 유지**: 정합 폴백·실패 시 `.align-suggested` 하이라이트 및 재시도 안내 유지 (`updated.md` 참고)
- [x] **자동화 옵션 재정비, 트랙 프리페치·셔플 덱 복구 및 곡 전환 속도 개선**: `state.playlist` 기준 순차·셔플 프리페치(`syncShuffleQueue`) 및 `forwardHistory` 복귀, RAM 네거티브 캐시, 가사 즉시 렌더링(`cancelPromise` 대기 분리) + `200ms` 자동 분석 디바운스, `자동화 워크플로우`의 `AI 및 음성 분석` 탭 통합, `AI 정합` 용어 통일 및 `lyricsSource` 기반 `AI 재분석` 오표시 수정 (`updated.md` 참고)
- [x] **곡 이동 시 AI 분석/정합 결과 오지정(Cross-track 오염) 버그 수정**: 작업 토큰(`jobId`)·트랙 스냅샷 격리, 디바운스 저장(`saveTimers`) 트랙 캡처, `selectPlaylistItem` 시퀀스 가드 및 백그라운드 완료 시 원곡 캐시 안전 저장 (`updated.md` 참고)
- [x] **AI 분석 + AI 정합(`autoAnalyzeMode === "align"`) 자동화 라인 안정화 및 503 멀티 모델 폴백**: 직접 체이닝 전환, `AbortSignal`/프로세스 취소 통합, LRCLIB 다국어 유사도·다중 쿼리 개선, 수동 분석 후 `AI 정합` 버튼 유도, `GPU`/`CPU` 장치 표기 단순화, `gemini-3.1-flash-lite` 추가 및 503/429 자동 폴백 (`updated.md` 참고)
- [x] **경량 ONNX 보컬 분리(Vocal Separation) 전처리 파이프라인**: `UVR-MDX-NET-Voc_FT.onnx` 온디맨드 모델 관리, `onnxruntime-directml` 기반 GPU/CPU 자동 가속 보컬 분리 및 설정 토글 (`updated.md` 참고)

---

## 2. 메인 화면 UI·UX 및 창·테마 개선
- [x] **가사 글씨체(폰트) 선택 및 커스텀 옵션 추가 (`index.html`, `settings-view.js`, `settings-manager.js`, `lyrics-core.js`, `lyrics.css`, `floating.css`, `floating.js`)**: `설정 > 일반`(메인 가사)과 `설정 > 플로팅 가사창`(플로팅 가사)에서 각각 독립적으로 프리셋 및 사용자 시스템 폰트 지정 지원 (`updated.md` 참고)
- [x] **우측 대기열(`#queueDrawer`) 상단 컨트롤 버튼 배치 정돈 (`index.html`, `playlist.css`)**: 좌측 정렬 드롭다운과 우측 검색·Clear 액션 그룹(`.queue-tools-actions`)으로 재정렬하고 좌우 여백(`18px`)·높이(`26px`) 통일 (`updated.md` 참고)
- [x] **앱 아이콘(`src/assets/icon.svg`, `src/assets/icon.png`) 재디자인**: 컨셉 A(`Lyra Wave & Sync Lyrics`) 기반으로 격자무늬 배경을 제거한 실제 투명 배경(32-bit RGBA, 512×512px) 다크 스쿼클 아이콘과 벡터(`SVG`) 원본 적용 (`updated.md` 참고)
- [ ] **[P3] 앨범 커버 기반 앰비언트 배경**: 현재 재생 중인 앨범 아트의 대표 색상을 추출해 감상 화면 배경에 은은한 그라데이션 반영
- [ ] **[P3] 사용자 커스텀 테마 확장**: 설정 창에서 기본 제공 테마(`Lyra Lavender`, `Emerald Dark`) 외 라이트 테마 및 사용자 포인트 컬러 커스터마이징 지원
- [ ] **[P3] 창 상태 유지**: 종료 시 마지막 창 크기·위치 및 우측 대기열(`Up next`) 열림 상태 복원
- [x] **상단 글로벌 바 창 드래그 영역 확대**: `.app-nav` 내 비인터랙티브 컨테이너(`nav-brand`, `nav-tabs`, `nav-actions`, `window-controls`)의 `no-drag`를 해제해 빈 공간 전체 드래그 지원 (`updated.md` 참고)
- [x] **우측 하단 플레이어 바 간소화, 대기열 토글 하단 이동 및 중앙 컨트롤 대칭 정렬**: 상단 중복 대기열 버튼(`#navQueueToggleBtn`) 제거 후 하단 아이콘 전용(`#floatingButton`·`#queueToggleButton`) 일원화 및 3열 대칭 그리드 정중앙 배치 (`updated.md` 참고)
- [x] **좌측 감상 패널 곡 정보 ↔ AI 안내·버튼 위계 분리 및 좌우 대칭 여백 보정**: `.track-ai-section` 구분선·여백 추가 및 좌측 컬럼 `272px`(`240px` 콘텐츠 + 좌우 `32px` 대칭 여백) 적용 (`updated.md` 참고)

---

## 3. 라이브러리 및 재생 대기열 고도화
- [ ] **[P2] 대기열과 라이브러리 데이터 모델 완전 분리**: 현재 공유 중인 `state.playlist`를 `library`와 `queue`로 분리하여 "대기열에서 제외"와 "라이브러리에서 제거" 동작 구분
- [ ] **[P2] 라이브러리 평문 가사 일괄 채우기 & 원클릭 붙여넣기 정합**: 내장/캐시 평문 가사가 없는 곡들을 백그라운드로 일괄 조회해 캐시(음원 태그 내장은 안전을 위해 선택 옵션)하고, 실패 곡은 배너에서 클립보드 붙여넣기 후 즉시 AI 정합 실행
- [ ] **[P2] 플레이리스트 저장 및 불러오기**: `.m3u` / JSON 형식의 사용자 재생목록 내보내기 및 가져오기
- [ ] **[P2] 드래그 앤 드롭 및 폴더 추가**: 탐색기에서 오디오 파일이나 폴더를 앱 창으로 드래그하여 라이브러리/대기열에 일괄 등록

---

## 4. 가사 편집기 기능 확장
- [ ] **[P2] 가사 줄 단위 편집 강화**: 가사 편집 화면에서 특정 줄 추가(`+`), 삭제(`-`), 긴 문장 분할, 두 줄 병합 기능 구현
- [ ] **[P2] 오디오 파형(Waveform) 시각화**: 가사 편집 화면 하단에 오디오 파형과 가사 타임스탬프 마커를 표시해 드래그로 시작/종료 시점 조정
- [ ] **[P2] 단어 단위 타임스탬프 및 가라오케 하이라이트**: 구절 내부 단어별 진행률 하이라이트 지원

---

## 5. 플로팅 가사창 및 데스크톱 통합
- [ ] **[P3] 시스템 전역 단축키(Global Shortcuts)**: 백그라운드 재생 중에도 플로팅 가사창 토글 및 재생 제어 단축키 지원
- [ ] **[P3] 플로팅 창 표시 모드 확장**: 현재 줄만 보는 1줄 모드 / 앞뒤 문맥 2~3줄 모드 전환 및 투명/잠금 시 호버 싱크 미세 조정
- [ ] **[P3] 시스템 트레이(Tray) 통합**: 창 닫기 시 트레이로 최소화 옵션 및 트레이 우클릭 미니 제어 메뉴

---

## 6. 코드 아키텍처 및 모듈 리팩토링
- [x] **[P2] 정적 검사(`npm run check`) 안전망 보강 및 가사 출처 계약 정리 (`package.json`, `lyrics-core.js`)**:
  - `package.json` `check` 스크립트에 누락된 Main JS 6개(`cache-manager.js`, `settings-manager.js`, `lyrics-sources.js`, `model-manager.js`, `media-helper.js`, `lyrics-tagger.js`) 추가 (`updated.md` 참고)
  - `lyricsSource` 상수·분류 헬퍼를 `lyrics-core.js`에 일원화하고 `.lrc`/`txt_plain` 버튼 상태 및 평문 가사 출처 라벨(`내장 가사`·`로컬 텍스트(.txt) 가사`·`웹 공식 가사`) 불일치 수정 (`updated.md` 참고)
- [x] **[P2] 렌더러 메인 오케스트레이터(`src/renderer/app.js`, 약 1,303줄) 역할 분리**:
  - **Unit 1-A (`shell-controls.js`)** *(완료 · `updated.md` 참고)*: 전역 단축키·`MediaSession`·커스텀 윈도우 제어·뷰/드로어/드롭다운/음소거 토글 분리
  - **Unit 1-B (`track-controller.js`)** *(완료 · `updated.md` 참고)*: 트랙 전환(`trackSelectionSeq`)·히스토리(`forwardHistory`)·프리페치·트랙별 디바운스 캐시 스냅샷(`saveTimers`) 분리 및 특성화 테스트 추가
- [ ] **[P2] 비동기 작업 관리자(`src/renderer/modules/lyrics-job-manager.js`, 약 553줄) 경계 정밀화 및 특성화 테스트 보강**:
  - DOM 비의존 순수 로직(적응형 `beamSize`·`openingHint`·`persistedPlainLyrics` 판별·진행률/폴백 메시지 변환·`jobId`/트랙 유효성 검사)을 UMD 헬퍼로 추출하고 `test/lyrics-job-manager.test.js` 비동기 회귀 테스트 구축
- [ ] **[P2] Main 다운로드·런타임 헬퍼 공통화 및 설정 뷰(`src/renderer/modules/settings-view.js`, 약 923줄) 분리**:
  - **Main**: `download-helper.js`(`formatBytes`, `getDirectorySize`, `downloadFileWithRedirects`) 통합, `resolvePython`/`hasFasterWhisper`(`transcription-worker.js`↔`model-manager.js`) 및 `createCancelledError`(`gemini-service.js`·`lyrics-scraper.js`·`transcription-worker.js`) 중복 제거 + 단위 테스트
  - **Renderer**: `settings-view.js`의 Whisper 모델·CUDA 팩·ONNX 보컬 분리 모델 관리 UI(~460줄)를 `model-settings-panel.js`로 분리하고 진행률/배지 갱신 공통화
- [ ] **[P2] AI 정합·로컬 소스 파이프라인 내부 구조화 (`lyrics-aligner.js`, `lyrics-sources.js`, `lyrics-scraper.js`)**:
  - `lyrics-aligner.js`(약 332줄) `alignAndInterpolateLyrics()` 내부 순수 후처리(역행 무효화·연속 중복 분할·선형 보간·길이 가드) 함수 분해 및 중복 탐색/미사용 변수 정리
  - `lyrics-sources.js`(약 284줄) 내장/사이드카 공통 텍스트 파서 추출·헤더 주석 최신화, `lyrics-scraper.js`(약 391줄) 거절 로그 이중 유사도 계산 정리
- [ ] **[P2] 대기열·라이브러리 뷰 모듈 분리 (`src/renderer/modules/playlist-manager.js`, 약 526줄)**:
  - `v1.2.0` `library`/`queue` 데이터 모델 분리 작업과 연계해 우측 대기열 드로어(`Up next`), 라이브러리 테이블 뷰, 곡 상세 정보 모달(`#trackInfoModal`)을 개별 모듈로 분리
- [ ] **[P3] 메인 프로세스 IPC 라우터(`src/main/core/ipc-router.js`, 약 513줄) 도메인별 분할**:
  - `src/main/ipc/` 아래 `track/media`, `lyrics-cache/export/embed`, `transcription/align`, `models/cuda/vocal`, `window/floating/settings` 도메인으로 분리하고 채널 상수 일원화
- [ ] **[P3] Python 전사 스크립트(`transcribe.py`, 약 562줄)·Gemini 서비스(`gemini-service.js`, 약 533줄)·대형 스타일시트(`settings.css` 약 845줄, `layout.css` 약 774줄) 구조화**:
  - `transcribe.py`는 PyInstaller `--onefile` 호환을 위해 다중 파일 분할은 보류하고 1차로 `main()` 내부 중첩 클로저(8개)를 동일 파일 최상위 함수로 승격(상주 워커 도입 시 모듈화 재검토)
  - `gemini-service.js`는 오디오 경량 인코딩(A-5) 착수 시점에 업로드 준비 계층 분리, `settings.css`·`layout.css`는 UI 안정기에 별도 분리
