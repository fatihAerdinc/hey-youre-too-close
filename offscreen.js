const MODEL_URL = chrome.runtime.getURL("models/");
const FRAME_WIDTH = 320;
const CAMERA_WARMUP_MS = 700;
const SAMPLE_ATTEMPTS = 3;
const SAMPLE_DELAY_MS = 250;
const DETECTOR_OPTIONS = [
  new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.35 }),
  new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.25 }),
  new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.18 })
];

let modelPromise = null;
let modelLoadStatus = {
  loaded: false,
  method: "",
  error: ""
};
let activeCheck = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CHECK_DISTANCE_OFFSCREEN") {
    return false;
  }

  runDistanceCheck(message.threshold)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        checked: false,
        cameraDenied: isCameraPermissionError(error),
        error: error?.message || String(error),
        model: modelLoadStatus
      });
    });

  return true;
});

async function runDistanceCheck(threshold) {
  if (activeCheck) {
    return activeCheck;
  }

  activeCheck = captureAndAnalyze(threshold).finally(() => {
    activeCheck = null;
  });

  return activeCheck;
}

async function captureAndAnalyze(threshold) {
  const checkStartedAt = performance.now();
  const timings = {
    cameraMs: 0,
    modelMs: 0,
    warmupMs: 0,
    detectionMs: 0,
    totalMs: 0,
    attempts: 0
  };
  const cameraStartedAt = performance.now();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 }
    },
    audio: false
  });
  timings.cameraMs = performance.now() - cameraStartedAt;

  let video = null;

  try {
    const modelStartedAt = performance.now();
    await loadModel();
    timings.modelMs = performance.now() - modelStartedAt;
    video = await createReadyVideo(stream);
    const warmupStartedAt = performance.now();
    await delay(CAMERA_WARMUP_MS);
    timings.warmupMs = performance.now() - warmupStartedAt;

    for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt += 1) {
      timings.attempts = attempt + 1;
      const canvas = downscaleFrame(video);
      const detectionStartedAt = performance.now();
      const detection = await detectFace(canvas);
      timings.detectionMs += performance.now() - detectionStartedAt;

      if (detection) {
        const faceRatio = getFaceRatio(detection.box, canvas);
        timings.totalMs = performance.now() - checkStartedAt;

        return {
          checked: true,
          faceRatio,
          threshold,
          tooClose: faceRatio > threshold,
          timings: normalizeTimings(timings),
          model: modelLoadStatus
        };
      }

      await delay(SAMPLE_DELAY_MS);
    }

    return {
      checked: true,
      noFace: true,
      timings: normalizeTimings({
        ...timings,
        totalMs: performance.now() - checkStartedAt
      }),
      model: modelLoadStatus
    };
  } finally {
    if (video) {
      video.pause();
      video.srcObject = null;
      video.remove();
    }
    stopStream(stream);
  }
}

function normalizeTimings(timings) {
  return Object.fromEntries(
    Object.entries(timings).map(([key, value]) => [
      key,
      Number.isFinite(value) ? Math.round(value) : value
    ])
  );
}

function loadModel() {
  if (!modelPromise) {
    modelPromise = loadTinyFaceDetector().catch((error) => {
      modelPromise = null;
      modelLoadStatus = {
        loaded: false,
        method: "",
        error: error?.message || String(error)
      };
      throw error;
    });
  }

  return modelPromise;
}

function getFaceRatio(box, frame) {
  return Math.max(box.height / frame.height, box.width / frame.width);
}

async function loadTinyFaceDetector() {
  try {
    await faceapi.loadTinyFaceDetectorModel(MODEL_URL);
    modelLoadStatus = {
      loaded: true,
      method: "face-api-url",
      error: ""
    };
  } catch (error) {
    await loadTinyFaceDetectorFromPackagedWeights(error);
  }
}

async function loadTinyFaceDetectorFromPackagedWeights(originalError) {
  const manifestUrl = chrome.runtime.getURL("models/tiny_face_detector_model-weights_manifest.json");
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) {
    throw originalError;
  }

  const manifest = await manifestResponse.json();
  const paths = manifest?.[0]?.paths || [];
  const buffers = await Promise.all(paths.map(async (path) => {
    const response = await fetch(chrome.runtime.getURL(`models/${path}`));
    if (!response.ok) {
      throw originalError;
    }
    return response.arrayBuffer();
  }));

  const weightData = concatArrayBuffers(buffers);
  const weightMap = faceapi.tf.io.decodeWeights(weightData, manifest[0].weights);

  if (!faceapi.nets.tinyFaceDetector.loadFromWeightMap) {
    throw originalError;
  }

  await faceapi.nets.tinyFaceDetector.loadFromWeightMap(weightMap);
  modelLoadStatus = {
    loaded: true,
    method: "packaged-weights",
    error: originalError?.message || String(originalError || "")
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

function createReadyVideo(stream) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    video.onloadedmetadata = async () => {
      try {
        await video.play();
        resolve(video);
      } catch (error) {
        reject(error);
      }
    };

    video.onerror = () => reject(new Error("Unable to read camera frame."));
  });
}

async function detectFace(canvas) {
  let bestDetection = null;

  for (const options of DETECTOR_OPTIONS) {
    const detections = await faceapi.detectAllFaces(canvas, options);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downscaleFrame(source) {
  const sourceWidth = source.videoWidth || source.width;
  const sourceHeight = source.videoHeight || source.height;
  const scale = FRAME_WIDTH / sourceWidth;
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_WIDTH;
  canvas.height = Math.round(sourceHeight * scale);

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function stopStream(stream) {
  stream.getTracks().forEach((track) => track.stop());
}

function isCameraPermissionError(error) {
  return ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(error?.name);
}
