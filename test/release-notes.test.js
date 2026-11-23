const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractReleaseNotes,
  buildEmptyUpdatedTemplate,
  prependToChangelog,
} = require("../scripts/release-notes");

test("extracts release notes by stripping H1 header, intro, and leading divider", () => {
  const sample = [
    "# Updated — Auto Lyrics Player (ALP)",
    "",
    "완료된 주요 업데이트 내역을 최신순으로 정리한 문서입니다.",
    "",
    "---",
    "",
    "## 2026-11-23 — 신규 기능",
    "- 첫 번째 항목",
    "",
    "---",
    "",
    "## 2026-11-22 — 버그 수정",
    "- 두 번째 항목",
    "",
  ].join("\n");

  const extracted = extractReleaseNotes(sample);
  assert.match(extracted, /^## 2026-11-23 — 신규 기능/);
  assert.match(extracted, /- 두 번째 항목$/);
  assert.doesNotMatch(extracted, /# Updated/);
});

test("returns empty string for empty or placeholder-only updated.md", () => {
  assert.equal(extractReleaseNotes(""), "");
  assert.equal(extractReleaseNotes(buildEmptyUpdatedTemplate()), "");
});

test("prepends release notes cleanly to empty and existing CHANGELOG.md and stays idempotent", () => {
  const notes102 = "## 2026-11-22 — 메타데이터 지원\n- 태그 추출 추가";
  const created = prependToChangelog("", "v1.0.2", notes102, "2026-11-22");
  assert.match(created, /^# Changelog — Auto Lyrics Player \(ALP\)/);
  assert.match(created, /## v1\.0\.2 \(2026-11-22\)/);
  assert.match(created, /- 태그 추출 추가/);

  const notes103 = "## 2026-11-23 — DirectML 가속\n- 보컬 분리 GPU 가속";
  const updated = prependToChangelog(created, "v1.0.3", notes103, "2026-11-23");
  const idx103 = updated.indexOf("## v1.0.3 (2026-11-23)");
  const idx102 = updated.indexOf("## v1.0.2 (2026-11-22)");
  assert.ok(idx103 !== -1 && idx102 !== -1 && idx103 < idx102);

  // Idempotent when called again with an already archived version
  const duplicateGuard = prependToChangelog(updated, "v1.0.3", notes103, "2026-11-23");
  assert.equal(duplicateGuard, updated);

  // Cleanly handles initial CHANGELOG.md ending with a trailing horizontal rule
  const initialTemplate = "# Changelog — Auto Lyrics Player (ALP)\n\n릴리즈별 업데이트 이력을 최신순(내림차순)으로 보관합니다.\n\n---\n";
  const fromInitial = prependToChangelog(initialTemplate, "v1.0.2", notes102, "2026-11-22");
  assert.match(fromInitial, /---\n\n## v1\.0\.2 \(2026-11-22\)/);
  assert.doesNotMatch(fromInitial, /---\n\n---/);
});
