const MODEL_URL = chrome.runtime.getURL("models/");
const CALIBRATION_SECONDS = 10;
const MIN_VALID_SAMPLES = 5;
const DEFAULT_MULTIPLIER = 1.1;
const HIGH_VARIANCE_THRESHOLD = 0.2;

const video = document.getElementById("preview");
const previewPlaceholder = document.getElementById("preview-placeholder");
const previewStartButton = document.getElementById("preview-start");
const canvas = document.getElementById("analysis-canvas");
const countdown = document.getElementById("countdown");
const sampleCount = document.getElementById("sample-count");
const latestRatio = document.getElementById("latest-ratio");
const statusText = document.getElementById("status");
const successCard = document.getElementById("success-card");
const startButton = document.getElementById("start");
const retryButton = document.getElementById("retry");
const doneButton = document.getElementById("open-popup");

let stream = null;
let timerId = null;
let secondsRemaining = CALIBRATION_SECONDS;
let samples = [];
let modelPromise = null;
let calibrationInProgress = false;

const detectorOptions = [
  new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.35 }),
  new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.25 }),
  new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.18 })
];

startButton.addEventListener("click", startCalibration);
previewStartButton.addEventListener("click", startCalibration);
retryButton.addEventListener("click", startCalibration);
doneButton.addEventListener("click", () => window.close());

resetState();
setStatus("Read the steps, then start when you are sitting comfortably.");

async function startCalibration() {
  if (calibrationInProgress) {
    return;
  }

  calibrationInProgress = true;
  resetState();
  startButton.hidden = true;
  previewPlaceholder.hidden = true;

  try {
    setStatus("Camera starting...");
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    setStatus("Loading face detector...");
    await loadFaceModel();

    setStatus("Hold your normal working distance.");
    await sampleOnce();
    timerId = setInterval(runCalibrationTick, 1000);
  } catch (error) {
    setStatus(getCalibrationErrorMessage(error), "error");
    retryButton.hidden = false;
    previewPlaceholder.hidden = false;
    previewStartButton.textContent = "Try again";
    stopStream();
  } finally {
    calibrationInProgress = false;
  }
}

async function runCalibrationTick() {
  secondsRemaining -= 1;
  countdown.textContent = String(Math.max(secondsRemaining, 0));
  await sampleOnce();

  if (secondsRemaining <= 0) {
    finishCalibration();
  }
}

async function sampleOnce() {
  if (!video.videoHeight || !video.videoWidth) {
    return;
  }

  const width = 320;
  const scale = width / video.videoWidth;
  canvas.width = width;
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);

  const detection = await detectFace(canvas);
  if (!detection) {
    latestRatio.textContent = "--";
    return;
  }

  const ratio = getFaceRatio(detection.box, canvas);
  samples.push(ratio);
  sampleCount.textContent = String(samples.length);
  latestRatio.textContent = ratio.toFixed(3);
}

async function finishCalibration() {
  clearInterval(timerId);
  stopStream();

  if (samples.length < MIN_VALID_SAMPLES) {
    setStatus("We need at least 5 valid face samples. Improve lighting, face the camera, and retry.", "error");
    retryButton.hidden = false;
    return;
  }

  const baseline = average(samples);
  const varianceRatio = standardDeviation(samples) / baseline;
  const threshold = baseline * DEFAULT_MULTIPLIER;

  await chrome.storage.local.set({
    baseline,
    threshold,
    multiplier: DEFAULT_MULTIPLIER,
    calibrated: true,
    enabled: true,
    varianceWarning: varianceRatio > HIGH_VARIANCE_THRESHOLD
  });

  chrome.runtime.sendMessage({ type: "CALIBRATION_COMPLETE" });

  if (varianceRatio > HIGH_VARIANCE_THRESHOLD) {
    showSuccess("All set. Lighting looked a little uneven, so recalibrate later if warnings feel jumpy.", "warning");
  } else {
    showSuccess("Nice, you're all set to go.");
  }

  doneButton.hidden = false;
}

