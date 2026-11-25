const https = require("node:https");

function createCancelledError() {
  const err = new Error("cancelled");
  err.cancelled = true;
  return err;
}

/**
 * LRCLIB JSON 엔드포인트를 AbortSignal 및 타임아웃과 함께 호출합니다.
 */
function fetchLrclibJson(url, { signal, timeoutMs = 12000, allowNotFound = false } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancelledError());
      return;
    }

    const options = {
      headers: {
        "User-Agent": "AutoLyricsPlayer/1.1.0 (Contact: mail@example.com)"
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
      if (allowNotFound && res.statusCode === 404) {
        res.resume();
        finish(null, null);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        finish(new Error(`LRCLIB request failed (HTTP ${res.statusCode})`));
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
 * LRCLIB `/api/get` 정확 조회를 수행합니다. (미존재 404 시 null 반환)
 */
function fetchLrclibExact({ artistName, trackName, albumName, duration }, options = {}) {
  const params = new URLSearchParams();
  params.set("artist_name", artistName);
  params.set("track_name", trackName);
  if (albumName) {
    params.set("album_name", albumName);
  }
  if (Number.isFinite(duration) && duration > 0) {
    params.set("duration", String(Math.round(duration)));
  }
  const url = `https://lrclib.net/api/get?${params.toString()}`;
  return fetchLrclibJson(url, { timeoutMs: 10000, ...options, allowNotFound: true });
}

/**
 * LRCLIB API 호출을 통해 가사 검색을 수행하고 검색 결과 배열을 반환합니다.
 */
function fetchLrclibLyrics(query, options = {}) {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  return fetchLrclibJson(url, { timeoutMs: 12000, ...options, allowNotFound: false });
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
 * LRCLIB 후보 항목에서 정제된 평문 가사 텍스트를 추출합니다. (5줄 미만이면 null)
 */
function extractPlainLyricsFromCandidate(item) {
  if (!item) return null;
  const rawText = item.plainLyrics && item.plainLyrics.trim().length > 0
    ? item.plainLyrics
    : (item.syncedLyrics || "").replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "");

  if (!rawText || rawText.trim().length === 0) return null;

  const normalizedLines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (normalizedLines.length < 5) return null;
  return normalizedLines.join("\n");
}

function getDurationAdjustment(trackDuration, candidateDuration) {
  const tDur = Number(trackDuration);
  const cDur = Number(candidateDuration);
  if (!Number.isFinite(tDur) || tDur <= 0 || !Number.isFinite(cDur) || cDur <= 0) {
    return { adjustment: 0, durationDiff: null };
  }
  const diff = Math.abs(tDur - cDur);
  let adjustment = 0;
  if (diff <= 3) adjustment = 0.12;
  else if (diff <= 8) adjustment = 0.05;
  else if (diff <= 20) adjustment = 0;
  else if (diff <= 45) adjustment = -0.12;
  else adjustment = -0.25;
  return { adjustment, durationDiff: Number(diff.toFixed(1)) };
}

/**
 * 후보 가사의 텍스트 Bigram 유사도와 트랙 길이(duration) 일치도를 결합해 채점합니다.
 */
function scoreLyricsCandidate(item, { whisperText = "", hasWhisper = false, trackDuration = null } = {}) {
  const lyrics = extractPlainLyricsFromCandidate(item);
  if (!lyrics) return null;

  const similarity = hasWhisper ? calculateBigramSimilarity(whisperText, lyrics) : 1;
  if (hasWhisper && similarity < 0.15) {
    return null;
  }

  const { adjustment, durationDiff } = getDurationAdjustment(trackDuration, item?.duration);
  return {
    lyrics,
    similarity,
    score: similarity + adjustment,
    durationDiff,
    artistName: item.artistName || "",
    trackName: item.trackName || ""
  };
}

/**
 * 가사 스크래퍼 통합 실행 함수 (LRCLIB /api/get 우선 조회 + /api/search duration·유사도 복합 채점)
 */
async function scrapeLyrics(track, whisperLyrics = [], customQuery = null, options = {}) {
  const {
    signal,
    fetchExactFn = fetchLrclibExact,
    fetchSearchFn = fetchLrclibLyrics
  } = options || {};

  if (signal?.aborted) {
    throw createCancelledError();
  }

  const queries = buildSearchQueries(track, customQuery);
  if (queries.length === 0) {
    throw new Error("Invalid track title for query generation");
  }

  const whisperText = (whisperLyrics || []).map(l => l.text).join(" ");
  const hasWhisper = whisperText.trim().length > 0;
  const trackDuration = Number(track?.duration) > 0 ? Number(track.duration) : null;

  const cleanTitle = getCleanSearchQuery(track);
  const rawArtist = typeof track?.artist === "string" ? track.artist.trim() : "";
  const artist = rawArtist && rawArtist !== "-" ? rawArtist : "";
  const album = typeof track?.album === "string" ? track.album.trim() : "";

  let lastError = null;

  // 1. 수동 쿼리가 없고 아티스트·제목 메타가 충분하면 /api/get 정확 조회 우선 시도
  if (!customQuery?.trim() && artist && cleanTitle) {
    try {
      const exactItem = await fetchExactFn(
        {
          artistName: artist,
          trackName: cleanTitle,
          albumName: album,
          duration: trackDuration
        },
        { signal }
      );
      if (exactItem) {
        const candidate = scoreLyricsCandidate(exactItem, { whisperText, hasWhisper, trackDuration });
        if (candidate) {
          console.log(`[Scraper] Selected exact lyrics from LRCLIB /api/get (${candidate.artistName} - ${candidate.trackName}, Similarity: ${(candidate.similarity * 100).toFixed(1)}%)`);
          return candidate.lyrics;
        }
      }
    } catch (err) {
      if (err?.cancelled || signal?.aborted) {
        throw createCancelledError();
      }
      lastError = err;
      console.warn(`[Scraper] LRCLIB /api/get failed: ${err.message}`);
    }
  }

  // 2. /api/search 다중 쿼리 폴백 + 유사도·트랙 길이 복합 점수 비교
  for (const query of queries) {
    if (signal?.aborted) {
      throw createCancelledError();
    }

    console.log(`[Scraper] Searching LRCLIB for query: "${query}"`);
    let results;
    try {
      results = await fetchSearchFn(query, { signal });
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
      const candidate = scoreLyricsCandidate(item, { whisperText, hasWhisper, trackDuration });
      if (!candidate) {
        if (hasWhisper && extractPlainLyricsFromCandidate(item)) {
          const sim = calculateBigramSimilarity(whisperText, extractPlainLyricsFromCandidate(item));
          console.log(`[Scraper] Rejected mismatched lyrics from LRCLIB (${item.artistName} - ${item.trackName}) (Similarity: ${(sim * 100).toFixed(1)}%)`);
        }
        continue;
      }

      if (!bestCandidate || candidate.score > bestCandidate.score) {
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      const durInfo = bestCandidate.durationDiff !== null ? `, Δdur=${bestCandidate.durationDiff}s` : "";
      console.log(`[Scraper] Selected lyrics from LRCLIB (${bestCandidate.artistName} - ${bestCandidate.trackName}, Similarity: ${(bestCandidate.similarity * 100).toFixed(1)}%${durInfo})`);
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
  calculateBigramSimilarity,
  fetchLrclibExact,
  extractPlainLyricsFromCandidate,
  scoreLyricsCandidate
};
