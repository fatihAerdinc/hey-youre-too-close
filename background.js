const DEFAULT_MULTIPLIER = 1.1;
const CHECK_INTERVAL_MS = 30_000;
const RECOVERY_CHECK_INTERVAL_MS = 1_000;
const RECOVERY_CONFIRM_MS = 4_000;
const DAY_PASSED_INTERVAL_MS = 60_000;
const DAILY_CLEAN_CHECKS_FOR_SLOW_INTERVAL = 960;
const IDLE_THRESHOLD_SECONDS = 60;
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";

let loopTimer = null;
let checkInFlight = false;
let recoveryActive = false;
let recoveryCandidateAt = 0;
let dailyCleanCheckStreak = 0;
let dailyCleanCheckDate = "";
let currentCheckIntervalMs = CHECK_INTERVAL_MS;

ensureSensitiveDefault().then(() => scheduleNextCheck());

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) {
    scheduleNextCheck();
    return;
  }

  const existing = await chrome.storage.local.get(["calibrated"]);
  if (!existing.calibrated) {
    await chrome.storage.local.set({
      enabled: true,
      multiplier: DEFAULT_MULTIPLIER
    });
    chrome.tabs.create({ url: chrome.runtime.getURL("calibration.html") });
  }

  scheduleNextCheck();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleNextCheck();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RECALIBRATE") {
    handleRecalibrate().then(sendResponse);
    return true;
  }

  if (message?.type === "CALIBRATION_COMPLETE") {
    scheduleNextCheck();
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.enabled || changes.calibrated || changes.threshold) {
    resetAdaptiveInterval().then(() => scheduleNextCheck());
  }
});

async function handleRecalibrate() {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    enabled: true,
    multiplier: DEFAULT_MULTIPLIER
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL("calibration.html?recalibrate=1") });
  return { ok: true };
}

async function ensureSensitiveDefault() {
  const { baseline, calibrated, multiplier } = await chrome.storage.local.get([
    "baseline",
    "calibrated",
    "multiplier"
  ]);

  if (!calibrated || !baseline || multiplier < 1.25) {
    return;
  }

  await chrome.storage.local.set({
    multiplier: DEFAULT_MULTIPLIER,
    threshold: baseline * DEFAULT_MULTIPLIER
  });
}

async function scheduleNextCheck(delayMs = CHECK_INTERVAL_MS) {
  if (loopTimer) {
    clearTimeout(loopTimer);
  }

  const { calibrated, enabled } = await chrome.storage.local.get(["calibrated", "enabled"]);
  if (!enabled || !calibrated) {
    return;
  }

  loopTimer = setTimeout(runCheckLoop, delayMs);
}

async function runCheckLoop() {
  if (checkInFlight) {
    scheduleNextCheck();
    return;
  }

  checkInFlight = true;

  try {
    const settings = await chrome.storage.local.get([
      "calibrated",
      "enabled",
      "threshold"
    ]);

    if (!settings.enabled || !settings.calibrated || !settings.threshold) {
      await resetAdaptiveInterval();
      return;
    }

    const idleState = await chrome.idle.queryState(IDLE_THRESHOLD_SECONDS);
    if (idleState !== "active") {
      await saveLastCheck({ skipped: true, reason: "chrome-idle" }, settings.threshold);
      return;
    }

    if (!(await isChromeWindowFocused())) {
      await saveLastCheck({ skipped: true, reason: "chrome-not-focused" }, settings.threshold);
      return;
    }

    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      type: "CHECK_DISTANCE_OFFSCREEN",
      threshold: settings.threshold
    });
    await handleCheckResponse(response, settings.threshold);
  } catch (error) {
    updateBadgeWarning("!");
    await saveLastCheck({
      checked: false,
      error: error?.message || String(error)
    });
  } finally {
    checkInFlight = false;
    scheduleNextCheck(recoveryActive ? RECOVERY_CHECK_INTERVAL_MS : currentCheckIntervalMs);
  }
}

async function handleCheckResponse(response = {}, threshold) {
  if (response.cameraDenied) {
    updateBadgeWarning("CAM");
  }

  const recovery = updateRecoveryState(response);
  await updateAdaptiveInterval(response, recovery);
  const overlay = await updateActiveTabWarning(response, recovery);
  await saveLastCheck({ ...response, ...recovery, ...overlay }, threshold);
}