function resetState() {
  clearInterval(timerId);
  stopStream();
  secondsRemaining = CALIBRATION_SECONDS;
  samples = [];
  countdown.textContent = String(CALIBRATION_SECONDS);
  sampleCount.textContent = "0";
  latestRatio.textContent = "--";
  successCard.hidden = true;
  startButton.hidden = false;
  previewPlaceholder.hidden = false;
  previewStartButton.textContent = "Start setup";
  retryButton.hidden = true;
  doneButton.hidden = true;
  statusText.className = "status";
}

function showSuccess(message, type = "") {
  successCard.hidden = false;
  setStatus(message, type);
  startButton.hidden = true;
  retryButton.hidden = true;
}

function stopStream() {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}

function getFaceRatio(box, frame) {
  return Math.max(box.height / frame.height, box.width / frame.width);
}

async function detectFace(frame) {
  let bestDetection = null;

  for (const options of detectorOptions) {
    const detections = await faceapi.detectAllFaces(frame, options);
    const largestDetection = detections
      .sort((a, b) => getBoxArea(b.box) - getBoxArea(a.box))[0];

    if (largestDetection && (!bestDetection || getBoxArea(largestDetection.box) > getBoxArea(bestDetection.box))) {
      bestDetection = largestDetection;
    }
  }

  return bestDetection;
}

function getBoxArea(box) {
  return box.width * box.height;
}

function loadFaceModel() {
  if (!modelPromise) {
    modelPromise = ensureModelFilesReachable()
      .then(() => loadTinyFaceDetector())
      .catch((error) => {
        modelPromise = null;
        throw error;
      });
  }

  return modelPromise;
}

async function ensureModelFilesReachable() {
  const { manifest, shardUrls } = await readModelManifest();

  if (!manifest?.[0]?.weights?.length) {
    throw new Error("Face detector model manifest has no weights.");
  }

  await Promise.all(shardUrls.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Face detector model shard returned ${response.status}.`);
    }
  }));
}

async function loadTinyFaceDetector() {
  try {
    await faceapi.loadTinyFaceDetectorModel(MODEL_URL);
  } catch (error) {
    await loadTinyFaceDetectorFromPackagedWeights(error);
  }
}

async function loadTinyFaceDetectorFromPackagedWeights(originalError) {
  const { manifest, shardUrls } = await readModelManifest();
  const buffers = await Promise.all(shardUrls.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Face detector model shard returned ${response.status}.`);
    }
    return response.arrayBuffer();
  }));

  const weightData = concatArrayBuffers(buffers);
  const weightMap = faceapi.tf.io.decodeWeights(weightData, manifest[0].weights);

  if (!faceapi.nets.tinyFaceDetector.loadFromWeightMap) {
    throw originalError;
  }

  await faceapi.nets.tinyFaceDetector.loadFromWeightMap(weightMap);
}

async function readModelManifest() {
  const manifestUrl = chrome.runtime.getURL("models/tiny_face_detector_model-weights_manifest.json");
  const response = await fetch(manifestUrl);

  if (!response.ok) {
    throw new Error(`Face detector model manifest returned ${response.status}.`);
  }

  const manifest = await response.json();
  const shardPath = manifest?.[0]?.paths?.[0];
  if (!shardPath) {
    throw new Error("Face detector model manifest is missing its shard path.");
  }

  return {
    manifest,
    shardUrls: manifest[0].paths.map((path) => chrome.runtime.getURL(`models/${path}`))
  };
}

function concatArrayBuffers(buffers) {
  const totalBytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;

  buffers.forEach((buffer) => {
    merged.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  });

  return merged.buffer;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function setStatus(message, type = "") {
  statusText.textContent = message;
  statusText.className = type ? `status ${type}` : "status";
}

function getCalibrationErrorMessage(error) {
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(error?.name)) {
    return "Camera permission was denied. In Chrome, open Site settings for this extension page, allow Camera, then retry calibration.";
  }

  const message = error?.message || String(error || "");
  if (message.toLowerCase().includes("failed to fetch")) {
    return `The face detector model could not be loaded from ${MODEL_URL}. Reload the extension in chrome://extensions, then retry calibration.`;
  }

  return message || "Unable to start calibration.";
}
