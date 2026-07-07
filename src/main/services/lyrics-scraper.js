const https = require("node:https");

/**
 * DuckDuckGo HTML 검색을 수행하여 결과 페이지를 반환합니다.
 */
function fetchSearchPage(query) {
  return new Promise((resolve, reject) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    };
    https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`DuckDuckGo search failed (HTTP ${res.statusCode})`));
        return;
      }
      let html = "";
      res.on("data", (chunk) => {
        html += chunk;
      });
      res.on("end", () => {
        resolve(html);
      });
    }).on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * DuckDuckGo 검색결과 HTML에서 실제 웹페이지들의 목적지 URL 리스트를 추출합니다.
 */
function extractTargetUrls(html) {
  const urls = new Set();
  const regex = /uddg=([^&"]+)/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(match[1]);
      if (decoded.startsWith("http") && !decoded.includes("youtube.com") && !decoded.includes("duckduckgo.com")) {
        urls.add(decoded);
      }
    } catch {
      // ignore decoding errors
    }
  }
  return Array.from(urls);
}

/**
 * 특정 가사 상세 페이지 HTML을 직접 다운로드합니다.
 */
function fetchLyricsPage(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": "https://html.duckduckgo.com/",
        "Cache-Control": "max-age=0",
        "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1"
      }
    };
    
    https.get(options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch lyrics page (HTTP ${res.statusCode})`));
        return;
      }
      let html = "";
      res.on("data", (chunk) => {
        html += chunk;
      });
      res.on("end", () => {
        resolve(html);
      });
    }).on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * HTML 문서에서 가장 유력한 가사 문단 영역을 범용적으로 추출합니다.
 * (HTML 본문 내 <br> 태그가 대량으로 들어 있는 div/p 블록을 선별하는 텍스트 밀도 알고리즘 활용)
 */
function parseLyricsFromHtml(html) {
  // 노이즈가 되는 불필요 태그들 미리 제거
  const cleanHtml = html
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<nav[^>]*>([\s\S]*?)<\/nav>/gi, "")
    .replace(/<header[^>]*>([\s\S]*?)<\/header>/gi, "")
    .replace(/<footer[^>]*>([\s\S]*?)<\/footer>/gi, "");

  // 가사 본문은 주로 div 또는 p 태그 안에 대량의 <br>로 조밀하게 나열됩니다.
  const regexDiv = /<(div|p|span)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  const candidates = [];

  while ((match = regexDiv.exec(cleanHtml)) !== null) {
    const content = match[2];
    const brCount = (content.match(/<br\s*\/?>/gi) || []).length;
    // 가사는 최소 8소절 이상의 개행이 보장되어야 합니다.
    if (brCount >= 8) {
      candidates.push({
        htmlContent: content,
        brCount: brCount
      });
    }
  }

  if (candidates.length > 0) {
    // br 개수가 가장 많아 매칭 정확도가 가장 높은 최적의 가사 단락 선별
    candidates.sort((a, b) => b.brCount - a.brCount);
    return cleanHtmlText(candidates[0].htmlContent);
  }

  return null;
}

/**
 * HTML 엔티티 제거 및 순수 텍스트 줄바꿈 변환을 수행합니다.
 */
function cleanHtmlText(htmlContent) {
  if (!htmlContent) return "";
  
  let cleaned = htmlContent
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "") // 모든 나머지 HTML 태그 필터링
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&rsquo;/g, "'");

  // 의미 없는 빈 줄 제외 정형화
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return cleaned;
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
  
  name = name.trim();
  return `${name} 가사`;
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
 * 가사 스크래퍼 통합 실행 함수 (Whisper 가사를 받아 유사도 검증 수행, 수동 쿼리 지원)
 */
async function scrapeLyrics(track, whisperLyrics = [], customQuery = null) {
  // 수동 검색 쿼리가 있으면 그것을 최우선 사용하고, 없으면 정제된 기본 파일명 쿼리 사용
  const query = customQuery ? `${customQuery.trim()} 가사` : getCleanSearchQuery(track);
  if (!query) {
    throw new Error("Invalid track title for query generation");
  }

  // 1. DuckDuckGo HTML 검색
  const searchHtml = await fetchSearchPage(query);
  const targetUrls = extractTargetUrls(searchHtml);

  if (targetUrls.length === 0) {
    throw new Error(`No search results returned for query: ${query}`);
  }

  // 원래 검색 결과의 인덱스 랭킹 매핑 (검색 자연 순위 가치 보존)
  const urlRankMap = new Map();
  targetUrls.forEach((url, index) => urlRankMap.set(url, index));

  // 선호 가사 사이트 우선순위 가중치 정렬 (보안 차단율이 높은 멜론/벅스/지니는 배제하고 스크래핑이 편안한 전문 사이트 위주로 선정)
  const preferredDomains = ["lyrics.co.kr", "dbcut.com", "genius.com"];
  
  const getUrlScore = (url) => {
    const originalIndex = urlRankMap.get(url) ?? 999;
    const domainIndex = preferredDomains.findIndex(domain => url.includes(domain));
    
    let score = originalIndex;
    if (domainIndex !== -1) {
      // 선호 전문 도메인인 경우 랭킹 가중치 보너스 혜택 감산 (우선 도메인에 따라 마이너스 점수로 인상 혜택)
      score -= (preferredDomains.length - domainIndex) * 3;
    }
    return score;
  };

  targetUrls.sort((a, b) => getUrlScore(a) - getUrlScore(b));

  // Whisper 가사 텍스트 전문 조립
  const whisperText = whisperLyrics.map(l => l.text).join(" ");
  const hasWhisper = whisperText.trim().length > 0;

  // 2. 상위 5개 검색 결과 링크에 대해 가사 전문 다운로드 및 추출 시도 (성공률 극대화)
  let lastError = null;
  for (let i = 0; i < Math.min(targetUrls.length, 5); i++) {
    const targetUrl = targetUrls[i];
    try {
      const pageHtml = await fetchLyricsPage(targetUrl);
      const lyricsText = parseLyricsFromHtml(pageHtml);
      if (lyricsText && lyricsText.split("\n").length >= 5) {
        // Whisper 가사가 있을 경우 1차 유사도 15% 기각 필터 적용
        if (hasWhisper) {
          const similarity = calculateBigramSimilarity(whisperText, lyricsText);
          if (similarity < 0.15) {
            console.log(`[Scraper] Rejected mismatched lyrics from ${targetUrl} (Similarity: ${(similarity * 100).toFixed(1)}%)`);
            continue;
          }
        }
        return lyricsText;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to extract lyrics from top search results. ${lastError ? lastError.message : "No matching/valid lyric blocks found."}`
  );
}

module.exports = {
  scrapeLyrics,
  getCleanSearchQuery,
  calculateBigramSimilarity
};