function updateRecoveryState(response = {}) {
  if (response.tooClose) {
    recoveryActive = true;
    recoveryCandidateAt = 0;
    return {
      recoveryActive,
      recoveryPhase: "too-close",
      warningAction: "show"
    };
  }

  if (!recoveryActive) {
    return {
      recoveryActive: false,
      recoveryPhase: "",
      warningAction: "clear"
    };
  }

  if (!isFarEnough(response)) {
    recoveryCandidateAt = 0;
    return {
      recoveryActive,
      recoveryPhase: "waiting-for-distance",
      warningAction: "show"
    };
  }

  const now = Date.now();
  if (!recoveryCandidateAt) {
    recoveryCandidateAt = now;
    return {
      recoveryActive,
      recoveryPhase: "confirming-distance",
      recoveryConfirmRemainingMs: RECOVERY_CONFIRM_MS,
      recoveryConfirmUntil: recoveryCandidateAt + RECOVERY_CONFIRM_MS,
      warningAction: "show"
    };
  }

  const remainingMs = Math.max(0, RECOVERY_CONFIRM_MS - (now - recoveryCandidateAt));
  if (remainingMs > 0) {
    return {
      recoveryActive,
      recoveryPhase: "confirming-distance",
      recoveryConfirmRemainingMs: remainingMs,
      recoveryConfirmUntil: recoveryCandidateAt + RECOVERY_CONFIRM_MS,
      warningAction: "show"
    };
  }

  recoveryActive = false;
  recoveryCandidateAt = 0;
  return {
    recoveryActive: false,
    recoveryPhase: "cleared",
    recoveryConfirmRemainingMs: 0,
    recoveryConfirmUntil: 0,
    warningAction: "clear"
  };
}

async function updateAdaptiveInterval(response = {}, recovery = {}) {
  await ensureDailyCleanStreak();

  if (recovery.warningAction === "show" || response.tooClose || response.error || response.cameraDenied) {
    await resetAdaptiveInterval();
    return;
  }

  if (!isPassingCheck(response)) {
    await resetAdaptiveInterval();
    return;
  }

  dailyCleanCheckStreak += 1;
  currentCheckIntervalMs = dailyCleanCheckStreak >= DAILY_CLEAN_CHECKS_FOR_SLOW_INTERVAL
    ? DAY_PASSED_INTERVAL_MS
    : CHECK_INTERVAL_MS;

  await chrome.storage.local.set({
    dailyCleanCheckDate,
    dailyCleanCheckStreak
  });
}

async function resetAdaptiveInterval() {
  dailyCleanCheckDate = getLocalDateKey();
  dailyCleanCheckStreak = 0;
  currentCheckIntervalMs = CHECK_INTERVAL_MS;
  await chrome.storage.local.set({
    dailyCleanCheckDate,
    dailyCleanCheckStreak
  });
}

async function ensureDailyCleanStreak() {
  const today = getLocalDateKey();

  if (dailyCleanCheckDate === today) {
    return;
  }

  const stored = await chrome.storage.local.get([
    "dailyCleanCheckDate",
    "dailyCleanCheckStreak"
  ]);

  dailyCleanCheckDate = stored.dailyCleanCheckDate || today;
  dailyCleanCheckStreak = Number.isFinite(stored.dailyCleanCheckStreak)
    ? stored.dailyCleanCheckStreak
    : 0;

  if (dailyCleanCheckDate !== today) {
    dailyCleanCheckDate = today;
    dailyCleanCheckStreak = 0;
    currentCheckIntervalMs = CHECK_INTERVAL_MS;
    await chrome.storage.local.set({
      dailyCleanCheckDate,
      dailyCleanCheckStreak
    });
    return;
  }

  currentCheckIntervalMs = dailyCleanCheckStreak >= DAILY_CLEAN_CHECKS_FOR_SLOW_INTERVAL
    ? DAY_PASSED_INTERVAL_MS
    : CHECK_INTERVAL_MS;
}

function getLocalDateKey() {
  return new Date().toLocaleDateString("en-CA");
}

