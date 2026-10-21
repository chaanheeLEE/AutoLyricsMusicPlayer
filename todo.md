# 📋 Auto Lyrics Player — Todo

## 📌 남은 기능 구현
- 더 많은 플레이리스트 정렬방식 (앨범명→ 앨범내 곡 번호, 커스텀 정렬 저장 가능)
- 플레이리스트 저장 및 불러오기
- Gemini 2.5 Flash / Pro 최신 모델로 Transcribe 및 Align 업데이트

---

## ✅ 완료된 작업

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