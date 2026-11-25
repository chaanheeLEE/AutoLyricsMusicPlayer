const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ModelSettingsPanel,
  buildInstalledModelSelectOptions,
  describeCudaStatusView,
  describeVocalModelStatusView,
  applyProgressBarUpdate
} = require("../src/renderer/modules/model-settings-panel");

test("buildInstalledModelSelectOptions handles empty, matching selection, and fallback to first installed model", () => {
  const emptyOpts = buildInstalledModelSelectOptions([{ id: "base", downloaded: false }], "base");
  assert.equal(emptyOpts.length, 1);
  assert.equal(emptyOpts[0].disabled, true);
  assert.equal(emptyOpts[0].selected, true);

  const models = [
    { id: "tiny", label: "tiny", sizeLabel: "75 MB", downloaded: true },
    { id: "base", label: "base", sizeLabel: "145 MB", badge: "기본값", downloaded: true },
    { id: "small", label: "small", sizeLabel: "480 MB", downloaded: false }
  ];

  const matched = buildInstalledModelSelectOptions(models, "base");
  assert.equal(matched.length, 2);
  assert.equal(matched[0].selected, false);
  assert.equal(matched[1].selected, true);
  assert.equal(matched[1].text, "base — 145 MB (기본값)");

  const fallback = buildInstalledModelSelectOptions(models, "small");
  assert.equal(fallback[0].selected, true);
  assert.equal(fallback[1].selected, false);
});

test("describeCudaStatusView resolves all four installation and GPU states", () => {
  const custom = describeCudaStatusView({
    installed: true,
    isCustomInstalled: true,
    gpuName: "RTX 4070",
    diskSizeFormatted: "620.0 MB"
  });
  assert.equal(custom.badgeClass, "installed");
  assert.equal(custom.sizeText, "(620.0 MB)");
  assert.equal(custom.actionMode, "custom-installed");
  assert.match(custom.descText, /RTX 4070/);

  const system = describeCudaStatusView({ installed: true, isSystemInstalled: true });
  assert.equal(system.actionMode, "system-installed");

  const noGpu = describeCudaStatusView({ installed: false, hasNvidia: false });
  assert.equal(noGpu.badgeClass, "no-gpu");
  assert.equal(noGpu.actionMode, "install");

  const readyToInstall = describeCudaStatusView({
    installed: false,
    hasNvidia: true,
    gpuName: "RTX 3060"
  });
  assert.equal(readyToInstall.badgeClass, "not-installed");
  assert.equal(readyToInstall.actionMode, "install");
  assert.match(readyToInstall.descText, /RTX 3060 감지됨/);
});

test("describeVocalModelStatusView distinguishes downloading, installed, and not-installed states", () => {
  const downloading = describeVocalModelStatusView({ installed: false, diskSizeFormatted: "약 64 MB" }, true);
  assert.equal(downloading.actionMode, "downloading");
  assert.equal(downloading.optionDisabled, true);

  const installed = describeVocalModelStatusView({ installed: true, diskSizeFormatted: "63.8 MB" }, false);
  assert.equal(installed.badgeClass, "installed");
  assert.equal(installed.actionMode, "installed");
  assert.equal(installed.optionDisabled, false);

  const missing = describeVocalModelStatusView({ installed: false, diskSizeFormatted: "약 64 MB" }, false);
  assert.equal(missing.badgeClass, "not-installed");
  assert.equal(missing.actionMode, "install");
});

test("applyProgressBarUpdate updates area visibility/width/text and resets on terminal stages", () => {
  const areaEl = { style: { display: "none" } };
  const fillEl = { style: { width: "0%" } };
  const textEl = { textContent: "" };

  const activeRes = applyProgressBarUpdate(
    { areaEl, fillEl, textEl },
    { stage: "downloading", percent: 0.456, message: "Downloading 46%" }
  );
  assert.equal(activeRes.isTerminal, false);
  assert.equal(areaEl.style.display, "flex");
  assert.equal(fillEl.style.width, "46%");
  assert.equal(textEl.textContent, "Downloading 46%");

  const doneRes = applyProgressBarUpdate({ areaEl, fillEl, textEl }, { stage: "done" });
  assert.equal(doneRes.isTerminal, true);
  assert.equal(areaEl.style.display, "none");
});

test("ModelSettingsPanel terminal progress events clear download flags and trigger status refresh", async () => {
  const elements = {
    "#cudaProgressBarArea": { style: { display: "none" } },
    "#cudaProgressFill": { style: { width: "0%" } },
    "#cudaProgressText": { textContent: "" },
    "#cudaStatusBadge": { className: "", textContent: "" },
    "#vocalModelProgressArea": { style: { display: "none" } },
    "#vocalModelProgressFill": { style: { width: "0%" } },
    "#vocalModelProgressText": { textContent: "" },
    "#vocalModelStatusBadge": { className: "", textContent: "" }
  };

  let cudaChecks = 0;
  let vocalChecks = 0;
  const panel = new ModelSettingsPanel({
    state: { settings: {} },
    doc: {
      querySelector: (sel) => elements[sel] || null
    },
    api: {
      checkCudaStatus: async () => {
        cudaChecks += 1;
        return null;
      },
      getVocalModelStatus: async () => {
        vocalChecks += 1;
        return null;
      }
    }
  });

  panel.isCudaDownloading = true;
  panel.handleCudaProgress({ stage: "cancelled" });
  assert.equal(panel.isCudaDownloading, false);
  assert.equal(cudaChecks, 1);

  panel.isVocalModelDownloading = true;
  panel.handleVocalModelProgress({ stage: "done" });
  assert.equal(panel.isVocalModelDownloading, false);
  assert.equal(vocalChecks, 1);
});
