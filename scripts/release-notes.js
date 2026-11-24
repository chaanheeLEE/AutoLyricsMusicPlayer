"use strict";

const fs = require("node:fs");
const path = require("node:path");

function normalizeNewlines(text) {
  return String(text || "").replace(/\r\n/g, "\n");
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip the top H1 header, intro blurb, first divider, and HTML comments from updated.md.
 * Returns trimmed Markdown notes body, or "" when no release notes exist.
 * @param {string} rawMarkdown
 * @returns {string}
 */
function extractReleaseNotes(rawMarkdown) {
  let content = normalizeNewlines(rawMarkdown).trim();
  if (!content) return "";

  const lines = content.split("\n");
  let startIdx = 0;

  // Locate first H2 section or top horizontal rule if H1 header exists at top
  if (/^#\s+/.test(lines[0])) {
    const firstHrIdx = lines.findIndex((line, idx) => idx > 0 && /^\s*---\s*$/.test(line));
    const firstH2Idx = lines.findIndex((line, idx) => idx > 0 && /^##\s+/.test(line));

    if (firstHrIdx !== -1 && (firstH2Idx === -1 || firstHrIdx < firstH2Idx)) {
      startIdx = firstHrIdx + 1;
    } else if (firstH2Idx !== -1) {
      startIdx = firstH2Idx;
    } else {
      startIdx = lines.length;
    }
  }

  content = lines.slice(startIdx).join("\n");
  content = content.replace(/<!--[\s\S]*?-->/g, "");
  content = content.replace(/^(?:\s*---\s*\n)+/, "");
  content = content.replace(/(?:\n\s*---\s*)+$/, "");

  return content.trim();
}

/**
 * Build clean empty updated.md template for the next release cycle.
 * @returns {string}
 */
function buildEmptyUpdatedTemplate() {
  return [
    "# Updated — Auto Lyrics Player (ALP)",
    "",
    "다음 릴리즈에 반영될 완료 업데이트 내역을 작성합니다. (이전 버전 이력은 [CHANGELOG.md](./CHANGELOG.md) 참고)",
    "",
    "---",
    "",
    "<!-- 다음 릴리즈 내역을 여기에 최신순으로 작성하세요 -->",
    "",
  ].join("\n");
}

/**
 * Prepend a newly released version section into CHANGELOG.md (idempotent per versionTag).
 * @param {string} existingChangelog
 * @param {string} versionTag - e.g. "v1.0.3"
 * @param {string} notesBody
 * @param {string} [dateStr] - e.g. "2026-11-23"
 * @returns {string}
 */
function prependToChangelog(existingChangelog, versionTag, notesBody, dateStr) {
  const cleanNotes = String(notesBody || "")
    .replace(/\r\n/g, "\n")
    .replace(/(?:\n\s*---\s*)+$/, "")
    .trim();

  if (!cleanNotes) {
    return existingChangelog || "";
  }

  const tag = String(versionTag || "").trim();
  const date = dateStr || new Date().toISOString().slice(0, 10);
  const normalizedExisting = normalizeNewlines(existingChangelog || "");

  // Idempotency guard: do not duplicate if this version header is already recorded
  const versionHeadingRegex = new RegExp(`^##\\s+${escapeRegExp(tag)}(?:\\s|\\(|$)`, "m");
  if (versionHeadingRegex.test(normalizedExisting)) {
    return normalizedExisting;
  }

  const entry = `## ${tag} (${date})\n\n${cleanNotes}`;
  const defaultHeader = [
    "# Changelog — Auto Lyrics Player (ALP)",
    "",
    "릴리즈별 업데이트 이력을 최신순(내림차순)으로 보관합니다.",
  ].join("\n");

  if (!normalizedExisting.trim()) {
    return `${defaultHeader}\n\n---\n\n${entry}\n`;
  }

  const firstEntryMatch = normalizedExisting.match(/^##\s+/m);
  if (firstEntryMatch && firstEntryMatch.index !== undefined) {
    const prefix = normalizedExisting.slice(0, firstEntryMatch.index).trimEnd();
    const rest = normalizedExisting.slice(firstEntryMatch.index).trimStart();
    const prefixWithDivider = /\n---\s*$/.test(prefix) || prefix === "---"
      ? prefix
      : `${prefix}\n\n---`;
    return `${prefixWithDivider}\n\n${entry}\n\n---\n\n${rest}\n`.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n");
  }

  const trimmed = normalizedExisting.trimEnd();
  const sep = /\n---\s*$/.test(trimmed) ? "\n\n" : "\n\n---\n\n";
  return `${trimmed}${sep}${entry}\n`;
}

/**
 * Extract release notes for a specific version tag from CHANGELOG.md.
 * Returns trimmed Markdown notes body, or "" when that version section is missing.
 * @param {string} changelogMarkdown
 * @param {string} versionTag - e.g. "v1.1.0"
 * @returns {string}
 */
function extractReleaseNotesFromChangelog(changelogMarkdown, versionTag) {
  const normalized = normalizeNewlines(changelogMarkdown).trim();
  const tag = String(versionTag || "").trim();
  if (!normalized || !tag) return "";

  const lines = normalized.split("\n");
  const startRegex = new RegExp(`^##\\s+${escapeRegExp(tag)}(?:\\s+\\([^)]*\\)|\\s|$)`);
  const startIdx = lines.findIndex((line) => startRegex.test(line.trim()));
  if (startIdx === -1) return "";

  const nextVersionRegex = /^##\s+v\d+\.\d+\.\d+(?:[-.\w]*)(?:\s+\([^)]*\)|\s|$)/;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (nextVersionRegex.test(lines[i].trim())) {
      endIdx = i;
      break;
    }
  }

  let body = lines.slice(startIdx + 1, endIdx).join("\n");
  body = body.replace(/^(?:\s*---\s*\n)+/, "");
  body = body.replace(/(?:\n\s*---\s*)+$/, "");
  return body.trim();
}

function appendGithubOutput(key, value) {
  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    fs.appendFileSync(outFile, `${key}=${value}\n`, "utf8");
  }
}

function appendStepSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, `${markdown}\n`, "utf8");
  }
}

function readPackageVersion(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

function readUpdatedFile(cwd) {
  const updatedPath = path.join(cwd, "updated.md");
  if (!fs.existsSync(updatedPath)) return "";
  return fs.readFileSync(updatedPath, "utf8");
}

function readChangelogFile(cwd) {
  const changelogPath = path.join(cwd, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) return "";
  return fs.readFileSync(changelogPath, "utf8");
}

function parseArgValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return null;
}

function runCli() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const cwd = process.cwd();

  if (cmd === "extract") {
    const outPath = parseArgValue(args, "--out");
    const rawVersion = parseArgValue(args, "--version") || `v${readPackageVersion(cwd)}`;
    const versionTag = rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`;

    const updatedNotes = extractReleaseNotes(readUpdatedFile(cwd));
    const changelogNotes = updatedNotes
      ? ""
      : extractReleaseNotesFromChangelog(readChangelogFile(cwd), versionTag);
    const notes = updatedNotes || changelogNotes;
    const hasNotes = notes.length > 0;

    if (hasNotes && outPath) {
      fs.writeFileSync(path.resolve(cwd, outPath), `${notes}\n`, "utf8");
    }
    appendGithubOutput("has_notes", String(hasNotes));
    console.log(
      hasNotes
        ? `Extracted release notes (${notes.length} chars) from ${updatedNotes ? "updated.md" : `CHANGELOG.md (${versionTag})`}.`
        : `No release notes found in updated.md or CHANGELOG.md (${versionTag}); falling back to auto-generated notes.`
    );
    return;
  }

  if (cmd === "check") {
    const version = readPackageVersion(cwd);
    const versionTag = `v${version}`;
    const updatedNotes = extractReleaseNotes(readUpdatedFile(cwd));
    const changelogNotes = updatedNotes
      ? ""
      : extractReleaseNotesFromChangelog(readChangelogFile(cwd), versionTag);
    const notes = updatedNotes || changelogNotes;
    const hasNotes = notes.length > 0;
    const sourceLabel = updatedNotes ? "updated.md" : `CHANGELOG.md (${versionTag})`;

    console.log(`Package version: ${versionTag}`);
    if (hasNotes) {
      const lineCount = notes.split("\n").length;
      console.log(`Release notes ready in ${sourceLabel} (${lineCount} lines, ${notes.length} chars).`);
      appendStepSummary(`### Release Notes Preview (\`${versionTag}\` · ${sourceLabel})\n\n${notes}\n`);
    } else {
      console.log("Warning: No release notes found in updated.md or CHANGELOG.md yet. Release will use GitHub auto-generated notes if merged now.");
      appendStepSummary(`### Release Notes Preview (\`${versionTag}\`)\n\n> **Note:** \`updated.md\` 및 \`CHANGELOG.md (${versionTag})\`에 작성된 릴리즈 노트가 없습니다. 머지 시 GitHub 자동 생성 노트로 폴백됩니다.\n`);
    }
    return;
  }

  if (cmd === "archive") {
    const rawVersion = parseArgValue(args, "--version") || `v${readPackageVersion(cwd)}`;
    const versionTag = rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`;
    const updatedPath = path.join(cwd, "updated.md");
    const changelogPath = path.join(cwd, "CHANGELOG.md");

    const notes = extractReleaseNotes(readUpdatedFile(cwd));
    if (notes.length > 0) {
      const existingChangelog = fs.existsSync(changelogPath)
        ? fs.readFileSync(changelogPath, "utf8")
        : "";
      const nextChangelog = prependToChangelog(existingChangelog, versionTag, notes);
      fs.writeFileSync(changelogPath, nextChangelog, "utf8");
      console.log(`Archived ${versionTag} release notes into CHANGELOG.md.`);
    } else {
      console.log(`No release notes found in updated.md for ${versionTag}; skipped CHANGELOG.md update.`);
    }

    fs.writeFileSync(updatedPath, buildEmptyUpdatedTemplate(), "utf8");
    console.log("Reset updated.md to empty template.");
    return;
  }

  console.error("Usage: node scripts/release-notes.js <extract|check|archive> [--out <path>] [--version <vX.Y.Z>]");
  process.exit(1);
}

if (require.main === module) {
  runCli();
}

module.exports = {
  extractReleaseNotes,
  extractReleaseNotesFromChangelog,
  buildEmptyUpdatedTemplate,
  prependToChangelog,
};
