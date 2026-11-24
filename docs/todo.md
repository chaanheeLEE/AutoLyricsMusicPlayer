# Todo — Auto Lyrics Player (ALP)

향후 추가하거나 개선할 기능 및 과제를 **주제별로 묶고 우선순위(`[P0]`~`[P3]`) 순으로 정렬**한 목록입니다. (완료된 내역은 [updated.md](../updated.md) 및 [CHANGELOG.md](../CHANGELOG.md) 참고)

## 버전 로드맵 요약
- **`v1.1.0`** *(완료 · 배포 예정)*: `[P0]`·`[P1]` AI 분석·정합 안정화, UI·UX 전면 개선, 셔플 덱·프리페치 복구, CI/자동 릴리즈 파이프라인
- **`v1.1.1`**: 코드 아키텍처 리팩토링(섹션 6), 가사 글씨체 커스텀·대기열 상단 버튼 배치 정돈·앱 아이콘 재디자인(섹션 2 `[P2]`), Gemini 프롬프트 고도화(섹션 1 `[P3]`)
- **`v1.2.0`**: 라이브러리·재생 대기열 분리 및 플레이리스트·폴더 입출력(섹션 3)
- **`v1.3.0`**: 가사 편집기 기능 확장 및 텍스트 기반 강제 정렬(섹션 4 + 강제 정렬)
- **`v1.4.0`**: 플로팅 가사창·데스크톱 통합 및 테마 확장(섹션 5 + 섹션 2 `[P3]`)

---

## 1. AI 분석·정합 파이프라인 및 자동화
- [ ] **[P2] 가사 텍스트 기반 강제 정렬(Forced Alignment) 검토**: 음원 내장 평문 가사 또는 외부 가사 검색과 연동해 오타 없이 타임스탬프만 정밀 정렬하는 옵션 검토
- [ ] **[P3] Gemini 가사 전사·정합 프롬프트 고도화 (`src/main/services/gemini-prompts.js`)**:
  - 전사(`transcribeSystemInstruction`): 전주/간주 타임스탬프 처리, 코러스/추임새 표기 및 소절 분할 기준 세분화
  - 정합(`alignSystemInstruction`): 1·2절 반복 후렴구 매핑 안정성 및 Whisper 누락 라인 대응 규칙(`lyrics-aligner.js` 분할 로직과 정합성 확보) 검토
- [x] **AI 정합 실패 시 재시도 유도 및 버튼 하이라이트 유지**: 정합 폴백·실패 시 `.align-suggested` 하이라이트 및 재시도 안내 유지 (`updated.md` 참고)
- [x] **자동화 옵션 재정비, 트랙 프리페치·셔플 덱 복구 및 곡 전환 속도 개선**: `state.playlist` 기준 순차·셔플 프리페치(`syncShuffleQueue`) 및 `forwardHistory` 복귀, RAM 네거티브 캐시, 가사 즉시 렌더링(`cancelPromise` 대기 분리) + `200ms` 자동 분석 디바운스, `자동화 워크플로우`의 `AI 및 음성 분석` 탭 통합, `AI 정합` 용어 통일 및 `lyricsSource` 기반 `AI 재분석` 오표시 수정 (`updated.md` 참고)
- [x] **곡 이동 시 AI 분석/정합 결과 오지정(Cross-track 오염) 버그 수정**: 작업 토큰(`jobId`)·트랙 스냅샷 격리, 디바운스 저장(`saveTimers`) 트랙 캡처, `selectPlaylistItem` 시퀀스 가드 및 백그라운드 완료 시 원곡 캐시 안전 저장 (`updated.md` 참고)
- [x] **AI 분석 + AI 정합(`autoAnalyzeMode === "align"`) 자동화 라인 안정화 및 503 멀티 모델 폴백**: 직접 체이닝 전환, `AbortSignal`/프로세스 취소 통합, LRCLIB 다국어 유사도·다중 쿼리 개선, 수동 분석 후 `AI 정합` 버튼 유도, `GPU`/`CPU` 장치 표기 단순화, `gemini-3.1-flash-lite` 추가 및 503/429 자동 폴백 (`updated.md` 참고)
- [x] **경량 ONNX 보컬 분리(Vocal Separation) 전처리 파이프라인**: `UVR-MDX-NET-Voc_FT.onnx` 온디맨드 모델 관리, `onnxruntime-directml` 기반 GPU/CPU 자동 가속 보컬 분리 및 설정 토글 (`updated.md` 참고)

---

