const https = require("node:https");

function createCancelledError() {
  const err = new Error("cancelled");
  err.cancelled = true;
  return err;
}

/**
 * LRCLIB API 호출을 통해 가사 검색을 수행하고 검색 결과 배열을 반환합니다.
 */
function fetchLrclibLyrics(query, { signal, timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancelledError());
      return;
    }

    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const options = {
      headers: {
        "User-Agent": "AutoLyricsPlayer/1.0.2 (Contact: mail@example.com)"
      }
    };

    let settled = false;
    let req = null;

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    };

    const onAbort = () => {
      if (req) {
        req.destroy();
      }
      finish(createCancelledError());
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    req = https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        finish(new Error(`LRCLIB search failed (HTTP ${res.statusCode})`));
        return;
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const results = JSON.parse(data);
          finish(null, results);
        } catch (err) {
          finish(err);
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(new Error(`LRCLIB request timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => {
      if (signal?.aborted) {
        finish(createCancelledError());
      } else {
        finish(err);
      }
    });
  });
}

/**
 * 파일 이름에서 불필요한 메타 태그와 확장자를 지워 최적의 가사 검색 쿼리를 만듭니다.
 */
function getCleanSearchQuery(track) {
  if (!track || !track.title) return "";

  // 확장자 제거
  let name = track.title.replace(/\.[^/.]+$/, "");

  // 대괄호 및 소괄호 제거 (예: [Official MV], (Audio) 등)
  name = name.replace(/\[[^\]]+\]/g, "").replace(/\([^)]+\)/g, "");

  return name.trim();
}

/**
 * 트랙 메타데이터 및 파일명으로부터 우선순위 순 LRCLIB 검색 쿼리 목록을 생성합니다.
 */
function buildSearchQueries(track, customQuery = null) {
  if (customQuery && customQuery.trim()) {
    return [customQuery.trim()];
  }

  const cleanTitle = getCleanSearchQuery(track);
  const rawArtist = typeof track?.artist === "string" ? track.artist.trim() : "";
  const artist = rawArtist && rawArtist !== "-" ? rawArtist : "";

  const queries = [];
  const pushUnique = (q) => {
    const normalized = typeof q === "string" ? q.trim() : "";
    if (normalized && !queries.includes(normalized)) {
      queries.push(normalized);
    }
  };

  if (artist && cleanTitle) {
    if (!cleanTitle.toLowerCase().includes(artist.toLowerCase())) {
      pushUnique(`${artist} ${cleanTitle}`);
    }
    pushUnique(cleanTitle);
  } else if (cleanTitle) {
    pushUnique(cleanTitle);
  }

  const dashIdx = cleanTitle.indexOf(" - ");
  if (dashIdx !== -1) {
    pushUnique(cleanTitle.slice(dashIdx + 3));
  }

  return queries;
}

/**
 * 2글자(Bigram) 기반의 자카드 유사도를 계산하여 텍스트 매칭률을 반환합니다.
 * 다국어 유니코드 문자(\p{L})와 숫자(\p{N})를 모두 보존해 한/영/일/중 가사를 모두 지원합니다.
 */
function calculateBigramSimilarity(textA, textB) {
  const getBigrams = (str) => {
    const clean = String(str || "").replace(/[^\p{L}\p{N}\s]/gu, "").toLowerCase();
    const words = clean.split(/\s+/).filter(w => w.length > 0);
    const bigrams = new Set();

    for (const word of words) {
      if (word.length === 1) {
        bigrams.add(word);
      } else {
        for (let i = 0; i < word.length - 1; i++) {
          bigrams.add(word.substring(i, i + 2));
        }
      }
    }
    return bigrams;
  };

  const setA = getBigrams(textA);
  const setB = getBigrams(textB);

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * 가사 스크래퍼 통합 실행 함수 (LRCLIB을 연계하여 유사도 검증 수행, 수동 쿼리 및 취소 시그널 지원)
 */
async function scrapeLyrics(track, whisperLyrics = [], customQuery = null, options = {}) {
  const { signal } = options || {};
  if (signal?.aborted) {
    throw createCancelledError();
  }

  const queries = buildSearchQueries(track, customQuery);
  if (queries.length === 0) {
    throw new Error("Invalid track title for query generation");
  }

  const whisperText = (whisperLyrics || []).map(l => l.text).join(" ");
  const hasWhisper = whisperText.trim().length > 0;

  let lastError = null;

  for (const query of queries) {
    if (signal?.aborted) {
      throw createCancelledError();
    }

    console.log(`[Scraper] Searching LRCLIB for query: "${query}"`);
    let results;
    try {
      results = await fetchLrclibLyrics(query, { signal });
    } catch (err) {
      if (err?.cancelled || signal?.aborted) {
        throw createCancelledError();
      }
      lastError = err;
      console.warn(`[Scraper] LRCLIB query "${query}" failed: ${err.message}`);
      continue;
    }

    if (!Array.isArray(results) || results.length === 0) {
      continue;
    }

    let bestCandidate = null;

    for (const item of results) {
      const rawText = item.plainLyrics && item.plainLyrics.trim().length > 0
        ? item.plainLyrics
        : (item.syncedLyrics || "").replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "");

      if (!rawText || rawText.trim().length === 0) continue;

      const normalizedLines = rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (normalizedLines.length < 5) continue;

      const normalizedLyrics = normalizedLines.join("\n");
      const similarity = hasWhisper ? calculateBigramSimilarity(whisperText, normalizedLyrics) : 1;

      if (hasWhisper && similarity < 0.15) {
        console.log(`[Scraper] Rejected mismatched lyrics from LRCLIB (${item.artistName} - ${item.trackName}) (Similarity: ${(similarity * 100).toFixed(1)}%)`);
        continue;
      }

      if (!bestCandidate || similarity > bestCandidate.similarity) {
        bestCandidate = {
          lyrics: normalizedLyrics,
          similarity,
          artistName: item.artistName,
          trackName: item.trackName
        };
      }
    }

    if (bestCandidate) {
      console.log(`[Scraper] Selected lyrics from LRCLIB (${bestCandidate.artistName} - ${bestCandidate.trackName}, Similarity: ${(bestCandidate.similarity * 100).toFixed(1)}%)`);
      return bestCandidate.lyrics;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error(`Failed to find matching or valid lyrics in LRCLIB search results (queries: ${queries.join(" | ")})`);
}

module.exports = {
  scrapeLyrics,
  getCleanSearchQuery,
  buildSearchQueries,
  calculateBigramSimilarity
};
