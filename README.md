# Hey, You're Too Close!

Hey, You're Too Close! is a Chrome extension that helps users keep a healthier distance from their screen. It uses webcam-based face detection to learn the user's normal sitting distance, then periodically checks whether they have moved too close and shows a full-screen warning overlay when they need to move back.

The goal of this project is to create a lightweight, privacy-conscious posture and screen-distance reminder that works inside Chrome without continuously recording video or sending camera data to a server.

## Project Goals

- Help users become aware when they are sitting too close to their screen.
- Use a personalized calibration step instead of a one-size-fits-all distance rule.
- Process camera frames locally in the browser.
- Avoid constant camera usage by checking periodically and stopping the camera stream after each check.
- Keep setup simple enough for non-technical users.
- Handle Chrome extension limitations gracefully, such as protected pages where overlays cannot be injected.

## Features

- First-run onboarding and calibration flow.
- 10-second calibration that records the user's normal working distance.
- Local face detection with `face-api.js` TinyFaceDetector.
- Extension-owned camera capture through a Manifest V3 offscreen document.
- Full-screen blur overlay when the user is too close.
- Automatic recovery flow that clears the overlay after the user moves back and stays back.
- Popup controls for enabling/disabling checks, sensitivity, status, and recalibration.
- Camera checks skip when Chrome is not the focused app/window.
- Same-day clean-check tracking that can relax the check interval after a long safe streak.

## How It Works

During calibration, the extension opens a camera preview and samples the user's face size for 10 seconds. It stores a baseline ratio based on the face bounding box size compared with the video frame.

During normal use, the background service worker schedules periodic checks. When a check runs, an offscreen document briefly opens the webcam, captures and downsizes frames to 320px, runs TinyFaceDetector locally, then immediately stops the camera stream.

If the detected face ratio is above the saved threshold, the extension shows a blur overlay that asks the user to move back. Once the user moves far enough away and maintains that distance for a few seconds, the overlay clears automatically.

## Tech Stack

- JavaScript
- HTML
- CSS
- Chrome Extension Manifest V3
- Chrome Storage API
- Chrome Offscreen Documents API
- Chrome Tabs and Scripting APIs
- Chrome Idle API
- `face-api.js`
- TinyFaceDetector model weights

## Installation

This project is currently intended to be loaded as an unpacked Chrome extension.

1. Download or clone this project.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on Developer mode.
4. Click Load unpacked.
5. Select the project folder.
6. The calibration page should open automatically on first install.

## How To Use

1. On the setup page, click Start setup.
2. Allow camera access when Chrome asks.
3. Sit at your normal working distance.
4. Stay still while the 10-second calibration runs.
5. When the page says "That's it!", the extension is ready.

After setup, continue browsing normally. The extension will periodically check your distance while Chrome is active. If you move too close, a warning overlay appears and clears after you move back.

## Popup Controls

The extension popup includes:

- Enable/disable toggle.
- Sensitivity slider.
- Last check status.
- Recalibrate button.

Use recalibration if your desk setup changes, your camera position changes, or warnings feel too strict or too relaxed.

## Permissions

The extension requests these permissions:

- `storage`: saves calibration settings and status.
- `offscreen`: runs camera checks in an extension-owned offscreen document.
- `tabs` and `activeTab`: finds the active Chrome tab for overlay warnings.
- `scripting`: injects the warning overlay into supported pages.
- `idle`: skips checks when the user is inactive.
- `<all_urls>` host access: allows the overlay to appear on normal web pages.

Camera access is handled by the browser permission prompt. Camera frames are processed locally and are not uploaded.

## Privacy Notes

- The extension does not send camera images to a server.
- Detection runs locally in Chrome using packaged model files.
- The camera stream is stopped after each check.
- Checks are skipped when Chrome is not focused, because the extension cannot show an overlay on top of other apps.

## Compatibility

This project is not Mac-specific. It should work on desktop Chrome across:

- macOS
- Windows
- Linux
- ChromeOS

Requirements:

- Google Chrome or a Chromium browser with Manifest V3 support.
- Support for the Chrome Offscreen Documents API.
- A working webcam.
- Camera permission granted for the extension.

## Limitations

- The warning overlay can only appear inside Chrome tabs.
- Chrome blocks extension overlays on protected pages such as `chrome://extensions`, the Chrome Web Store, and some extension pages.
- The extension estimates distance from face size, so lighting, camera angle, and webcam placement can affect accuracy.
- This is not a medical device and should be treated as a helpful reminder, not a clinical measurement tool.

## Project Structure

```text
.
├── manifest.json
├── background.js
├── offscreen.html
├── offscreen.js
├── content.js
├── overlay.css
├── calibration.html
├── calibration.js
├── calibration.css
├── popup.html
├── popup.js
├── popup.css
├── icons/
├── libs/
└── models/
```

## Future Improvements

- Add optional user-facing performance diagnostics.
- Improve the visual design of the popup and calibration flow.
- Add clearer handling for protected Chrome pages.
- Add a small test plan or demo video for GitHub.
- Package the extension for Chrome Web Store submission.

## Resume Notes

See `RESUME.md` for resume-ready bullets, implementation details, APIs used, and project metrics.
