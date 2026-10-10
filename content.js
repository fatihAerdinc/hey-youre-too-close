(() => {
  if (globalThis.__screenDistanceMonitorContentLoaded) {
    return;
  }

  globalThis.__screenDistanceMonitorContentLoaded = true;
  globalThis.__screenDistanceMonitorRecoveryTimer = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SHOW_DISTANCE_OVERLAY") {
      showOverlay(message);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "CLEAR_DISTANCE_OVERLAY") {
      removeOverlay();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  function showOverlay(message = {}) {
    let overlay = document.getElementById("sdm-distance-overlay");

    if (overlay) {
      updateOverlayStatus(overlay, message);
      return;
    }

    overlay = document.createElement("div");
    overlay.id = "sdm-distance-overlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-live", "assertive");
    overlay.innerHTML = `
      <div class="sdm-blur-layer" aria-hidden="true"></div>
      <div class="sdm-overlay-panel">
        <p class="sdm-overlay-kicker">Screen Distance Monitor</p>
        <h1>Move back</h1>
        <p id="sdm-overlay-copy" class="sdm-overlay-copy">You are too close. This warning clears automatically after you move back and hold that distance.</p>
        <div id="sdm-recovery-meter" class="sdm-recovery-meter">Checking every second</div>
      </div>
    `;

    const mount = document.fullscreenElement || document.body || document.documentElement;
    mount.appendChild(overlay);
    updateOverlayStatus(overlay, message);
  }

  function removeOverlay() {
    stopRecoveryCountdown();
    document.getElementById("sdm-distance-overlay")?.remove();
  }

  function updateOverlayStatus(overlay, message = {}) {
    const copy = overlay.querySelector("#sdm-overlay-copy");
    const meter = overlay.querySelector("#sdm-recovery-meter");
    const remainingSeconds = Math.ceil((message.recoveryConfirmRemainingMs || 0) / 1000);

    if (message.recoveryPhase === "confirming-distance") {
      copy.textContent = "Good. Stay back for a few more seconds so we know you have really reset your distance.";
      startRecoveryCountdown(meter, message.recoveryConfirmUntil || 0, remainingSeconds);
      return;
    }

    stopRecoveryCountdown();

    if (message.recoveryPhase === "waiting-for-distance") {
      copy.textContent = "Keep moving back until the camera sees enough distance.";
      meter.textContent = "Looking for a safe distance";
      return;
    }

    copy.textContent = "You are too close. This warning clears automatically after you move back and hold that distance.";
    meter.textContent = "Checking every second";
  }

  function startRecoveryCountdown(meter, confirmUntil, fallbackSeconds) {
    stopRecoveryCountdown();

    const update = () => {
      const seconds = confirmUntil
        ? Math.max(0, Math.ceil((confirmUntil - Date.now()) / 1000))
        : Math.max(0, fallbackSeconds);

      meter.textContent = seconds > 0
        ? `Clearing in ${seconds}s if you stay back`
        : "Almost clear";

      if (seconds <= 0) {
        stopRecoveryCountdown();
      }
    };

    update();
    globalThis.__screenDistanceMonitorRecoveryTimer = setInterval(update, 250);
  }

  function stopRecoveryCountdown() {
    if (!globalThis.__screenDistanceMonitorRecoveryTimer) {
      return;
    }

    clearInterval(globalThis.__screenDistanceMonitorRecoveryTimer);
    globalThis.__screenDistanceMonitorRecoveryTimer = null;
  }
})();
