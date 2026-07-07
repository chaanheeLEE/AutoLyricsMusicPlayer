const { alignLyricsWithGemini } = require("../services/gemini-service");
const { scrapeLyrics } = require("../services/lyrics-scraper");

async function alignAndInterpolateLyrics(payload) {
  const { track, whisperLyrics, settings, customQuery, embeddedLyricsLines } = payload;
  const apiKey = settings?.geminiApiKey;

  if (!apiKey) {
    return { ok: false, error: "missing_api_key" };
  }
  if (!whisperLyrics || whisperLyrics.length === 0) {
    return { ok: false, error: "no_whisper_lyrics" };
  }

  try {
    let officialLines;

    if (embeddedLyricsLines && embeddedLyricsLines.length > 0) {
      // 내장 가사가 있으면 웹 크롤링 생략하고 바로 내장 가사를 Gemini 정합 소스로 사용
      officialLines = embeddedLyricsLines.map(l => l.trim()).filter(l => l.length > 0);
      console.log(`[Aligner] Using embedded lyrics as official source (${officialLines.length} lines) — skipping scraping`);
    } else {
      // 내장 가사 없으면 기존 방식: DuckDuckGo 크롤링
      const officialText = await scrapeLyrics(track, whisperLyrics, customQuery);
      officialLines = officialText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    }

    if (officialLines.length === 0) {
      throw new Error("empty_official_lyrics");
    }

    // 2. Gemini API 호출 (gemini-service 모듈 위임)
    const alignment = await alignLyricsWithGemini(apiKey, officialLines, whisperLyrics);

    // 3. 중복 매핑 검출 및 지능형 시간 분할 처리 (중복 제거 안전망 개선)
    const whisperMap = new Map();
    whisperLyrics.forEach(item => whisperMap.set(item.id, item));

    const whisperToOfficialMap = new Map(); // whisper_id -> Array of official_indices
    (alignment || []).forEach(item => {
      if (item.whisper_id) {
        if (!whisperToOfficialMap.has(item.whisper_id)) {
          whisperToOfficialMap.set(item.whisper_id, []);
        }
        whisperToOfficialMap.get(item.whisper_id).push(item.official_index);
      }
    });

    const officialTimeMap = new Map(); // official_index -> { start, end }
    whisperToOfficialMap.forEach((indices, wId) => {
      const whisperLine = whisperMap.get(wId);
      if (!whisperLine) return;

      const totalDuration = whisperLine.end - whisperLine.start;
      const count = indices.length;

      if (count === 1) {
        officialTimeMap.set(indices[0], { start: whisperLine.start, end: whisperLine.end });
      } else {
        // 중복 매핑된 경우: 인덱스 순서대로 정렬 후 글자 수 비율로 분할 배분
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
        // 연속적으로 null인 구간 탐색
        let startNullIdx = i;
        let endNullIdx = i;
        while (endNullIdx < finalLyrics.length && finalLyrics[endNullIdx].start === null) {
          endNullIdx++;
        }
        // null 구간은 [startNullIdx, endNullIdx - 1] 범위임
        
        const prevIdx = startNullIdx - 1;
        const prevEnd = prevIdx >= 0 ? finalLyrics[prevIdx].end : 0.5;
        
        const nextIdx = endNullIdx;
        const nextStart = nextIdx < finalLyrics.length ? finalLyrics[nextIdx].start : (prevEnd + (endNullIdx - startNullIdx) * 2.0);

        const totalGap = nextStart - prevEnd;
        
        // null인 구간 내 가사들의 글자 수 비율 계산
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

        i = endNullIdx; // null 구간 건너뛰기
      } else {
        i++;
      }
    }

    // 가사 싱크 최소 듀레이션(Duration) 보정 (최소 0.8초 보장)
    for (const lyric of finalLyrics) {
      if (lyric.end <= lyric.start || lyric.end - lyric.start < 0.2) {
        lyric.end = Number((lyric.start + 0.8).toFixed(3));
      }
    }

    // ID 순차 재할당
    finalLyrics.forEach((lyric, idx) => {
      lyric.id = `align_${String(idx + 1).padStart(3, "0")}`;
    });

    return { ok: true, lyrics: finalLyrics, source: "gemini" };

  } catch (err) {
    console.log(`[Aligner] AI Alignment failed, falling back to whisper lyrics: ${err.message}`);
    // 크롤링이나 AI 정합이 실패한 경우, 수집해 두었던 Whisper 분석 가사를 Fallback 대안으로 활용
    const fallbackLyrics = whisperLyrics.map((lyric, idx) => ({
      id: `line_${String(idx + 1).padStart(3, "0")}`,
      start: lyric.start,
      end: lyric.end,
      text: lyric.text
    }));
    return { ok: true, lyrics: fallbackLyrics, source: "whisper", warning: "fallback_to_whisper", errorDetail: err.message + "\n" + err.stack };
  }
}

module.exports = {
  alignAndInterpolateLyrics
};