function isFarEnough(response = {}) {
  if (response.error || response.cameraDenied) {
    return false;
  }

  if (response.noFace) {
    return true;
  }

  return response.checked && response.tooClose === false;
}

function isPassingCheck(response = {}) {
  return response.checked &&
    response.tooClose === false &&
    !response.noFace &&
    !response.error &&
    !response.cameraDenied;
}

async function updateActiveTabWarning(response = {}, recovery = {}) {
  const tab = await getFocusedActiveTab();
  if (!isOverlayCapableTab(tab)) {
    if (recovery.warningAction === "show") {
      updateBadgeWarning("!");
    } else {
      clearBadgeWarning();
    }

    return {
      overlayBlocked: recovery.warningAction === "show",
      overlayReason: tab?.url ? "unsupported-tab-notified" : "no-active-tab"
    };
  }

  try {
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, {
      type: recovery.warningAction === "show" ? "SHOW_DISTANCE_OVERLAY" : "CLEAR_DISTANCE_OVERLAY",
      recoveryPhase: recovery.recoveryPhase || "",
      recoveryConfirmRemainingMs: recovery.recoveryConfirmRemainingMs || 0,
      recoveryConfirmUntil: recovery.recoveryConfirmUntil || 0
    });
    if (recovery.warningAction === "clear") {
      clearBadgeWarning();
    }
    return { overlayBlocked: false, overlayReason: "" };
  } catch (error) {
    return {
      overlayBlocked: Boolean(response.tooClose),
      overlayReason: error?.message || "content-script-unavailable"
    };
  }
}

async function isChromeWindowFocused() {
  return Boolean(await getFocusedChromeWindow());
}

async function getFocusedActiveTab() {
  const focusedWindow = await getFocusedChromeWindow();
  if (!focusedWindow?.id) {
    return null;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    windowId: focusedWindow.id
  });
  return tab || null;
}

async function getFocusedChromeWindow() {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  return windows.find((window) => window.focused) || null;
}

function isOverlayCapableTab(tab) {
  return Boolean(
    tab?.id &&
      tab.url &&
      /^(https?:|file:)/.test(tab.url)
  );
}

async function ensureContentScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["overlay.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

function updateBadgeWarning(text) {
  chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
  chrome.action.setBadgeText({ text });
  chrome.action.setTitle({
    title: text === "CAM"
      ? "Camera access needed for Screen Distance Monitor"
      : "Move back from the screen"
  });
}

function clearBadgeWarning() {
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "Screen Distance Monitor" });
}

async function saveLastCheck(response = {}, threshold) {
  await chrome.storage.local.set({
    lastCheck: {
      at: Date.now(),
      checked: Boolean(response.checked),
      skipped: Boolean(response.skipped),
      reason: response.reason || "",
      noFace: Boolean(response.noFace),
      tooClose: Boolean(response.tooClose),
      faceRatio: Number.isFinite(response.faceRatio) ? response.faceRatio : null,
      threshold: Number.isFinite(response.threshold) ? response.threshold : threshold || null,
      overlayBlocked: Boolean(response.overlayBlocked),
      overlayReason: response.overlayReason || "",
      recoveryActive: Boolean(response.recoveryActive),
      recoveryPhase: response.recoveryPhase || "",
      recoveryConfirmRemainingMs: Number.isFinite(response.recoveryConfirmRemainingMs) ? response.recoveryConfirmRemainingMs : 0,
      recoveryConfirmUntil: Number.isFinite(response.recoveryConfirmUntil) ? response.recoveryConfirmUntil : 0,
      cleanCheckStreak: dailyCleanCheckStreak,
      dailyCleanCheckDate,
      dailyCleanCheckStreak,
      nextIntervalMs: recoveryActive ? RECOVERY_CHECK_INTERVAL_MS : currentCheckIntervalMs,
      modelLoaded: Boolean(response.model?.loaded),
      modelMethod: response.model?.method || "",
      modelError: response.model?.error || "",
      timings: response.timings || null,
      error: response.error || ""
    }
  });
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (contexts.length > 0) {
      return;
    }
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["USER_MEDIA"],
      justification: "Capture a single webcam frame for screen-distance checks."
    });
  } catch (error) {
    if (!String(error?.message || error).includes("Only a single offscreen document")) {
      throw error;
    }
  }
}
