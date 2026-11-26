"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeNewlines,
  appendStepSummary,
  resolveWorkspaceReleaseNotes,
} = require("./release-notes");

const FILE_EXT_PATTERN = "js|jsx|mjs|cjs|ts|tsx|py|css|html|md|json|yml|yaml|txt|lrc|vtt|onnx|exe|zip";
const FILE_EXT_REGEX = new RegExp(`\\.(?:${FILE_EXT_PATTERN})\\b`, "i");
const FILE_OR_PATH_REGEX = new RegExp(`(?:[\\w.-]+\\/)+[\\w./-]+|\`?[\\w.-]+\\.(?:${FILE_EXT_PATTERN})\`?`, "gi");
const PRIORITY_TAG_REGEX = /\[P[0-3]\]/gi;
const CHECKBOX_LINE_REGEX = /^(\s*)-\s+\[([ xX])\]\s+(.*)$/;
const NON_COMPLETION_NOTE_REGEX = /(?:todo\.md|(?:과제|항목)로\s*등록|추후\s*(?:검토|진행|분리))/i;
const TIER_RANK = Object.freeze({ none: 0, medium: 1, high: 2 });
const TOKEN_STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "into", "that", "this", "via",
  "및", "등", "약", "참고", "기반", "관련", "대상", "전체", "일부", "기준",
]);

function stripParensContainingPathsOrMeta(text) {
  return text.replace(/\(([^)]*)\)/g, (_full, inner) => {
    const looksLikeFileOrMeta =
      FILE_EXT_REGEX.test(inner) ||
      /\//.test(inner) ||
      /약\s*\d+\s*줄/.test(inner) ||
      /^v\d+\.\d+/i.test(inner.trim());
    return looksLikeFileOrMeta ? " " : ` ${inner} `;
  });
}

/**
 * Normalize a todo heading or release-note line into comparable prose text.
 */
