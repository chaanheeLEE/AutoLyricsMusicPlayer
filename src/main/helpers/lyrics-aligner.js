const { alignLyricsWithGemini } = require("../services/gemini-service");
const { scrapeLyrics } = require("../services/lyrics-scraper");

function distributeLinesByLength(items, rangeStart, rangeEnd, onAssign) {
  const totalGap = Math.max(0, rangeEnd - rangeStart);
  const lengths = items.map((item) => {
    const text = typeof item === "string" ? item : item?.text;
    return String(text || "").trim().length || 1;
  });
  const totalLength = lengths.reduce((sum, len) => sum + len, 0);

  let currentStart = rangeStart;
  for (let i = 0; i < items.length; i++) {
    const share = (lengths[i] / totalLength) * totalGap;
    const end = currentStart + share;
    onAssign(items[i], i, Number(currentStart.toFixed(3)), Number(end.toFixed(3)));
    currentStart = end;
  }
}

function classifyAlignError(failureStage, err) {
  const msg = String(err?.message || "");
  if (failureStage === "scrape") {
    if (/timed out/i.test(msg)) return "scrape_timeout";
    if (/empty_official_lyrics/i.test(msg)) return "empty_official_lyrics";
    return "scrape_not_found";
  }
  if (failureStage === "gemini") {
    if (/503|UNAVAILABLE|high demand|overloaded/i.test(msg)) return "gemini_overloaded";
    if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) return "gemini_rate_limited";
    if (/timed out/i.test(msg)) return "gemini_timeout";
    return "gemini_api_error";
  }
  if (failureStage === "matching") {
    if (/no_valid_alignment_matches/i.test(msg)) return "no_valid_matches";
    return "matching_error";
  }
  return "unknown";
}

/**
 * 시간 역행(Chronological inversion) 및 유효하지 않은 whisper_id 매핑을 무효화합니다.
 */
function invalidateTimeReversals(alignment, whisperMap) {
  if (!Array.isArray(alignment) || alignment.length === 0) return;

  const sortedAlignment = [...alignment].sort((a, b) => a.official_index - b.official_index);
  let lastValidStart = -1;

  for (const item of sortedAlignment) {
    if (!item?.whisper_id) continue;
    const wLine = whisperMap.get(item.whisper_id);
    if (!wLine) {
      item.whisper_id = null;
      continue;
    }
    if (wLine.start < lastValidStart) {
      console.warn(`[Aligner] Time reversal detected at official_index ${item.official_index} (whisper_id: ${item.whisper_id}, start: ${wLine.start}s < last: ${lastValidStart}s). Invalidating match.`);
      item.whisper_id = null;
    } else {
      lastValidStart = wLine.start;
    }
  }
}

/**
 * 동일 whisper_id가 연속된 공식 가사 줄에 매핑된 경우 글자 수 비율로 분할하고 비연속 중복은 무시합니다.
 */
function buildOfficialTimeMap(alignment, whisperMap, officialLines) {
  const whisperToOfficialMap = new Map();
  for (const item of alignment || []) {
    if (!item?.whisper_id) continue;
    if (!whisperToOfficialMap.has(item.whisper_id)) {
      whisperToOfficialMap.set(item.whisper_id, []);
    }
    whisperToOfficialMap.get(item.whisper_id).push(item.official_index);
  }

  const officialTimeMap = new Map();
  whisperToOfficialMap.forEach((indices, wId) => {
    const whisperLine = whisperMap.get(wId);
    if (!whisperLine) return;

    if (indices.length === 1) {
      officialTimeMap.set(indices[0], { start: whisperLine.start, end: whisperLine.end });
      return;
    }

    indices.sort((a, b) => a - b);
    const contiguousIndices = [indices[0]];
    for (let k = 1; k < indices.length; k++) {
      if (indices[k] === indices[k - 1] + 1) {
        contiguousIndices.push(indices[k]);
      } else {
        console.warn(`[Aligner] Ignored non-contiguous duplicate whisper_id ${wId} at official_index ${indices[k]}.`);
      }
    }

    if (contiguousIndices.length === 1) {
      officialTimeMap.set(contiguousIndices[0], { start: whisperLine.start, end: whisperLine.end });
    } else {
      distributeLinesByLength(
        contiguousIndices.map((idx) => officialLines[idx]),
        whisperLine.start,
        whisperLine.end,
        (_text, i, start, end) => {
          officialTimeMap.set(contiguousIndices[i], { start, end });
        }
      );
      console.log(`[Aligner] Split duplicate whisper_id ${wId} across ${contiguousIndices.length} official lines based on text length.`);
    }
  });

  return officialTimeMap;
}

