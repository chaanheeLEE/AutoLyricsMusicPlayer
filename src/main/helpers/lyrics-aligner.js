const { alignLyricsWithGemini } = require("../services/gemini-service");
const { scrapeLyrics } = require("../services/lyrics-scraper");

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

async function alignAndInterpolateLyrics(payload, runtimeOptions = {}) {
  const { track, whisperLyrics, settings, customQuery, embeddedLyricsLines } = payload || {};
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

  try {
    let officialLines;
    let lyricsSource;

    if (embeddedLyricsLines && embeddedLyricsLines.length > 0) {
      failureStage = "scrape";
      lyricsSource = "embedded";
      officialLines = embeddedLyricsLines.map(l => String(l || "").trim()).filter(l => l.length > 0);
      console.log(`[Aligner] Using embedded lyrics as official source (${officialLines.length} lines) — skipping scraping`);
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

    // 시간 역행(Chronological inversion) 검출 및 무효화 처리
    if (alignment && alignment.length > 0) {
      const sortedAlignment = [...alignment].sort((a, b) => a.official_index - b.official_index);
      let lastValidStart = -1;

      sortedAlignment.forEach(item => {
        if (item.whisper_id) {
          const wLine = whisperMap.get(item.whisper_id);
          if (wLine) {
            if (wLine.start < lastValidStart) {
              console.warn(`[Aligner] Time reversal detected at official_index ${item.official_index} (whisper_id: ${item.whisper_id}, start: ${wLine.start}s < last: ${lastValidStart}s). Invalidating match.`);
              const target = alignment.find(a => a.official_index === item.official_index);
              if (target) {
                target.whisper_id = null;
              }
            } else {
              lastValidStart = wLine.start;
            }
          } else {
            const target = alignment.find(a => a.official_index === item.official_index);
            if (target) {
              target.whisper_id = null;
            }
          }
        }
      });
    }

    // 3. 중복 매핑 검출 및 지능형 시간 분할 처리
    const whisperToOfficialMap = new Map();
    (alignment || []).forEach(item => {
      if (item.whisper_id) {
        if (!whisperToOfficialMap.has(item.whisper_id)) {
          whisperToOfficialMap.set(item.whisper_id, []);
        }
        whisperToOfficialMap.get(item.whisper_id).push(item.official_index);
      }
    });

    const officialTimeMap = new Map();
    whisperToOfficialMap.forEach((indices, wId) => {
      const whisperLine = whisperMap.get(wId);
      if (!whisperLine) return;

      const totalDuration = Math.max(0, whisperLine.end - whisperLine.start);
      const count = indices.length;

      if (count === 1) {
        officialTimeMap.set(indices[0], { start: whisperLine.start, end: whisperLine.end });
      } else {
        indices.sort((a, b) => a - b);
        const lengths = indices.map(idx => (officialLines[idx] || "").length || 1);
        const totalLength = lengths.reduce((sum, len) => sum + len, 0);

        let currentStart = whisperLine.start;
        indices.forEach((officialIdx, i) => {
          const len = lengths[i];
          const share = (len / totalLength) * totalDuration;
          const end = currentStart + share;
          officialTimeMap.set(officialIdx, {
            start: Number(currentStart.toFixed(3)),
            end: Number(end.toFixed(3))
          });
          currentStart = end;
        });
        console.log(`[Aligner] Split duplicate whisper_id ${wId} across ${count} official lines based on text length.`);
      }
    });

    // 유효 매칭이 0건이면 엉뚱한 균등 보간 대신 Whisper 가사로 안전 폴백
    if (officialTimeMap.size === 0) {
      throw new Error("no_valid_alignment_matches");
    }

    // 4. 공식 가사에 배분된 싱크 입히기
    const finalLyrics = [];
    officialLines.forEach((text, index) => {
      const timeInfo = officialTimeMap.get(index);

      finalLyrics.push({
        id: `align_${String(index + 1).padStart(3, "0")}`,
        start: timeInfo ? timeInfo.start : null,
        end: timeInfo ? timeInfo.end : null,
        text: text
      });
    });

    // 5. 누락된 싱크 시간 선형 보간(Linear Interpolation) 처리 (글자 수 가중치 반영)
    if (finalLyrics[0].start === null) {
      finalLyrics[0].start = 0.0;
      finalLyrics[0].end = whisperLyrics[0] ? Math.max(Math.min(whisperLyrics[0].start, 1.5), 0.8) : 1.0;
    }

    let i = 0;
    while (i < finalLyrics.length) {
      if (finalLyrics[i].start === null) {
        let startNullIdx = i;
        let endNullIdx = i;
        while (endNullIdx < finalLyrics.length && finalLyrics[endNullIdx].start === null) {
          endNullIdx++;
        }

        const prevIdx = startNullIdx - 1;
        const prevEnd = prevIdx >= 0 ? finalLyrics[prevIdx].end : 0.5;

        const nextIdx = endNullIdx;
        const nextStart = nextIdx < finalLyrics.length ? finalLyrics[nextIdx].start : (maxDuration !== null ? maxDuration : (prevEnd + (endNullIdx - startNullIdx) * 2.0));

        const totalGap = Math.max(0, nextStart - prevEnd);

        const nullSubArray = finalLyrics.slice(startNullIdx, endNullIdx);
        const lengths = nullSubArray.map(item => (item.text || "").trim().length || 1);
        const totalLength = lengths.reduce((sum, len) => sum + len, 0);

        let currentStart = prevEnd;
        for (let k = 0; k < nullSubArray.length; k++) {
          const targetIdx = startNullIdx + k;
          const len = lengths[k];
          const share = (len / totalLength) * totalGap;

          finalLyrics[targetIdx].start = Number(currentStart.toFixed(3));
          finalLyrics[targetIdx].end = Number((currentStart + share).toFixed(3));

          currentStart += share;
        }

        i = endNullIdx;
      } else {
        i++;
      }
    }

    // 가사 싱크 최소 듀레이션(Duration) 보정 (최소 0.8초 보장) 및 최대 트랙 길이 가드
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

    // ID 순차 재할당
    finalLyrics.forEach((lyric, idx) => {
      lyric.id = `align_${String(idx + 1).padStart(3, "0")}`;
    });

    emitProgress({ type: "progress", stage: "saving", percent: 1.0 });

    return {
      ok: true,
      lyrics: finalLyrics,
      source: "gemini",
      lyricsSource,
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
      failureStage,
      errorCode,
      errorMessage: err.message,
      errorDetail: err.message + "\n" + (err.stack || "")
    };
  }
}

module.exports = {
  alignAndInterpolateLyrics
};