function normalizeProse(text) {
  let cleaned = String(text || "");
  cleaned = cleaned.replace(/^\s*(?:##+|-)\s*/, "");
  cleaned = cleaned.replace(/^\[([ xX])\]\s*/, "");
  cleaned = cleaned.replace(/\d{4}-\d{2}-\d{2}\s*[—–-]\s*/g, " ");
  cleaned = cleaned.replace(/\*\*|__|~~/g, "");
  cleaned = cleaned.replace(PRIORITY_TAG_REGEX, " ");
  cleaned = stripParensContainingPathsOrMeta(cleaned);
  cleaned = cleaned.replace(FILE_OR_PATH_REGEX, " ");
  cleaned = cleaned.replace(/[`'":;,.!?/\\()[\]{}<>+*~|—–-]+/g, " ");
  return cleaned.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenizeProse(normalizedText) {
  if (!normalizedText) return [];
  const raw = normalizedText.split(" ").filter(Boolean);
  const seen = new Set();
  const tokens = [];
  for (const tok of raw) {
    if (tok.length < 2) continue;
    if (TOKEN_STOPWORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue;
    if (!seen.has(tok)) {
      seen.add(tok);
      tokens.push(tok);
    }
  }
  return tokens;
}

function tokensLooselyMatch(a, b) {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  const hasHangul = /[\uac00-\ud7af]/.test(a) && /[\uac00-\ud7af]/.test(b);
  if (!hasHangul) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.length - shorter.length > 2) return false;
  return longer.startsWith(shorter);
}

/**
 * Extract clean checkbox title (head phrase before colon or full first line) from raw line tail.
 */
function extractTodoTitle(rawLineTail) {
  const withoutTrailingColon = String(rawLineTail || "").trim().replace(/:\s*$/, "");
  // Split at `**: ` when markdown bold wraps the title header before long sub-description
  const boldHeaderMatch = withoutTrailingColon.match(/^\*\*(.+?)\*\*(?:\s*:\s*.*|\s*\([^)]*\)\s*:?\s*.*)?$/);
  if (boldHeaderMatch && boldHeaderMatch[1]) {
    const cleaned = boldHeaderMatch[1].replace(PRIORITY_TAG_REGEX, "").trim();
    if (cleaned.length >= 2) {
      return cleaned;
    }
  }
  const colonIdx = withoutTrailingColon.indexOf(": ");
  if (colonIdx !== -1 && colonIdx >= 4) {
    return withoutTrailingColon.slice(0, colonIdx).trim();
  }
  return withoutTrailingColon;
}

function leadingSpaces(line) {
  const m = String(line || "").match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/**
 * Parse checkbox items and their indented sub-bullet spans from docs/todo.md.
 */
function parseTodoItems(todoMarkdown) {
  const lines = normalizeNewlines(todoMarkdown).split("\n");
  const items = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(CHECKBOX_LINE_REGEX);
    if (!match) continue;

    const indent = match[1].length;
    const checked = match[2].toLowerCase() === "x";
    const tail = match[3];
    let endLine = i;

    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j];
      if (candidate.trim() === "") {
        let nextNonEmpty = j + 1;
        while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === "") {
          nextNonEmpty += 1;
        }
        if (nextNonEmpty >= lines.length || leadingSpaces(lines[nextNonEmpty]) <= indent) {
          break;
        }
        endLine = j;
        continue;
      }

      if (leadingSpaces(candidate) <= indent) {
        break;
      }
      endLine = j;
    }

    while (endLine > i && lines[endLine].trim() === "") {
      endLine -= 1;
    }

    const title = extractTodoTitle(tail);
    const normTitle = normalizeProse(title);
    const tokens = tokenizeProse(normTitle);

    items.push({
      startLine: i,
      endLine,
      indent,
      checked,
      title,
      normTitle,
      tokens,
      rawText: lines.slice(i, endLine + 1).join("\n"),
    });
  }

  return items;
}

/**
 * Extract headings and bullet title headers from updated.md or CHANGELOG.md release section.
 * Skips prose lines that only mention future backlog registration (e.g., docs/todo.md) to avoid false positives.
 */
function extractNoteEntries(notesMarkdown) {
  const normalized = normalizeNewlines(notesMarkdown).trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    if (NON_COMPLETION_NOTE_REGEX.test(trimmed)) continue;

    if (/^##+\s+/.test(trimmed)) {
      const displayText = trimmed.replace(/^##+\s+/, "").trim();
      const norm = normalizeProse(trimmed);
      const tokens = tokenizeProse(norm);
      if (norm && tokens.length > 0) {
        entries.push({ type: "heading", displayText, norm, tokens });
      }
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      const rawTail = trimmed.replace(/^-\s+/, "").trim();
      const titleHeader = extractTodoTitle(rawTail);
      const norm = normalizeProse(titleHeader);
      const tokens = tokenizeProse(norm);
      if (norm && tokens.length > 0) {
        entries.push({ type: "bullet", displayText: titleHeader, norm, tokens });
      }
    }
  }

  return entries;
}

/**
 * Score a todo item against parsed release-note entries to detect confident completion matches.
 */
function scoreTodoAgainstNotes(todoItem, noteEntries) {
  if (!todoItem?.normTitle || todoItem.tokens.length === 0 || !Array.isArray(noteEntries) || noteEntries.length === 0) {
    return { tier: "none", score: 0, matchedTokens: [], matchedEntry: null };
  }

  let best = { tier: "none", score: 0, matchedTokens: [], matchedEntry: null };

  for (const entry of noteEntries) {
    const matchedTokens = todoItem.tokens.filter((t) =>
      entry.tokens.some((et) => tokensLooselyMatch(t, et))
    );
    const coverage = matchedTokens.length / todoItem.tokens.length;

    let tier = "none";
    let score = coverage;

    const verbatimIncluded =
      todoItem.normTitle.length >= 6 &&
      entry.norm.includes(todoItem.normTitle);

    if (verbatimIncluded) {
      tier = "high";
      score = 1.0;
    } else if (matchedTokens.length >= 4 && coverage >= 0.75) {
      tier = "high";
    } else if (matchedTokens.length >= 2 && coverage >= 0.40) {
      tier = "medium";
    }

    if (TIER_RANK[tier] > TIER_RANK[best.tier] || (TIER_RANK[tier] === TIER_RANK[best.tier] && score > best.score)) {
      best = {
        tier,
        score: Number(score.toFixed(3)),
        matchedTokens,
        matchedEntry: entry.displayText,
      };
    }
  }

  return best;
}

/**
 * Remove blank-line pileups created after deleting completed todo items.
 */
function compactMarkdownLines(keptLines) {
  const compacted = [];
  for (const line of keptLines) {
    const isBlank = line.trim() === "";
    const prev = compacted.length > 0 ? compacted[compacted.length - 1] : null;
    if (isBlank && (prev === null || prev.trim() === "")) {
      continue;
    }
    compacted.push(line);
  }
  while (compacted.length > 0 && compacted[compacted.length - 1].trim() === "") {
    compacted.pop();
  }
  return `${compacted.join("\n")}\n`;
}

function markLineRange(linesToRemove, startLine, endLine) {
  for (let ln = startLine; ln <= endLine; ln += 1) {
    linesToRemove.add(ln);
  }
}

/**
 * Cross-check todo items with release notes and prune completed entries.
 * By default (pruneMatched: false), only explicit [x] items are pruned and note matches are reported for review.
 */
function syncTodoMarkdown(todoMarkdown, notesMarkdown, { pruneMatched = false } = {}) {
  const normalizedTodo = normalizeNewlines(todoMarkdown);
  const lines = normalizedTodo.split("\n");
  const items = parseTodoItems(normalizedTodo);
  const noteEntries = extractNoteEntries(notesMarkdown);

  const linesToRemove = new Set();
  const removedChecked = [];
  const removedMatched = [];
  const missingNotesWarnings = [];
  const reviewCandidates = [];

  for (const item of items) {
    // Skip nested children whose parent block is already marked for removal.
    if (linesToRemove.has(item.startLine)) {
      continue;
    }

    const match = scoreTodoAgainstNotes(item, noteEntries);

    if (item.checked) {
      markLineRange(linesToRemove, item.startLine, item.endLine);
      removedChecked.push({ title: item.title, match });
      if (noteEntries.length > 0 && match.tier === "none") {
        missingNotesWarnings.push(item.title);
      }
      continue;
    }

    if (pruneMatched && match.tier === "high") {
      markLineRange(linesToRemove, item.startLine, item.endLine);
      removedMatched.push({ title: item.title, match });
    } else if (match.tier === "high" || match.tier === "medium") {
      reviewCandidates.push({
        title: item.title,
        tier: match.tier,
        score: match.score,
        matchedTokens: match.matchedTokens,
        matchedEntry: match.matchedEntry,
      });
    }
  }

  if (linesToRemove.size === 0) {
    return {
      changed: false,
      nextMarkdown: normalizedTodo,
      removedChecked,
      removedMatched,
      missingNotesWarnings,
      reviewCandidates,
      totalItems: items.length,
      noteEntriesCount: noteEntries.length,
    };
  }

  const keptLines = lines.filter((_line, idx) => !linesToRemove.has(idx));
  const nextMarkdown = compactMarkdownLines(keptLines);

  return {
    changed: nextMarkdown !== normalizedTodo,
    nextMarkdown,
    removedChecked,
    removedMatched,
    missingNotesWarnings,
    reviewCandidates,
    totalItems: items.length,
    noteEntriesCount: noteEntries.length,
  };
}

function formatSummaryMarkdown(result, { mode = "check", notesSource = "none" } = {}) {
  const isCheck = mode === "check";
  const changeStatus = result.changed
    ? (isCheck ? "정리 필요 (미반영)" : "변경됨")
    : (isCheck ? "정리 대상 없음" : "변경 없음");

  const lines = [
    `### Todo Sync Summary (\`${mode}\` · Notes: \`${notesSource}\`)`,
    "",
    `- **명시 완료(\`[x]\`) 정리 대상**: ${result.removedChecked.length}건`,
    `- **릴리즈 노트(\`updated.md\`) 고신뢰 일치 자동 정리**: ${result.removedMatched.length}건`,
    `- **상태**: ${changeStatus}`,
  ];

  if (result.removedChecked.length > 0) {
    lines.push("", isCheck ? "**정리 예정 `[x]` 항목:**" : "**정리된 `[x]` 항목:**");
    for (const entry of result.removedChecked) {
      lines.push(`- ${entry.title}`);
    }
  }

  if (result.removedMatched.length > 0) {
    lines.push("", isCheck ? "**노트 일치로 정리 예정인 항목:**" : "**노트 일치로 자동 정리된 항목:**");
    for (const entry of result.removedMatched) {
      lines.push(`- ${entry.title} *(일치: ${entry.match.matchedEntry})*`);
    }
  }

  const highCandidates = result.reviewCandidates.filter((c) => c.tier === "high");
  const mediumCandidates = result.reviewCandidates.filter((c) => c.tier !== "high");

  if (highCandidates.length > 0) {
    lines.push("", "**완료 유력 — 릴리즈 노트 고신뢰 일치 (수동 확인 후 삭제 권장):**");
    for (const c of highCandidates) {
      lines.push(`- ${c.title} *(일치: ${c.matchedEntry})*`);
    }
  }

  if (mediumCandidates.length > 0) {
    lines.push("", "**수동 검토 후보 (중간 유사도 · 자동 삭제 보류):**");
    for (const c of mediumCandidates) {
      lines.push(`- ${c.title} *(유사도 ${c.score}, 일치 키워드: ${c.matchedTokens.join(", ")})*`);
    }
  }

  if (result.missingNotesWarnings.length > 0) {
    lines.push("", "**주의 — 릴리즈 노트에서 대응 항목을 찾지 못한 `[x]` 항목:**");
    for (const title of result.missingNotesWarnings) {
      lines.push(`- ${title}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function runCli() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd !== "check" && cmd !== "sync") {
    console.error("Usage: node scripts/todo-sync.js <check|sync> [--prune-matched] [--fail-on-checked]");
    process.exit(1);
  }

  const pruneMatched = args.includes("--prune-matched");
  const failOnChecked = args.includes("--fail-on-checked");
  const cwd = process.cwd();
  const todoPath = path.join(cwd, "docs", "todo.md");

  if (!fs.existsSync(todoPath)) {
    console.log("docs/todo.md not found; skipping todo sync.");
    return;
  }

  const todoRaw = fs.readFileSync(todoPath, "utf8");
  const { notes, source } = resolveWorkspaceReleaseNotes(cwd);
  const result = syncTodoMarkdown(todoRaw, notes, { pruneMatched });

  if (cmd === "sync" && result.changed) {
    fs.writeFileSync(todoPath, result.nextMarkdown, "utf8");
  }

  const summary = formatSummaryMarkdown(result, { mode: cmd, notesSource: source });
  console.log(summary.trim());
  appendStepSummary(summary);

  if (cmd === "check" && failOnChecked && result.removedChecked.length > 0) {
    console.error(`Error: ${result.removedChecked.length} checked [x] item(s) remain in docs/todo.md. Run 'npm run todo:sync'.`);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  normalizeProse,
  tokenizeProse,
  parseTodoItems,
  extractNoteEntries,
  scoreTodoAgainstNotes,
  syncTodoMarkdown,
  formatSummaryMarkdown,
};
