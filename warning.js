const detail = document.getElementById("detail");
const statusText = document.getElementById("status");
let recoveryCountdownTimer = null;

chrome.storage.local.get(["lastCheck"], ({ lastCheck }) => {
  renderStatus(lastCheck);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.lastCheck) {
    return;
  }

  const lastCheck = changes.lastCheck.newValue;
  renderStatus(lastCheck);
});

function renderStatus(lastCheck = {}) {
  if (lastCheck.recoveryPhase === "cleared" || lastCheck.recoveryActive === false && lastCheck.tooClose === false) {
    stopRecoveryCountdown();
    detail.textContent = "You are far enough back now. You can return to your page when ready.";
    statusText.textContent = "Distance restored";
    return;
  }

  if (lastCheck.recoveryPhase === "confirming-distance") {
    detail.textContent = "Good. Stay back for a few more seconds so we know you have really reset your distance.";
    startRecoveryCountdown(lastCheck.recoveryConfirmUntil || 0, Math.ceil((lastCheck.recoveryConfirmRemainingMs || 0) / 1000));
    return;
  }

  stopRecoveryCountdown();

  if (lastCheck.recoveryPhase === "waiting-for-distance") {
    detail.textContent = "Keep moving back until the camera sees enough distance.";
    statusText.textContent = "Looking for a safe distance";
    return;
  }

  detail.textContent = "This page will update once you move back and hold that distance.";
  statusText.textContent = "Checking every second";
}

function startRecoveryCountdown(confirmUntil, fallbackSeconds) {
  stopRecoveryCountdown();

  const update = () => {
    const seconds = confirmUntil
      ? Math.max(0, Math.ceil((confirmUntil - Date.now()) / 1000))
      : Math.max(0, fallbackSeconds);

    statusText.textContent = seconds > 0
      ? `Clearing in ${seconds}s if you stay back`
      : "Almost clear";

    if (seconds <= 0) {
      stopRecoveryCountdown();
    }
  };

  update();
  recoveryCountdownTimer = setInterval(update, 250);
}

function stopRecoveryCountdown() {
  if (!recoveryCountdownTimer) {
    return;
  }

  clearInterval(recoveryCountdownTimer);
  recoveryCountdownTimer = null;
}