/**
 * 매칭이 누락된 선두 및 중간/말미 가사 줄의 타임스탬프를 글자 수 비율로 보간합니다.
 */
function interpolateMissingLines(finalLyrics, whisperLyrics, maxDuration) {
  if (!Array.isArray(finalLyrics) || finalLyrics.length === 0) return;

  if (finalLyrics[0].start === null) {
    const firstMatchedIdx = finalLyrics.findIndex((item) => item.start !== null);
    if (firstMatchedIdx > 0) {
      const firstMatchedStart = Math.max(0, finalLyrics[firstMatchedIdx].start);
      const estBlockSec = Math.min(firstMatchedStart, Math.max(firstMatchedIdx * 2.5, 1.2));
      const blockStart = Math.max(0, firstMatchedStart - estBlockSec);
      distributeLinesByLength(
        finalLyrics.slice(0, firstMatchedIdx),
        blockStart,
        firstMatchedStart,
        (_item, k, start, end) => {
          finalLyrics[k].start = start;
          finalLyrics[k].end = end;
        }
      );
    } else {
      finalLyrics[0].start = 0.0;
      finalLyrics[0].end = whisperLyrics[0] ? Math.max(Math.min(whisperLyrics[0].start, 1.5), 0.8) : 1.0;
    }
  }

  let i = 0;
  while (i < finalLyrics.length) {
    if (finalLyrics[i].start !== null) {
      i++;
      continue;
    }

    const startNullIdx = i;
    let endNullIdx = i;
    while (endNullIdx < finalLyrics.length && finalLyrics[endNullIdx].start === null) {
      endNullIdx++;
    }

    const prevEnd = startNullIdx - 1 >= 0 ? finalLyrics[startNullIdx - 1].end : 0.5;
    const nextStart = endNullIdx < finalLyrics.length
      ? finalLyrics[endNullIdx].start
      : (maxDuration !== null ? maxDuration : (prevEnd + (endNullIdx - startNullIdx) * 2.0));

    distributeLinesByLength(
      finalLyrics.slice(startNullIdx, endNullIdx),
      prevEnd,
      nextStart,
      (_item, k, start, end) => {
        finalLyrics[startNullIdx + k].start = start;
        finalLyrics[startNullIdx + k].end = end;
      }
    );

    i = endNullIdx;
  }
}

/**
 * 최대 트랙 길이를 초과하지 않도록 제한하고, 최소 표시 시간(0.8초) 보정 및 순차 ID를 재할당합니다.
 */
function clampLyricDurations(finalLyrics, maxDuration) {
  for (const lyric of finalLyrics) {
    if (maxDuration !== null) {
      if (lyric.start > maxDuration) {
        lyric.start = Number(Math.max(0, maxDuration - 0.8).toFixed(3));
      }
      if (lyric.end > maxDuration) {
        lyric.end = maxDuration;
      }
      if (lyric.start >= lyric.end) {
        lyric.start = Number(Math.max(0, lyric.end - 0.8).toFixed(3));
      }
    }

    if (lyric.end <= lyric.start || lyric.end - lyric.start < 0.2) {
      lyric.end = Number((lyric.start + 0.8).toFixed(3));
      if (maxDuration !== null && lyric.end > maxDuration) {
        lyric.end = maxDuration;
        lyric.start = Number(Math.max(0, maxDuration - 0.8).toFixed(3));
      }
    }
  }

  finalLyrics.forEach((lyric, idx) => {
    lyric.id = `align_${String(idx + 1).padStart(3, "0")}`;
  });
}

