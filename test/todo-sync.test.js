const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  syncTodoMarkdown,
  formatSummaryMarkdown,
} = require("../scripts/todo-sync");
const {
  resolveWorkspaceReleaseNotes,
  buildEmptyUpdatedTemplate,
} = require("../scripts/release-notes");

test("prunes top-level checked items with multi-level sub-bullets while preserving pending items and dividers", () => {
  const todo = [
    "# Todo",
    "",
    "## 1. AI",
    "- [x] **완료된 상위 항목 (`lyrics-aligner.js`)**:",
    "  - 세부 내용 1",
    "    - 중첩 세부 내용 2",
    "- [ ] **[P1] 남아 있어야 할 과제**: 핵심 기능 유지",
    "  - 유지될 하위 불릿",
    "",
    "---",
    "",
  ].join("\n");

  const notes = [
    "## 2026-11-26 — 완료된 상위 항목",
    "- 세부 내용 반영",
  ].join("\n");

  const res = syncTodoMarkdown(todo, notes);
  assert.equal(res.changed, true);
  assert.equal(res.removedChecked.length, 1);
  assert.equal(res.missingNotesWarnings.length, 0);
  assert.doesNotMatch(res.nextMarkdown, /완료된 상위 항목/);
  assert.doesNotMatch(res.nextMarkdown, /세부 내용 1/);
  assert.match(res.nextMarkdown, /남아 있어야 할 과제/);
  assert.match(res.nextMarkdown, /유지될 하위 불릿/);
  assert.match(res.nextMarkdown, /---/);
});

test("prunes only checked nested child item without deleting its unchecked parent", () => {
  const todo = [
    "## Section",
    "- [ ] **[P2] 상위 묶음 작업**:",
    "  - [x] 완료된 하위 작업",
    "    - 하위 상세 설명",
    "  - [ ] 남은 하위 작업",
  ].join("\n");

  const notes = "## 2026-11-26 — 완료된 하위 작업\n- 처리 완료";
  const res = syncTodoMarkdown(todo, notes);

  assert.equal(res.changed, true);
  assert.equal(res.removedChecked.length, 1);
  assert.match(res.nextMarkdown, /상위 묶음 작업/);
  assert.match(res.nextMarkdown, /남은 하위 작업/);
  assert.doesNotMatch(res.nextMarkdown, /완료된 하위 작업/);
  assert.doesNotMatch(res.nextMarkdown, /하위 상세 설명/);
});

test("reports high-confidence match as review candidate by default and prunes it when pruneMatched is enabled", () => {
  const todo = [
    "## 6. 리팩토링",
    "- [ ] **[P3] 메인 프로세스 IPC 라우터(`src/main/core/ipc-router.js`, 약 513줄) 도메인별 분할**: 도메인 분리",
    "- [ ] **[P2] 대기열과 라이브러리 데이터 모델 완전 분리**: 향후 진행",
  ].join("\n");

  const notes = [
    "## 2026-11-26 — 메인 프로세스 IPC 라우터 도메인별 분할 및 채널 상수 일원화",
    "- 도메인 모듈 5개와 channels.js 분리 완료",
  ].join("\n");

  const safeRes = syncTodoMarkdown(todo, notes);
  assert.equal(safeRes.changed, false);
  assert.equal(safeRes.removedMatched.length, 0);
  assert.equal(safeRes.reviewCandidates.length, 1);
  assert.equal(safeRes.reviewCandidates[0].tier, "high");
  assert.match(safeRes.nextMarkdown, /메인 프로세스 IPC 라우터/);

  const summary = formatSummaryMarkdown(safeRes, { mode: "check", notesSource: "updated.md" });
  assert.match(summary, /완료 유력 — 릴리즈 노트 고신뢰 일치/);

  const pruneRes = syncTodoMarkdown(todo, notes, { pruneMatched: true });
  assert.equal(pruneRes.changed, true);
  assert.equal(pruneRes.removedMatched.length, 1);
  assert.equal(pruneRes.removedMatched[0].match.tier, "high");
  assert.doesNotMatch(pruneRes.nextMarkdown, /메인 프로세스 IPC 라우터/);
  assert.match(pruneRes.nextMarkdown, /대기열과 라이브러리 데이터 모델 완전 분리/);
});

test("prevents false-positive deletion when only filename or single keyword overlaps", () => {
  const todo = [
    "## 1. AI",
    "- [ ] **[P3] Gemini 서비스(`gemini-service.js`, 약 533줄) 구조화**: 오디오 경량 인코딩 착수 시점에 업로드 준비 계층 분리",
    "- [ ] **[P2] Gemini 클라우드 STT 오디오 전송 경량화 (`gemini-service.js`)**: FLAC/WAV 업로드 전 MP3 인코딩",
  ].join("\n");

  const notes = [
    "## 2026-11-26 — Gemini API 503 오류 폴백 처리 추가",
    "- `gemini-service.js` 응답 재시도 및 오류 로깅 보완",
  ].join("\n");

  const res = syncTodoMarkdown(todo, notes);
  assert.equal(res.changed, false);
  assert.equal(res.removedMatched.length, 0);
  assert.match(res.nextMarkdown, /Gemini 서비스/);
  assert.match(res.nextMarkdown, /Gemini 클라우드 STT 오디오 전송 경량화/);
});

