const DEFAULT_MULTIPLIER = 1.1;

const statusDot = document.getElementById("status-dot");
const statusLabel = document.getElementById("status-label");
const statusDetail = document.getElementById("status-detail");
const enabledToggle = document.getElementById("enabled");
const sensitivity = document.getElementById("sensitivity");
const multiplierLabel = document.getElementById("multiplier-label");
const lastCheckText = document.getElementById("last-check");
const recalibrateButton = document.getElementById("recalibrate");

let baseline = null;

document.addEventListener("DOMContentLoaded", loadSettings);
enabledToggle.addEventListener("change", updateEnabled);
sensitivity.addEventListener("input", updateSensitivity);
recalibrateButton.addEventListener("click", recalibrate);

async function loadSettings() {
  const settings = await chrome.storage.local.get([
    "baseline",
    "calibrated",
    "enabled",
    "multiplier",
    "threshold",
    "varianceWarning",
    "lastCheck"
  ]);

  baseline = settings.baseline || null;
  enabledToggle.checked = settings.enabled !== false;
  sensitivity.value = String(settings.multiplier || DEFAULT_MULTIPLIER);
  multiplierLabel.textContent = formatMultiplier(sensitivity.value);
  sensitivity.disabled = !settings.calibrated || !baseline;

  renderStatus(settings);
  renderLastCheck(settings.lastCheck);
}

function renderStatus(settings) {
  statusDot.classList.toggle("ready", Boolean(settings.calibrated));

  if (!settings.calibrated) {
    statusLabel.textContent = "Not calibrated";
    statusDetail.textContent = "Run calibration before checks start.";
    return;
  }

  statusLabel.textContent = settings.enabled === false ? "Calibrated, paused" : "Calibrated";
  statusDetail.textContent = settings.varianceWarning
    ? "Lighting looked unstable during calibration."
    : `Threshold multiplier ${formatMultiplier(settings.multiplier || DEFAULT_MULTIPLIER)}`;
}

async function updateEnabled() {
  await chrome.storage.local.set({ enabled: enabledToggle.checked });
  loadSettings();
}

async function updateSensitivity() {
  const multiplier = Number(sensitivity.value);
  multiplierLabel.textContent = formatMultiplier(multiplier);

  if (!baseline) {
    return;
  }

  await chrome.storage.local.set({
    multiplier,
    threshold: baseline * multiplier
  });

  loadSettings();
}

function formatMultiplier(value) {
  return `${Number(value).toFixed(2).replace(/0$/, "")}x`;
}

function renderLastCheck(lastCheck) {
  if (!lastCheck) {
    lastCheckText.textContent = "No checks yet.";
    return;
  }

  const secondsAgo = Math.max(0, Math.round((Date.now() - lastCheck.at) / 1000));

  if (lastCheck.error) {
    lastCheckText.textContent = `Last check: ${formatAgo(secondsAgo)} - could not check.`;
    return;
  }

  if (lastCheck.skipped) {
    lastCheckText.textContent = `Last check: ${formatAgo(secondsAgo)} - ${getSkippedCheckText(lastCheck.reason)}.`;
    return;
  }

  if (lastCheck.noFace) {
    lastCheckText.textContent = `Last check: ${formatAgo(secondsAgo)} - no face detected.`;
    return;
  }

  if (lastCheck.faceRatio) {
    const result = getSimpleCheckResult(lastCheck);
    const cadence = getCadenceText(lastCheck);
    lastCheckText.textContent = `Last check: ${formatAgo(secondsAgo)} - ${result}. ${cadence}`;
    return;
  }

  lastCheckText.textContent = `Last check: ${formatAgo(secondsAgo)}.`;
}

function getSkippedCheckText(reason) {
  if (reason === "chrome-not-focused") {
    return "skipped because Chrome was not active";
  }

  if (reason === "chrome-idle") {
    return "skipped because you were inactive";
  }

  if (reason === "hidden-page") {
    return "skipped because the page was hidden";
  }

  return "skipped";
}

function getSimpleCheckResult(lastCheck) {
  if (lastCheck.tooClose) {
    return lastCheck.overlayBlocked
      ? "too close, but this page cannot show the warning"
      : "too close";
  }

  if (lastCheck.recoveryPhase === "confirming-distance") {
    return "good distance, keep it there for a few seconds";
  }

  const ratio = Number(lastCheck.faceRatio);
  const threshold = Number(lastCheck.threshold);
  if (Number.isFinite(ratio) && Number.isFinite(threshold) && threshold > 0) {
    return ratio >= threshold * 0.85
      ? "cutting it close"
      : "good distance";
  }

  return "checked";
}

function getCadenceText(lastCheck) {
  if (!Number.isFinite(lastCheck.nextIntervalMs) || lastCheck.nextIntervalMs <= 0) {
    return "";
  }

  const cleanCheckCount = Number.isFinite(lastCheck.dailyCleanCheckStreak)
    ? lastCheck.dailyCleanCheckStreak
    : lastCheck.cleanCheckStreak;
  const cleanText = Number.isFinite(cleanCheckCount)
    ? ` Clean checks today: ${cleanCheckCount}.`
    : "";
  const seconds = Math.round(lastCheck.nextIntervalMs / 1000);
  if (seconds < 60) {
    return `Next check: ${seconds}s.${cleanText}`;
  }

  const minutes = Math.round(seconds / 60);
  return `Next check: ${minutes}m.${cleanText}`;
}

function formatAgo(secondsAgo) {
  if (secondsAgo < 60) {
    return `${secondsAgo}s ago`;
  }

  const minutesAgo = Math.round(secondsAgo / 60);
  return `${minutesAgo}m ago`;
}

async function recalibrate() {
  recalibrateButton.disabled = true;
  await chrome.runtime.sendMessage({ type: "RECALIBRATE" });
  window.close();
}
