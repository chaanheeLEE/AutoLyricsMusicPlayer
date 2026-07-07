const https = require("node:https");

/**
 * LRCLIB API 호출을 통해 가사 검색을 수행하고 plainLyrics를 반환합니다.
 */
function fetchLrclibLyrics(query) {
  return new Promise((resolve, reject) => {
    // LRCLIB API endpoint
    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const options = {
      headers: {
        "User-Agent": "AutoLyricsPlayer/0.1.0 (Contact: mail@example.com)"
      }
    };
    
    https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`LRCLIB search failed (HTTP ${res.statusCode})`));
        return;
      }
      
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        try {
          const results = JSON.parse(data);
          resolve(results);
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", (err) => {
      reject(err);
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
 * 2글자(Bigram) 기반의 자카드 유사도를 계산하여 텍스트 매칭률을 반환합니다.
 */
function calculateBigramSimilarity(textA, textB) {
  const getBigrams = (str) => {
    const clean = str.replace(/[^a-zA-Z0-9가-힣\s]/g, "").toLowerCase();
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
 * 가사 스크래퍼 통합 실행 함수 (LRCLIB을 연계하여 유사도 검증 수행, 수동 쿼리 지원)
 */
async function scrapeLyrics(track, whisperLyrics = [], customQuery = null) {
  // 수동 검색 쿼리가 있으면 그것을 최우선 사용하고, 없으면 정제된 기본 파일명 쿼리 사용
  const query = customQuery ? customQuery.trim() : getCleanSearchQuery(track);
  if (!query) {
    throw new Error("Invalid track title for query generation");
  }

  console.log(`[Scraper] Searching LRCLIB for query: "${query}"`);
  const results = await fetchLrclibLyrics(query);

  if (!results || results.length === 0) {
    throw new Error(`No search results returned from LRCLIB for query: ${query}`);
  }

  // Whisper 가사 텍스트 전문 조립
  const whisperText = whisperLyrics.map(l => l.text).join(" ");
  const hasWhisper = whisperText.trim().length > 0;

  // 결과 목록에서 가사 텍스트(plainLyrics)가 존재하는 트랙을 찾음
  for (const item of results) {
    const lyricsText = item.plainLyrics;
    if (lyricsText && lyricsText.trim().length > 0) {
      // 빈 줄 제외 정형화
      const normalizedLyrics = lyricsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("\n");

      if (normalizedLyrics.split("\n").length >= 5) {
        // Whisper 가사가 있을 경우 1차 유사도 15% 기각 필터 적용
        if (hasWhisper) {
          const similarity = calculateBigramSimilarity(whisperText, normalizedLyrics);
          if (similarity < 0.15) {
            console.log(`[Scraper] Rejected mismatched lyrics from LRCLIB (${item.artistName} - ${item.trackName}) (Similarity: ${(similarity * 100).toFixed(1)}%)`);
            continue;
          }
        }
        console.log(`[Scraper] Successfully found lyrics from LRCLIB (${item.artistName} - ${item.trackName})`);
        return normalizedLyrics;
      }
    }
  }

  throw new Error(`Failed to find matching or valid lyrics in LRCLIB search results for query: ${query}`);
}

module.exports = {
  scrapeLyrics,
  getCleanSearchQuery,
  calculateBigramSimilarity
};
