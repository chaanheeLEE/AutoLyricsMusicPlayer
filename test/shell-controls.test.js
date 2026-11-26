const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ShellControls,
  DEFAULT_SHORTCUTS,
  shouldIgnoreShortcutTarget,
  resolveShortcutAction,
  computeMutedVolumeToggle
} = require("../src/renderer/modules/shell-controls");

function createFakeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    toggle: (name, force) => {
      if (force === undefined) {
        if (set.has(name)) {
          set.delete(name);
          return false;
        }
        set.add(name);
        return true;
      }
      if (force) set.add(name);
      else set.delete(name);
      return Boolean(force);
    },
    contains: (name) => set.has(name)
  };
}

function createFakeElement(initialClasses = []) {
  const attrs = new Map();
  return {
    classList: createFakeClassList(initialClasses),
    disabled: false,
    title: "",
    innerHTML: "",
    style: {},
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k) ?? null,
    addEventListener: () => {}
  };
}

test("shouldIgnoreShortcutTarget ignores editable inputs and allows non-text inputs", () => {
  assert.equal(shouldIgnoreShortcutTarget(null), false);
  assert.equal(shouldIgnoreShortcutTarget({ tagName: "BUTTON" }), false);
  assert.equal(shouldIgnoreShortcutTarget({ tagName: "INPUT", type: "range" }), false);
  assert.equal(shouldIgnoreShortcutTarget({ tagName: "INPUT", type: "text" }), true);
  assert.equal(shouldIgnoreShortcutTarget({ tagName: "INPUT", type: "password" }), true);
  assert.equal(shouldIgnoreShortcutTarget({ tagName: "INPUT", type: "number" }), true);
  assert.equal(shouldIgnoreShortcutTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(shouldIgnoreShortcutTarget({ tagName: "DIV", isContentEditable: true }), true);
});

test("resolveShortcutAction maps default and custom shortcut key codes", () => {
  assert.equal(resolveShortcutAction("Space", DEFAULT_SHORTCUTS), "togglePlay");
  assert.equal(resolveShortcutAction("KeyF", DEFAULT_SHORTCUTS), "toggleFloating");
  assert.equal(resolveShortcutAction("KeyZ", DEFAULT_SHORTCUTS), null);
  assert.equal(
    resolveShortcutAction("KeyK", { ...DEFAULT_SHORTCUTS, togglePlay: "KeyK" }),
    "togglePlay"
  );
});

test("computeMutedVolumeToggle stores previous volume on mute and restores on unmute", () => {
  assert.deepEqual(computeMutedVolumeToggle(0.6, undefined), {
    nextVolume: 0,
    savedVolume: 0.6
  });
  assert.deepEqual(computeMutedVolumeToggle(0, 0.42), {
    nextVolume: 0.42,
    savedVolume: 0.42
  });
  assert.deepEqual(computeMutedVolumeToggle(0, undefined), {
    nextVolume: 0.85,
    savedVolume: 0.85
  });
});

test("ShellControls switchView and setQueueDrawerOpen update view/drawer classes and ARIA state", () => {
  const elements = {
    "#nowPlayingView": createFakeElement(["active"]),
    "#lyricsEditView": createFakeElement(),
    "#libraryView": createFakeElement(),
    "#navNowPlayingBtn": createFakeElement(["active"]),
    "#navLibraryBtn": createFakeElement(),
    "#queueDrawer": createFakeElement(),
    "#queueToggleButton": createFakeElement(),
    "#floatingButton": createFakeElement()
  };

  const calls = [];
  const state = { editMode: true, floatingVisible: false, settings: {}, playlist: [] };
  const controls = new ShellControls({
    state,
    player: {},
    lyricsViewer: {
      render: () => calls.push("render"),
      renderEditView: () => calls.push("renderEditView")
    },
    playlist: {
      renderLibraryTable: () => calls.push("renderLibraryTable")
    },
    callbacks: {
      onEnterEditView: () => calls.push("onEnterEditView")
    },
    doc: {
      querySelector: (selector) => elements[selector] || null,
      addEventListener: () => {}
    },
    win: {},
    api: {},
    storage: { setItem: () => {} }
  });

  controls.switchView("library");
  assert.equal(elements["#libraryView"].classList.contains("active"), true);
  assert.equal(elements["#nowPlayingView"].classList.contains("active"), false);
  assert.equal(elements["#navLibraryBtn"].classList.contains("active"), true);
  assert.equal(elements["#navNowPlayingBtn"].classList.contains("active"), false);
  assert.equal(state.editMode, false);
  assert.deepEqual(calls, ["renderLibraryTable"]);

  controls.switchView("lyrics-edit");
  assert.equal(elements["#lyricsEditView"].classList.contains("active"), true);
  assert.deepEqual(calls, ["renderLibraryTable", "onEnterEditView", "renderEditView"]);

  controls.switchView("now-playing");
  assert.equal(elements["#nowPlayingView"].classList.contains("active"), true);
  assert.equal(elements["#navNowPlayingBtn"].classList.contains("active"), true);
  assert.equal(calls.at(-1), "render");

  controls.setQueueDrawerOpen(true);
  assert.equal(elements["#queueDrawer"].classList.contains("open"), true);
  assert.equal(elements["#queueToggleButton"].classList.contains("active"), true);
  assert.equal(elements["#queueToggleButton"].getAttribute("aria-pressed"), "true");

  controls.setQueueDrawerOpen(false);
  assert.equal(elements["#queueDrawer"].classList.contains("open"), false);
  assert.equal(elements["#queueToggleButton"].getAttribute("aria-pressed"), "false");
});

test("ShellControls handlePlaybackCommand dispatches player controls and closes active floating window", async () => {
  const playerCalls = [];
  const stored = new Map();
  const state = { floatingVisible: true, settings: {}, playlist: [] };
  const controls = new ShellControls({
    state,
    player: {
      togglePlay: () => playerCalls.push("togglePlay"),
      prev: () => playerCalls.push("prev"),
      next: () => playerCalls.push("next"),
      getCurrentTime: () => 12.5,
      isPlaying: () => true
    },
    lyricsViewer: {
      updateActive: (t, p) => playerCalls.push(`updateActive:${t}:${p}`)
    },
    playlist: {},
    doc: {
      querySelector: () => createFakeElement(),
      addEventListener: () => {}
    },
    win: {},
    api: {
      toggleFloating: async (nextVisible) => {
        playerCalls.push(`toggleFloating:${nextVisible}`);
        return nextVisible;
      }
    },
    storage: {
      setItem: (k, v) => stored.set(k, v)
    }
  });

  controls.handlePlaybackCommand("toggle-play");
  controls.handlePlaybackCommand("prev-track");
  controls.handlePlaybackCommand("next-track");
  controls.handlePlaybackCommand("close-floating");
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(playerCalls, [
    "togglePlay",
    "prev",
    "next",
    "toggleFloating:false",
    "updateActive:12.5:true"
  ]);
  assert.equal(state.floatingVisible, false);
  assert.equal(stored.get("floating_visible"), "false");
});
