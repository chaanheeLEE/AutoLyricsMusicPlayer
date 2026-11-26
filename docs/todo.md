# Todo — Auto Lyrics Player (ALP)

향후 추가하거나 개선할 기능 및 과제를 **주제별로 묶고 우선순위(`[P0]`~`[P3]`) 순으로 정렬**한 목록입니다. (완료된 내역은 [updated.md](../updated.md) 및 [CHANGELOG.md](../CHANGELOG.md) 참고)

## 버전 로드맵 요약
- **`v1.1.0`** *(배포 완료)*: `[P0]`·`[P1]` AI 분석·정합 안정화, UI·UX 전면 개선, 셔플 덱·프리페치 복구, CI/자동 릴리즈 파이프라인
- **`v1.1.1`** *(마감 정리)*: UI·UX 마감, Gemini 프롬프트·LIS 정합 안정화, 평문 가사 자동 확보 고도화, **핵심 코드 아키텍처 리팩토링(Stage 0~5 + `transcribe.py` 구조화) 완료**
- **Phase A (`[P1]`)**: **가사 타임스탬프 정확도 고도화 및 정량 벤치마크 테스트 구축**(골든 셋 `Start/End MAE` 측정, `words` 경계 스냅·모델 비교, 강제 정렬 평가)
- **`v1.2.0` (Phase B)**: 라이브러리·재생 대기열 분리 + `playlist-manager.js` 모듈 분할, 플레이리스트·폴더 입출력, 라이브러리 평문 가사 일괄 채우기 & 외부 다중 소스 폴백
- **`v1.3.0` (Phase C)**: AI 정합·STT 속도 최적화(`gemini-service.js` 업로드 계층 분리 포함), 가사 편집기 기능 확장(줄 편집·파형·단어 하이라이트)
- **`v1.4.0` (Phase D)**: 플로팅 가사창·데스크톱 통합, 테마 확장 및 대형 CSS(`settings.css`·`layout.css`) 구조화

---

## 1. AI 분석·정합 파이프라인 및 자동화
- [ ] **[P1] 가사 타임스탬프 정확도 고도화 및 정량 벤치마크 테스트 구축 (`transcribe.py`, `lyrics-aligner.js`, `gemini-service.js`, `index.html`)**:
  - **정량 평가(수치화) 벤치마크 구축**: 정답 LRC(골든 셋 5~10곡: 한/영/일, 빠른 템포·발라드·반복 후렴 포함) 대비 자동 측정 스크립트 작성 및 핵심 지표 산출 — `Start/End MAE`(평균 절대 오차, 초), `P90 / Max Error`, 허용 오차 내 적중률(`±0.3s`, `±0.5s`, `±1.0s` 비율), `Anchor Match Rate`(실제 STT 앵커 매칭률 vs 보간 비율), `Split duplicate` / `Time reversal` 발생 건수, 곡당 처리 시간(`Latency`)을 변경 전·후 A/B 비교 기록
  - **1단계 — 모델 라인업 정비 및 단어 타임스탬프(`words`) 활용**:
    - `transcribe.py`: `word_timestamps=True`의 단어별 `[start, end]` 데이터를 세그먼트에 보존하고, 줄 분할 쉼 임계값(`gap >= 1.2s` → `0.45~0.6s` 등)을 벤치마크로 튜닝
    - `lyrics-aligner.js`: 연속 중복(`Split duplicate`)·보간 구간에서 단순 글자 수 비례 분할(`distributeLinesByLength`) 대신 내부 `words` 경계·침묵 간격 기반 스냅 적용
    - 모델 조합 비교: 로컬 Whisper `large-v3-turbo`(+ MDX-Net 보컬 분리 ON/OFF) 및 Gemini 정합 모델(`gemini-2.5-flash` / `gemini-2.5-pro` / `gemini-2.5-flash-lite`) 조합별 `Start/End MAE` 측정
  - **2단계 — 강제 정렬(Forced Alignment) 전용 모델 도입 검토**:
    - `stable-ts`(`stable-whisper`)의 `align()` / `refine()`(파형 에너지 기반 시작·끝 늘어짐 보정) 프로토타입 우선 평가
    - `WhisperX`(Wav2Vec2 CTC 음소 정렬) 및 Meta `MMS-FA`(`torchaudio`)의 정확도·설치 용량·속도 트레이드오프를 동일 벤치마크로 비교 후 평문 가사 보유 곡에 대한 정밀 정렬 옵션 채택
- [ ] **[P2] AI 정합 속도 최적화 (`lyrics-scraper.js`, `lyrics-aligner.js`, `gemini-service.js`)**:
  - `autoAnalyzeMode === "align"` 시 Whisper 전사와 LRCLIB 가사 조회 병렬화 및 정합 요청 ID 경량화(정수 인덱스) 검토
  - (선택 옵션) LRCLIB `syncedLyrics` + 트랙 길이 일치(`±3초`) 시 Whisper 중앙값 오프셋 보정 고속 정합 검토
- [ ] **[P2] 외부 다중 가사 소스 폴백 체인 확장 (`lyrics-scraper.js`)**: LRCLIB 검색 실패 시 보조 공개 가사 API(`lyrics.ovh` 등) 순차 조회 후 Whisper 텍스트 유사도 검증을 통과한 평문 가사 자동 확보
- [ ] **[P2] Gemini 클라우드 STT 오디오 전송 경량화 (`gemini-service.js`, `transcription-worker.js`)**:
  - FLAC/WAV 등 대용량 음원 업로드 전 64kbps 모노 MP3 경량 인코딩(또는 20MB 미만 `inlineData` 직접 전송)으로 업로드·처리 대기 시간 단축
- [ ] **[P2] 로컬 Whisper 워커 상주화 및 배치 추론 검토 (`transcribe.py`, `transcription-worker.js`)**:
  - 곡마다 반복되는 `transcribe.exe` 압축 해제·모델 VRAM 로딩 콜드 스타트를 제거하는 유휴 타임아웃 기반 상주 워커 데몬 검토
  - GPU 환경에서 `faster-whisper` `BatchedInferencePipeline` 적용 가능성(보컬 분리 스템 기준 정확도 비교) 검증

---

## 2. 메인 화면 UI·UX 및 창·테마 개선
- [ ] **[P3] 앨범 커버 기반 앰비언트 배경**: 현재 재생 중인 앨범 아트의 대표 색상을 추출해 감상 화면 배경에 은은한 그라데이션 반영
- [ ] **[P3] 사용자 커스텀 테마 확장**: 설정 창에서 기본 제공 테마(`Lyra Lavender`, `Emerald Dark`) 외 라이트 테마 및 사용자 포인트 컬러 커스터마이징 지원
- [ ] **[P3] 창 상태 유지**: 종료 시 마지막 창 크기·위치 및 우측 대기열(`Up next`) 열림 상태 복원

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
- [ ] **[P2] 대기열·라이브러리 뷰 모듈 분리 (`src/renderer/modules/playlist-manager.js`, 약 526줄)**:
  - `v1.2.0` `library`/`queue` 데이터 모델 분리 작업과 연계해 우측 대기열 드로어(`Up next`), 라이브러리 테이블 뷰, 곡 상세 정보 모달(`#trackInfoModal`)을 개별 모듈로 분리
- [ ] **[P3] Gemini 서비스(`gemini-service.js`, 약 533줄)·대형 스타일시트(`settings.css` 약 845줄, `layout.css` 약 774줄) 구조화**:
  - `gemini-service.js`는 오디오 경량 인코딩 착수 시점에 업로드 준비 계층 분리, `settings.css`·`layout.css`는 UI 안정기에 별도 분리
