const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getActiveLineIndex,
  serializeLrc,
  serializeVtt,
  resolveTrackMeta
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
