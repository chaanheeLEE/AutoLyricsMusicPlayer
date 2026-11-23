# Todo — Auto Lyrics Player (ALP)

향후 추가하거나 개선할 기능 및 과제를 **주제별로 묶고 우선순위(`[P0]`~`[P3]`) 순으로 정렬**한 목록입니다. (완료된 내역은 [updated.md](../updated.md) 및 [CHANGELOG.md](../CHANGELOG.md) 참고)

---

## 1. AI 분석·정합 파이프라인 및 자동화
- [ ] **[P0] 곡 이동 시 AI 분석/정합 결과 오지정(Cross-track 오염) 버그 수정 (`lyrics-job-manager.js`, `app.js`)**:
  - `handleAlignClick()`에 `originalTrackKey` 검증 가드가 없어 AI 정합 중 곡을 넘기면 이동된 새 곡의 가사/캐시에 덮어써지는 문제 해결
  - `persistLyricsSoon()` 250ms 디바운스 타이머가 지연 시점의 `state.track`을 참조해 다른 곡에 저장할 수 있는 경합 차단 (대상 `track` 캡처 전달)
  - `selectPlaylistItem()`에서 이전 작업 취소 완료 대기 및 곡 전환 후 백그라운드 완료 시 이동된 곡에 덮어쓰지 않고 원곡 캐시에만 안전 저장할지 여부 결정
- [ ] **[P0] AI 분석 + AI 정합(`autoAnalyzeMode === "align"`) 자동화 라인 안정화 (`lyrics-job-manager.js`, `lyrics-aligner.js`)**:
  - `autoAnalyzeMode === "align"`일 때 DOM `.click()` 및 `setTimeout(..., 500)` 우회 대신 `handleAlignClick()` 직접 체이닝 및 `isAutoAnalyzing` 상태 꼬임 방지
  - 1차 STT 실패·웹 가사 크롤링 실패·Gemini 타임아웃 등 자동화 파이프라인 중간 실패 원인 로깅 및 사용자 피드백/폴백 개선
- [ ] **[P2] 자동화 옵션 재검토 및 곡 전환 → 자동화 진입 속도 개선 (`app.js`, `index.html`, `settings-view.js`)**:
  - 존재하지 않는 `state.tracks`를 참조해 동작하지 않던 다음 트랙 프리페치(`state.playlist` 기준으로 수정) 정상화 및 곡 전환 시 `setTimeout(..., 100)` + `setTimeout(..., 500)` 인위적 대기 제거
  - `settingAutoAnalyzeMode` 선택지 재정비 (수동 / 내장 가사 없을 때만 자동 / 분석+정합 / 보컬 분리 연동 여부 등)
- [ ] **[P2] 가사 텍스트 기반 강제 정렬(Forced Alignment) 검토**: 음원 내장 평문 가사 또는 외부 가사 검색과 연동해 오타 없이 타임스탬프만 정밀 정렬하는 옵션 검토
- [ ] **[P3] Gemini 가사 전사·정합 프롬프트 고도화 (`src/main/services/gemini-prompts.js`)**:
  - 전사(`transcribeSystemInstruction`): 전주/간주 타임스탬프 처리, 코러스/추임새 표기 및 소절 분할 기준 세분화
  - 정합(`alignSystemInstruction`): 1·2절 반복 후렴구 매핑 안정성 및 Whisper 누락 라인 대응 규칙(`lyrics-aligner.js` 분할 로직과 정합성 확보) 검토
- [x] **경량 ONNX 보컬 분리(Vocal Separation) 전처리 파이프라인**: `UVR-MDX-NET-Voc_FT.onnx` 온디맨드 모델 관리, `onnxruntime-directml` 기반 GPU/CPU 자동 가속 보컬 분리 및 설정 토글 (`updated.md` 참고)

---

## 2. 메인 화면 UI·UX 및 창·테마 개선
- [ ] **[P1] 상단 글로벌 바 창 드래그 영역 확대 (`index.html`, `layout.css`)**:
  - `.app-nav`에서 `.nav-brand`·`.nav-tabs`·`.nav-actions` 컨테이너 자체가 `no-drag`를 넓게 점유해 좌측 일부만 창 이동이 되던 문제 수정 → 빈 공간 전체를 `-webkit-app-region: drag`로 열고 개별 버튼/탭 요소만 `no-drag` 지정
- [ ] **[P1] 우측 하단 플레이어 바 버튼 간소화 및 중복 대기열 버튼 제거 (`index.html`, `app.js`, `player-bar.css`)**:
  - 상단 바(`#navQueueToggleBtn`)와 중복되는 하단 `#queueToggleButton` 제거
  - `#floatingButton`의 `"가사 창"` 텍스트 라벨을 제거하고 아이콘 전용 버튼(`title`/`aria-label` 유지)으로 정리 (`updateFloatingButtonUI` 텍스트 갱신 제거)
- [ ] **[P1] 좌측 감상 패널 곡 정보 ↔ AI 안내·버튼 영역 위계 분리 (`index.html`, `layout.css`)**:
  - `.track-copy` 내 곡 제목/아티스트/앨범 메타와 하단 `#trackStatusBadge`, `#mainAnalysisActions`, `#mainVocalIsolationToggle` 사이에 여유 공백 및 은은한 구분선(`border-top`) 추가
- [ ] **[P3] 앨범 커버 기반 앰비언트 배경**: 현재 재생 중인 앨범 아트의 대표 색상을 추출해 감상 화면 배경에 은은한 그라데이션 반영
- [ ] **[P3] 사용자 커스텀 테마 확장**: 설정 창에서 기본 제공 테마(`Lyra Lavender`, `Emerald Dark`) 외 라이트 테마 및 사용자 포인트 컬러 커스터마이징 지원
- [ ] **[P3] 창 상태 유지**: 종료 시 마지막 창 크기·위치 및 우측 대기열(`Up next`) 열림 상태 복원

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
