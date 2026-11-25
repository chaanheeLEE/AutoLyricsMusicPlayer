const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getActiveLineIndex,
  serializeLrc,
  serializeVtt,
  resolveTrackMeta,
  syncShuffleQueue,
  resolveLyricsFontFamily
} = require("../src/shared/lyrics-core");

const lyrics = [
  { id: "line_1", start: 0, end: 2, text: "first" },
  { id: "line_2", start: 2.5, end: 5, text: "second" }
];

test("finds the active lyric line with sync offset", () => {
  assert.equal(getActiveLineIndex(lyrics, 2, 0.5), 1);
  assert.equal(getActiveLineIndex(lyrics, 1, 0), 0);
});

test("serializes LRC and clamps negative timestamps", () => {
  assert.equal(serializeLrc(lyrics, 1).split("\n")[0], "[00:00.00]first");
});

test("serializes VTT cues", () => {
  const output = serializeVtt(lyrics, 0);
  assert.match(output, /^WEBVTT/);
  assert.match(output, /00:00:02.500 --> 00:00:05.000/);
});

test("resolves rich track metadata and falls back to filename", () => {
  const rich = resolveTrackMeta({
    fileName: "03_track.mp3",
    title: "Midnight Bloom",
    artist: "Luna Park",
    album: "Nightfall EP",
    trackNumber: 3,
    year: "2024",
    duration: 228.4,
    metadataLoaded: true
  });
  assert.equal(rich.title, "Midnight Bloom");
  assert.equal(rich.artist, "Luna Park");
  assert.equal(rich.album, "Nightfall EP");
  assert.equal(rich.trackNumber, 3);
  assert.equal(rich.duration, 228.4);

  const fallback = resolveTrackMeta("Luna Park - Slow Motion.flac");
  assert.equal(fallback.title, "Slow Motion");
  assert.equal(fallback.artist, "Luna Park");
  assert.equal(fallback.album, "");
});

test("syncShuffleQueue plays every other track once per cycle without repeating currentTrack", () => {
  const tracks = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  let current = tracks[0];
  let queue = syncShuffleQueue(tracks, current, [], () => 0.42);

  assert.equal(queue.length, 3);
  assert.ok(!queue.includes(current));

  const cycleVisited = [];
  for (let i = 0; i < 3; i++) {
    const next = queue[0];
    assert.notEqual(next, current);
    cycleVisited.push(next);
    current = next;
    queue = queue.filter((t) => t !== current);
  }

  assert.equal(new Set(cycleVisited).size, 3);
  assert.equal(queue.length, 0);

  // When exhausted, new deck still avoids immediately replaying the current track
  const replenished = syncShuffleQueue(tracks, current, queue, () => 0.77);
  assert.equal(replenished.length, 3);
  assert.notEqual(replenished[0], current);

  // Prunes removed tracks and preserves remaining valid order
  const reducedPlaylist = tracks.filter((t) => t !== replenished[0]);
  const pruned = syncShuffleQueue(reducedPlaylist, current, replenished);
  assert.equal(pruned.length, 2);
  assert.ok(!pruned.includes(replenished[0]));
  assert.deepEqual(pruned, replenished.slice(1));
});

test("resolveLyricsFontFamily resolves presets, sanitizes custom fonts, and falls back safely", () => {
  assert.match(resolveLyricsFontFamily("default"), /Malgun Gothic/);
  assert.match(resolveLyricsFontFamily("serif"), /Noto Serif KR/);
  assert.match(resolveLyricsFontFamily("rounded"), /NanumSquareRound.*나눔스퀘어라운드/);
  assert.match(resolveLyricsFontFamily("mono"), /^"D2Coding"/);

  const custom = resolveLyricsFontFamily("custom", 'NanumMyeongjo, "Gowun Batang", sans-serif');
  assert.match(custom, /^"NanumMyeongjo", "Gowun Batang", sans-serif, "Malgun Gothic"/);

  // Unsafe characters are stripped and empty custom falls back to default
  const sanitized = resolveLyricsFontFamily("custom", 'Bad;Font{Name}');
  assert.match(sanitized, /^"BadFontName", "Malgun Gothic"/);
  assert.equal(resolveLyricsFontFamily("custom", "   "), resolveLyricsFontFamily("default"));
  assert.equal(resolveLyricsFontFamily("unknown-preset"), resolveLyricsFontFamily("default"));
});