async function alignAndInterpolateLyrics(payload, runtimeOptions = {}) {
  const { track, whisperLyrics, settings, customQuery, embeddedLyricsLines, plainLyricsSource } = payload || {};
  const signal = runtimeOptions?.signal || payload?.signal || null;
  const onProgress = runtimeOptions?.onProgress || payload?.onProgress || null;
  const alignFn = runtimeOptions?.deps?.alignLyricsWithGemini || alignLyricsWithGemini;
  const scrapeFn = runtimeOptions?.deps?.scrapeLyrics || scrapeLyrics;

  const emitProgress = (msg) => {
    if (!signal?.aborted && typeof onProgress === "function") {
      onProgress(msg);
    }
  };

  const apiKey = settings?.geminiApiKey;
  const maxDuration = (track?.duration && !isNaN(track.duration) && track.duration > 0) ? Number(track.duration) : null;

  if (!apiKey) {
    return { ok: false, error: "missing_api_key" };
  }
  if (!whisperLyrics || whisperLyrics.length === 0) {
    return { ok: false, error: "no_whisper_lyrics" };
  }
  if (signal?.aborted) {
    return { ok: false, cancelled: true, error: "cancelled" };
  }

  let failureStage = "unknown";
  let officialLines = null;

  try {
    let lyricsSource;

    if (embeddedLyricsLines && embeddedLyricsLines.length > 0) {
      failureStage = "scrape";
      lyricsSource = (!plainLyricsSource || plainLyricsSource === "embedded_plain") ? "embedded" : plainLyricsSource;
      officialLines = embeddedLyricsLines.map(l => String(l || "").trim()).filter(l => l.length > 0);
      console.log(`[Aligner] Using ${lyricsSource} lyrics as official source (${officialLines.length} lines) — skipping scraping`);
      emitProgress({ type: "progress", stage: "align_gemini", percent: 0.45 });
    } else {
      failureStage = "scrape";
      lyricsSource = "lrclib";
      emitProgress({ type: "progress", stage: "align_scraping", percent: 0.25 });
      const officialText = await scrapeFn(track, whisperLyrics, customQuery, { signal });
      officialLines = String(officialText || "").split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    }

    if (signal?.aborted) {
      return { ok: false, cancelled: true, error: "cancelled" };
    }

    if (officialLines.length === 0) {
      throw new Error("empty_official_lyrics");
    }

    // 2. Gemini API 호출 (gemini-service 모듈 위임)
    failureStage = "gemini";
    emitProgress({ type: "progress", stage: "align_gemini", percent: 0.55 });
    const geminiModel = settings?.geminiModel || "gemini-3.5-flash-lite";
    const alignment = await alignFn(apiKey, officialLines, whisperLyrics, geminiModel, maxDuration, {
      signal,
      onFallback: ({ fromModel, toModel }) => {
        console.warn(`[Aligner] Model ${fromModel} overloaded/unavailable, falling back to ${toModel}`);
        emitProgress({ type: "progress", stage: "align_gemini_fallback", percent: 0.65 });
      }
    });

    if (signal?.aborted) {
      return { ok: false, cancelled: true, error: "cancelled" };
    }

    failureStage = "matching";
    const whisperMap = new Map();
    whisperLyrics.forEach(item => whisperMap.set(item.id, item));

    invalidateTimeReversals(alignment, whisperMap);
    const officialTimeMap = buildOfficialTimeMap(alignment, whisperMap, officialLines);

    // 유효 매칭이 0건이면 엉뚱한 균등 보간 대신 Whisper 가사로 안전 폴백
    if (officialTimeMap.size === 0) {
      throw new Error("no_valid_alignment_matches");
    }

    // 4. 공식 가사에 배분된 싱크 입히기
    const finalLyrics = officialLines.map((text, index) => {
      const timeInfo = officialTimeMap.get(index);
      return {
        id: `align_${String(index + 1).padStart(3, "0")}`,
        start: timeInfo ? timeInfo.start : null,
        end: timeInfo ? timeInfo.end : null,
        text
      };
    });

    // 5. 누락 구간 선형 보간 및 듀레이션/트랙 길이 보정
    interpolateMissingLines(finalLyrics, whisperLyrics, maxDuration);
    clampLyricDurations(finalLyrics, maxDuration);

    emitProgress({ type: "progress", stage: "saving", percent: 1.0 });

    return {
      ok: true,
      lyrics: finalLyrics,
      source: "gemini",
      lyricsSource,
      officialLyricsLines: officialLines,
      matchedCount: officialTimeMap.size,
      totalCount: finalLyrics.length
    };

  } catch (err) {
    if (err?.cancelled || err?.message === "cancelled" || signal?.aborted) {
      return { ok: false, cancelled: true, error: "cancelled" };
    }

    const errorCode = classifyAlignError(failureStage, err);
    console.warn(`[Aligner] AI Alignment failed at stage=${failureStage} (${errorCode}), falling back to whisper lyrics: ${err.message}`);

    const fallbackLyrics = whisperLyrics.map((lyric, idx) => ({
      id: `line_${String(idx + 1).padStart(3, "0")}`,
      start: lyric.start,
      end: lyric.end,
      text: lyric.text
    }));
    return {
      ok: true,
      lyrics: fallbackLyrics,
      source: "whisper",
      warning: "fallback_to_whisper",
      officialLyricsLines: Array.isArray(officialLines) && officialLines.length > 0 ? officialLines : null,
      failureStage,
      errorCode,
      errorMessage: err.message,
      errorDetail: err.message + "\n" + (err.stack || "")
    };
  }
}

module.exports = {
  alignAndInterpolateLyrics,
  invalidateTimeReversals,
  buildOfficialTimeMap,
  interpolateMissingLines,
  clampLyricDurations
};