## 2. 메인 화면 UI·UX 및 창·테마 개선
- [ ] **[P2] 가사 글씨체(폰트) 선택 및 커스텀 옵션 추가 (`index.html`, `settings-view.js`, `settings-manager.js`, `lyrics.css`, `floating.css`)**: 설정 창에서 메인 가사 뷰어 및 플로팅 가사창의 글씨체 프리셋 선택 또는 사용자 시스템 폰트 커스텀 지정 기능 지원
- [ ] **[P2] 우측 대기열(`#queueDrawer`) 상단 컨트롤 버튼 배치 정돈 (`index.html`, `playlist.css`)**: 대기열 헤더(`.queue-header`)와 도구 줄(`.queue-tools-row`)에서 `justify-content: space-between`으로 흩어져 있는 정렬 드롭다운(`#playlistSortSelect`)·검색 버튼(`#playlistSearchButton`)·비우기 버튼(`#playlistClearButton`)을 좌우 기능 그룹(좌측 정렬 / 우측 검색·비우기 묶음 등)으로 응집력 있게 재배치
- [ ] **[P2] 앱 아이콘(`src/assets/icon.svg`, `src/assets/icon.png`) 재디자인**: 기존 이미지에 구워진 격자무늬 배경과 구버전 네온 색상을 제거하고, `Lyra Lavender` 기본 테마 및 다크 스쿼클 스타일에 맞춘 실제 투명 배경(32-bit RGBA, 512×512px) 아이콘과 벡터(`SVG`) 원본 제작
- [ ] **[P3] 앨범 커버 기반 앰비언트 배경**: 현재 재생 중인 앨범 아트의 대표 색상을 추출해 감상 화면 배경에 은은한 그라데이션 반영
- [ ] **[P3] 사용자 커스텀 테마 확장**: 설정 창에서 기본 제공 테마(`Lyra Lavender`, `Emerald Dark`) 외 라이트 테마 및 사용자 포인트 컬러 커스터마이징 지원
- [ ] **[P3] 창 상태 유지**: 종료 시 마지막 창 크기·위치 및 우측 대기열(`Up next`) 열림 상태 복원
- [x] **상단 글로벌 바 창 드래그 영역 확대**: `.app-nav` 내 비인터랙티브 컨테이너(`nav-brand`, `nav-tabs`, `nav-actions`, `window-controls`)의 `no-drag`를 해제해 빈 공간 전체 드래그 지원 (`updated.md` 참고)
- [x] **우측 하단 플레이어 바 간소화, 대기열 토글 하단 이동 및 중앙 컨트롤 대칭 정렬**: 상단 중복 대기열 버튼(`#navQueueToggleBtn`) 제거 후 하단 아이콘 전용(`#floatingButton`·`#queueToggleButton`) 일원화 및 3열 대칭 그리드 정중앙 배치 (`updated.md` 참고)
- [x] **좌측 감상 패널 곡 정보 ↔ AI 안내·버튼 위계 분리 및 좌우 대칭 여백 보정**: `.track-ai-section` 구분선·여백 추가 및 좌측 컬럼 `272px`(`240px` 콘텐츠 + 좌우 `32px` 대칭 여백) 적용 (`updated.md` 참고)

---

## 3. 라이브러리 및 재생 대기열 고도화
- [ ] **[P2] 대기열과 라이브러리 데이터 모델 완전 분리**: 현재 공유 중인 `state.playlist`를 `library`와 `queue`로 분리하여 "대기열에서 제외"와 "라이브러리에서 제거" 동작 구분
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
- [ ] **[P2] 렌더러 메인 오케스트레이터(`src/renderer/app.js`, 약 1,300줄) 역할 분리**:
  - 트랙 전환·히스토리·프리페치·가사 캐시 스냅샷 저장 로직(`track-controller.js`)과 전역 단축키·`MediaSession`·커스텀 윈도우 제어(`shell-controls.js`)를 분리해 `app.js`를 초기화 및 모듈 연결 엔트리로 경량화
- [ ] **[P2] 설정 뷰(`src/renderer/modules/settings-view.js`, 약 835줄) 및 모델·가속 팩 다운로드 모듈 공통화**:
  - Whisper 모델·CUDA 가속 팩·ONNX 보컬 분리 모델의 다운로드 진행률·취소·삭제 UI 렌더링을 공통 헬퍼로 통합하고, 메인 프로세스(`model-manager.js`, `cuda-manager.js`, `vocal-model-manager.js`)의 다운로드/취소/상태 관리 중복 코드 정리
- [ ] **[P2] 대기열·라이브러리 뷰 모듈 분리 (`src/renderer/modules/playlist-manager.js`, 약 610줄)**:
  - `library`/`queue` 데이터 모델 분리 작업과 연계해 우측 대기열 드로어(`Up next`), 라이브러리 테이블 뷰, 곡 상세 정보 모달(`#trackInfoModal`)을 개별 모듈로 분리
- [ ] **[P3] 메인 프로세스 IPC 라우터(`src/main/core/ipc-router.js`, 약 480줄) 도메인별 분할**:
  - 단일 파일에 집중된 핸들러를 `track/media`, `lyrics-cache/export/embed`, `transcription/align/models`, `window/floating/settings` 도메인 단위로 분리하고 채널 상수 일원화
- [ ] **[P3] Python 전사 스크립트(`src/main/services/transcribe.py`, 약 520줄) 및 대형 스타일시트(`layout.css`, 약 870줄) 구조화**:
  - `transcribe.py` 내 CUDA 런타임 탐지·HuggingFace 다운로드·언어 감지·단어 단위 세그먼트 분할을 역할별로 모듈화하고, `layout.css`에서 상단 내비게이션·감상 패널·공통 모달 스타일을 분리