test("reports missing-in-notes warnings for checked items and medium-confidence review candidates", () => {
  const todo = [
    "## 1. AI",
    "- [x] **릴리즈 노트에 안 적은 완료 항목**: 정리만 되어 있음",
    "- [ ] **[P1] 가사 타임스탬프 정확도 고도화 및 정량 벤치마크 테스트 구축**: 정량 평가 및 보정",
  ].join("\n");

  const notes = [
    "## 2026-11-26 — 가사 타임스탬프 일부 보완",
    "- 가사 타임스탬프 정확도 일부 개선 및 벤치마크 아이디어 메모",
  ].join("\n");

  const res = syncTodoMarkdown(todo, notes);
  assert.equal(res.removedChecked.length, 1);
  assert.deepEqual(res.missingNotesWarnings, ["릴리즈 노트에 안 적은 완료 항목"]);
  assert.equal(res.removedMatched.length, 0);
  assert.equal(res.reviewCandidates.length, 1);
  assert.match(res.nextMarkdown, /가사 타임스탬프 정확도 고도화/);

  const summary = formatSummaryMarkdown(res, { mode: "sync", notesSource: "updated.md" });
  assert.match(summary, /수동 검토 후보/);
  assert.match(summary, /릴리즈 노트에서 대응 항목을 찾지 못한/);
});

test("is idempotent when run twice consecutively", () => {
  const todo = [
    "## Section",
    "- [x] 완료 작업 A",
    "- [ ] 대기 작업 B",
  ].join("\n");
  const notes = "## 2026-11-26 — 완료 작업 A\n- 완료됨";

  const first = syncTodoMarkdown(todo, notes);
  assert.equal(first.changed, true);

  const second = syncTodoMarkdown(first.nextMarkdown, notes);
  assert.equal(second.changed, false);
  assert.equal(second.nextMarkdown, first.nextMarkdown);
});

test("does not double-count nested checked child items when their parent block is also checked", () => {
  const todo = [
    "## Section",
    "- [x] 완료된 부모 과제",
    "  - [x] 완료된 중첩 하위 과제",
    "- [ ] 남은 과제",
  ].join("\n");

  const res = syncTodoMarkdown(todo, "");
  assert.equal(res.changed, true);
  assert.equal(res.removedChecked.length, 1);
  assert.equal(res.removedChecked[0].title, "완료된 부모 과제");
  assert.match(res.nextMarkdown, /남은 과제/);
});

test("ignores note lines describing backlog registration in docs/todo.md", () => {
  const todo = [
    "## 1. AI",
    "- [ ] **[P1] 가사 타임스탬프 정확도 고도화 및 정량 벤치마크 테스트 구축**: 정량 평가 및 보정",
  ].join("\n");

  const notes = [
    "## 2026-11-26 — 정합 후처리 개선",
    "- 가사 타임스탬프 정확도 고도화 및 정량 벤치마크 테스트 구축 과제를 `docs/todo.md` `[P1]` 항목으로 등록했습니다.",
  ].join("\n");

  const res = syncTodoMarkdown(todo, notes, { pruneMatched: true });
  assert.equal(res.changed, false);
  assert.equal(res.removedMatched.length, 0);
  assert.equal(res.reviewCandidates.length, 0);
});

test("resolveWorkspaceReleaseNotes prefers updated.md and falls back to CHANGELOG.md by package version", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-todo-sync-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ version: "1.1.1" }), "utf8");
    fs.writeFileSync(
      path.join(tmpDir, "CHANGELOG.md"),
      "# Changelog\n\n---\n\n## v1.1.1 (2026-11-26)\n\n## 2026-11-26 — 개선\n- 반영됨\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmpDir, "updated.md"),
      "# Updated\n\n---\n\n## 2026-11-27 — 작업 중\n- 초안\n",
      "utf8"
    );

    const fromUpdated = resolveWorkspaceReleaseNotes(tmpDir);
    assert.equal(fromUpdated.source, "updated.md");
    assert.equal(fromUpdated.fromUpdated, true);
    assert.match(fromUpdated.notes, /작업 중/);

    fs.writeFileSync(path.join(tmpDir, "updated.md"), buildEmptyUpdatedTemplate(), "utf8");
    const fromChangelog = resolveWorkspaceReleaseNotes(tmpDir);
    assert.equal(fromChangelog.source, "CHANGELOG.md (v1.1.1)");
    assert.equal(fromChangelog.fromUpdated, false);
    assert.match(fromChangelog.notes, /반영됨/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
