# Screen Distance Monitor - Resume Summary

## Short Resume Entry

**Screen Distance Monitor** - Built a Manifest V3 Chrome extension that uses webcam-based face detection to warn users when they sit too close to the screen. Implemented first-run calibration, extension-owned camera capture, day-scoped monitoring cadence, automatic recovery checks, and a full-screen blur warning overlay using Vanilla JavaScript, Chrome Extension APIs, Chrome Storage, and `face-api.js` TinyFaceDetector.

## Resume Bullets

- Developed a privacy-conscious Chrome MV3 extension that detects screen proximity locally using webcam frames and `face-api.js` TinyFaceDetector.
- Built a 10-second calibration workflow that samples face-size ratios, validates sample quality, stores baseline distance data, and supports recalibration from the popup.
- Implemented an MV3 offscreen document pipeline for extension-owned camera access, avoiding per-website camera permission prompts while keeping inference client-side.
- Designed a background scheduler that runs 30-second normal checks, switches to 1-second recovery checks during warnings, and relaxes to 60-second checks only after a long same-day clean streak.
- Created an automatic recovery loop that keeps the warning visible until the user moves far enough back and maintains that distance for several seconds.
- Built a full-screen blur/dim overlay injected into eligible pages, with fallback badge signaling for protected Chrome or extension pages that cannot be modified.
- Added robust runtime diagnostics in the popup, including calibration status, enabled state, sensitivity multiplier, last face ratio, threshold, model-loader path, recovery phase, clean-check streak, and next-check interval.
- Improved detection reliability with camera warmup, multi-frame sampling, downscaled canvas processing, multiple TinyFaceDetector input sizes, and packaged-weight fallback loading.

## Technical Stack

- **Languages:** JavaScript, HTML, CSS, JSON
- **Platform:** Chrome Extension Manifest V3
- **Computer Vision:** `face-api.js`, TinyFaceDetector model weights
- **Browser APIs:** Chrome Storage API, Tabs API, Scripting API, Idle API, Offscreen Documents API, Action Badge API
- **Web APIs:** `navigator.mediaDevices.getUserMedia`, `<video>`, `<canvas>`, `fetch`, `setTimeout`, `setInterval`
- **Architecture:** Background service worker, offscreen camera worker, content script overlay, popup UI, calibration page
- **Data Storage:** `chrome.storage.local`
- **UI:** Vanilla JavaScript, responsive HTML/CSS, full-screen blur overlay, diagnostic popup, calibration screen

## Key Features

- **First-install calibration:** Opens calibration automatically on install and records a personalized baseline distance.
- **Sensitivity control:** Popup slider adjusts the threshold multiplier using stored baseline data.
- **Local ML inference:** All camera frames are processed locally in the browser.
- **Extension-owned camera checks:** Offscreen document performs camera capture and model inference independent of website camera permissions.
- **Recovery mode:** After a warning, checks every second until the user moves back and holds distance long enough.
- **Day-scoped cadence:** Normal checks run every 30 seconds, recovery checks run every 1 second, and all-day clean streaks can relax checks to 60 seconds until the next day or failed check.
- **Protected-page handling:** Detects when Chrome blocks overlay injection and uses the extension action badge instead of redirecting tabs.
- **Diagnostics:** Popup exposes model status, ratio/threshold comparison, recovery phase, and scheduler cadence for debugging.

## Implementation Details

- Uses face bounding box ratio, computed from the larger of `box.height / frame.height` and `box.width / frame.width`, to estimate relative distance from the screen.
- Captures camera frames in `offscreen.js`, warms up the stream, samples multiple frames, then immediately stops camera tracks after each check.
- Loads TinyFaceDetector from packaged model files, with a fallback path that manually fetches the manifest and shard, decodes weights, and loads them into the model.
- Runs scheduling in `background.js`, including idle-user skipping, warning state, recovery confirmation timing, same-day clean-check streaks, and overlay messaging.
- Keeps page manipulation isolated in `content.js`, which only shows or clears the warning overlay.
- Stores settings and diagnostics in `chrome.storage.local`, including baseline, threshold, multiplier, calibration state, enabled state, variance warning, last check, model status, and next interval.

## Quantifiable Metrics

- **Scheduler cadence:** Normal monitoring runs at 30-second intervals, or about 120 checks/hour. After 960 clean checks in the same day, the scheduler relaxes to 60-second intervals, or about 60 checks/hour, a theoretical 50% reduction during the low-risk state.
- **Recovery responsiveness:** Warning recovery mode checks every 1 second until the user moves back, then requires a 4-second maintained-distance confirmation before clearing.
- **Frame workload per check:** Each check uses a 700ms camera warmup and up to 3 sampled frames, with each frame downscaled to 320px before inference.
- **Runtime timing:** The popup reports measured total check time and detection time from the latest check. Use those observed values for resume claims about latency after testing on your machine.

## Accuracy Notes

- Do not claim a specific false-positive or false-negative rate unless you run a labeled test set.
- A truthful phrasing is: "Improved detection reliability by adding camera warmup, multi-frame sampling, multiple TinyFaceDetector input sizes, and packaged-weight fallback loading."
- If you manually test sessions before/after the reliability changes, track attempts, warnings, missed warnings, and false warnings, then compute rates from that data.

## Strong One-Line Version

Built a local-first Chrome MV3 extension that uses webcam face detection, personalized calibration, offscreen camera processing, day-scoped scheduling, and automatic recovery overlays to help users maintain healthy screen distance.

## Skills Demonstrated

- Chrome extension architecture and Manifest V3 constraints
- Client-side computer vision and browser-based ML integration
- Webcam capture, canvas frame processing, and resource cleanup
- Asynchronous JavaScript, message passing, and service-worker scheduling
- State management with Chrome Storage API
- Debugging Chrome extension permission, protected-page, and injection edge cases
- UX design for calibration, warning overlays, recovery flow, and diagnostic popup states
- Performance-conscious polling with day-scoped clean streaks and idle detection
