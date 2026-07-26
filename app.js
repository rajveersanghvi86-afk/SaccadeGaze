// SaccadeGaze AI - Core Application Logic
// Built using MediaPipe Face Mesh & Chart.js

const FaceMesh = window.FaceMesh;
const Camera = window.Camera;

// State Management
const state = {
  // Mode selection
  demoMode: false,
  cameraActive: false,
  fps: 0,
  confidence: 0,

  // Calibration data
  calibrationActive: false,
  calibrationIndex: 0,
  calibrationSamples: [],
  isCalibrated: false,
  // Spatial boundaries mapping raw pupil features to screen dimensions
  calibBounds: {
    fxMin: 0.35,
    fxMax: 0.65,
    fyMin: 0.35,
    fyMax: 0.65
  },

  // Real-time gaze estimation
  gazeX: 0,
  gazeY: 0,
  gazeXPrev: 0,
  gazeYPrev: 0,
  emaAlpha: 0.28, // Exponential moving average smoothing weight

  // Stimulus test state
  trialActive: false,
  trialTimeLeft: 20.0,
  stimulusMode: 'idle', // 'idle' | 'pursuit' | 'saccadic'
  targetX: 0,
  targetY: 0,
  targetOriginX: 0,
  targetOriginY: 0,
  lastJumpTime: 0,
  saccadePending: false,

  // Diagnostics and Metrics
  latencyHistory: [], // ms values
  jitterHistory: [], // px stdDev values
  blinkCount: 0,
  totalFrames: 0,
  closedFrames: 0,
  eyesClosed: false,
  blinkStartTime: 0,
  
  // Current step fixation tracking
  fixationGazeLogs: [], // Coordinates stored during current jump pause

  // Demo mode coordinates
  simGazeTargetX: 0,
  simGazeTargetY: 0,
  simGazeX: 0,
  simGazeY: 0,
  simLatencyDelay: 220, // ms of reaction time to simulate
  simJitterScale: 8.5, // px

  // Noise filter history and baseline calibrations
  fxHistory: [],
  fyHistory: [],
  baselineFaceSize: 0,
  baselineContrast: 0,
  calibFaceSizes: [],
  calibContrasts: [],

  // 4-corner bilinear model extracted from 9-point calibration
  bilinearCorners: null
};

// UI Elements
const els = {
  webcam: document.getElementById('webcam'),
  overlayCanvas: document.getElementById('overlay-canvas'),
  stimulusFrame: document.getElementById('stimulus-frame'),
  stimulusDot: document.getElementById('stimulus-dot'),
  calibrationTarget: document.getElementById('calibration-target-container'),
  gazeCrosshair: document.getElementById('gaze-crosshair'),
  videoFallback: document.getElementById('video-fallback'),
  stimulusInstruction: document.getElementById('stimulus-instruction'),
  calibrationGuide: document.getElementById('calibration-guide'),
  calibrationStepText: document.getElementById('calibration-step-text'),
  calibrationProgress: document.getElementById('calibration-progress'),
  testHud: document.getElementById('test-hud'),
  testTimer: document.getElementById('test-timer'),
  initWarning: document.getElementById('init-warning'),
  
  // Controls
  btnStartCamera: document.getElementById('btn-start-camera'),
  btnDemoMode: document.getElementById('btn-demo-mode'),
  btnCalibrate: document.getElementById('btn-calibrate'),
  btnStartTest: document.getElementById('btn-start-test'),
  btnReset: document.getElementById('btn-reset'),
  toggleGaze: document.getElementById('toggle-gaze-visual'),
  modeBadge: document.getElementById('mode-badge'),
  modeText: document.getElementById('mode-text'),
  cameraIndicator: document.getElementById('camera-indicator'),
  cameraStatusText: document.getElementById('camera-status-text'),
  fpsVal: document.getElementById('fps-val'),
  confidenceVal: document.getElementById('confidence-val'),
  
  // Metric Displays
  latencyVal: document.getElementById('latency-val'),
  latencyStatus: document.getElementById('latency-status'),
  jitterVal: document.getElementById('jitter-val'),
  jitterStatus: document.getElementById('jitter-status'),
  blinkVal: document.getElementById('blink-val'),
  drowsinessVal: document.getElementById('drowsiness-val'),
  readinessVal: document.getElementById('readiness-val'),
  readinessStatus: document.getElementById('readiness-status'),
  readinessCircle: document.getElementById('readiness-circle'),
  
  // Calibration Warning
  warningToast: document.getElementById('calibration-warning-toast'),
  warningToastText: document.getElementById('calibration-warning-text'),
  
  // Modal
  resultsModal: document.getElementById('results-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnModalClose: document.getElementById('btn-modal-close'),
  btnModalDownload: document.getElementById('btn-modal-download'),
  btnModalRestart: document.getElementById('btn-modal-restart'),
  modalReadinessVal: document.getElementById('modal-readiness-val'),
  modalStatusBadge: document.getElementById('modal-status-badge'),
  modalLatencyVal: document.getElementById('modal-latency-val'),
  modalJitterVal: document.getElementById('modal-jitter-val'),
  modalBlinksVal: document.getElementById('modal-blinks-val'),
  modalDiagnosticText: document.getElementById('modal-diagnostic-text')
};

// Canvas 2D contexts
const ctxOverlay = els.overlayCanvas.getContext('2d');

// Chart.js instance
let latencyChart = null;

// Audio context for target jump confirmation beep (subtle premium micro-feedback)
let audioCtx = null;
function playBeep(freq = 600, duration = 0.05, type = 'sine') {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = type;
    gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // Audio block safe fallback
  }
}

// ----------------------------------------------------
// CHART INITIALIZATION
// ----------------------------------------------------
function initChart() {
  const chartCtx = document.getElementById('latency-chart').getContext('2d');
  
  // Destroy existing if re-initializing
  if (latencyChart) {
    latencyChart.destroy();
  }

  latencyChart = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Reaction Latency (ms)',
        data: [],
        borderColor: '#22d3ee', // Cyan
        backgroundColor: 'rgba(34, 211, 238, 0.08)',
        borderWidth: 2.5,
        tension: 0.3,
        pointBackgroundColor: '#22d3ee',
        pointBorderColor: '#0f172a',
        pointBorderWidth: 1.5,
        pointRadius: 4.5,
        pointHoverRadius: 6,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#e2e8f0',
          bodyColor: '#22d3ee',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 1,
          padding: 8,
          bodyFont: { family: 'Outfit' },
          titleFont: { family: 'Outfit', weight: 'bold' }
        }
      },
      scales: {
        y: {
          min: 80,
          max: 550,
          grid: {
            color: 'rgba(255, 255, 255, 0.04)',
            drawTicks: false
          },
          border: {
            dash: [4, 4]
          },
          ticks: {
            color: '#64748b',
            font: { family: 'Outfit', size: 10 }
          },
          title: {
            display: true,
            text: 'Latency (ms)',
            color: '#64748b',
            font: { family: 'Outfit', size: 11, weight: 'medium' }
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            color: '#64748b',
            font: { family: 'Outfit', size: 10 }
          },
          title: {
            display: true,
            text: 'Jump Step',
            color: '#64748b',
            font: { family: 'Outfit', size: 11, weight: 'medium' }
          }
        }
      }
    }
  });
}

// ----------------------------------------------------
// MATH & LOGIC UTILITIES
// ----------------------------------------------------

// 2D distance helper
function getDistance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Median calculation helper for 3-frame filtering
function getMedian(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Offscreen canvas for luminance contrast checks (high-performance 80x60 size)
let offscreenCanvas = null;
let offscreenCtx = null;

function calculateWebcamContrast() {
  if (!els.webcam || els.webcam.videoWidth === 0) return 50; // Return neutral fallback if camera not ready
  
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = 80;
    offscreenCanvas.height = 60;
    offscreenCtx = offscreenCanvas.getContext('2d');
  }
  
  try {
    offscreenCtx.drawImage(els.webcam, 0, 0, 80, 60);
    const imgData = offscreenCtx.getImageData(0, 0, 80, 60).data;
    
    let sum = 0;
    const len = imgData.length;
    for (let i = 0; i < len; i += 4) {
      const r = imgData[i];
      const g = imgData[i+1];
      const b = imgData[i+2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += gray;
    }
    const avg = sum / (len / 4);
    
    let sqDiffSum = 0;
    for (let i = 0; i < len; i += 4) {
      const r = imgData[i];
      const g = imgData[i+1];
      const b = imgData[i+2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      sqDiffSum += (gray - avg) * (gray - avg);
    }
    
    const stdDev = Math.sqrt(sqDiffSum / (len / 4));
    return stdDev; // Returns contrast (standard deviation of grayscale values)
  } catch (e) {
    return 50; // Fallback
  }
}

// Shows or updates calibration warning toast visually
function showCalibrationWarning(message) {
  if (els.warningToast && els.warningToastText) {
    els.warningToastText.innerText = message;
    els.warningToast.classList.remove('hidden');
    els.warningToast.classList.remove('scale-95', 'opacity-0');
    els.warningToast.classList.add('scale-100', 'opacity-100');
  }
}

// Hides calibration warning toast visually
function hideCalibrationWarning() {
  if (els.warningToast) {
    els.warningToast.classList.remove('scale-100', 'opacity-100');
    els.warningToast.classList.add('scale-95', 'opacity-0');
    // Hide completely after transition finishes (300ms)
    setTimeout(() => {
      if (els.warningToast && els.warningToast.classList.contains('opacity-0')) {
        els.warningToast.classList.add('hidden');
      }
    }, 300);
  }
}

// Compute Eye Aspect Ratio (EAR)
function calculateEAR(landmarks) {
  const l159 = landmarks[159]; // Left Top Eyelid
  const l145 = landmarks[145]; // Left Bottom Eyelid
  const l33 = landmarks[33];   // Left Outer Corner
  const l133 = landmarks[133]; // Left Inner Corner

  const r386 = landmarks[386]; // Right Top Eyelid
  const r374 = landmarks[374]; // Right Bottom Eyelid
  const r263 = landmarks[263]; // Right Outer Corner
  const r362 = landmarks[362]; // Right Inner Corner

  const earLeft = getDistance(l159, l145) / (getDistance(l33, l133) + 1e-6);
  const earRight = getDistance(r386, r374) / (getDistance(r263, r362) + 1e-6);

  return (earLeft + earRight) / 2;
}

// Normalize Pupil Position relative to Eye Socket
function extractGazeFeatures(landmarks) {
  const epsilon = 1e-6;

  // Landmarks
  const l133 = landmarks[133]; // Left Inner (towards nose)
  const l33 = landmarks[33];   // Left Outer (towards temple)
  const l159 = landmarks[159]; // Left Top
  const l145 = landmarks[145]; // Left Bottom
  const l468 = landmarks[468]; // Left Iris Center

  const r362 = landmarks[362]; // Right Inner (towards nose)
  const r263 = landmarks[263]; // Right Outer (towards temple)
  const r386 = landmarks[386]; // Right Top
  const r374 = landmarks[374]; // Right Bottom
  const r473 = landmarks[473]; // Right Iris Center

  // Left eye normalization (wLeft is always positive)
  const wLeft = Math.abs(l33.x - l133.x);
  const hLeft = Math.abs(l145.y - l159.y);
  // Normalizes left iris relative to inner corner (moves 0 = inner/left-of-frame to 1 = outer/right-of-frame)
  const fx_left = (l468.x - l133.x) / (wLeft + epsilon);
  const fy_left = (l468.y - l159.y) / (hLeft + epsilon);

  // Right eye normalization (wRight is always positive)
  const wRight = Math.abs(r362.x - r263.x);
  const hRight = Math.abs(r374.y - r386.y);
  // Normalizes right iris relative to outer corner (moves 0 = outer/left-of-frame to 1 = inner/right-of-frame)
  // Both left and right pupil features now scale from left-to-right in coordinate unison!
  const fx_right = (r473.x - r263.x) / (wRight + epsilon);
  const fy_right = (r473.y - r386.y) / (hRight + epsilon);

  // Return averaged coordinates (signs are now aligned, they reinforce each other!)
  return {
    fx: (fx_left + fx_right) / 2,
    fy: (fy_left + fy_right) / 2
  };
}

// Map pupil iris features to screen pixels using Inverse Distance Weighting (IDW)
// over all 9 calibration samples. Each sample provides one (fx,fy) → (xPct,yPct)
// anchor. The current gaze position is the 1/dist^4-weighted average of all anchors.
// IDW with all 9 points is far more robust than 4-corner bilinear:
//   - A single imprecise corner fixation cannot break the whole mapping
//   - Non-linear iris feature distributions are handled naturally
//   - Extrapolation beyond the calibration boundary gracefully snaps to the nearest anchor
function estimateGaze(fx, fy) {
  const rect = els.stimulusFrame.getBoundingClientRect();

  // Safe center default
  let rawGazeX = rect.width  / 2;
  let rawGazeY = rect.height / 2;

  if (state.isCalibrated && state.calibrationSamples.length > 0) {
    let totalWeight = 0;
    let weightedX   = 0;
    let weightedY   = 0;

    const n = Math.min(state.calibrationSamples.length, corners.length);
    for (let i = 0; i < n; i++) {
      const s   = state.calibrationSamples[i];
      const dfx = fx - s.fx;
      const dfy = fy - s.fy;
      const d2  = dfx * dfx + dfy * dfy;
      // Power-4 (d2 squared) gives tight interpolation: nearest anchor dominates
      const w   = 1 / (d2 * d2 + 1e-12);

      weightedX   += w * corners[i].xPct * rect.width;
      weightedY   += w * corners[i].yPct * rect.height;
      totalWeight += w;
    }

    rawGazeX = Math.max(0, Math.min(rect.width,  weightedX / totalWeight));
    rawGazeY = Math.max(0, Math.min(rect.height, weightedY / totalWeight));
  } else {
    // Fallback linear bounds mapping (pre-calibration or demo mode)
    const bounds = state.calibBounds;
    let rx = (fx - bounds.fxMin) / (bounds.fxMax - bounds.fxMin + 1e-6);
    let ry = (fy - bounds.fyMin) / (bounds.fyMax - bounds.fyMin + 1e-6);
    rx = Math.max(0, Math.min(1, rx));
    ry = Math.max(0, Math.min(1, ry));
    rawGazeX = rx * rect.width;
    rawGazeY = ry * rect.height;
  }

  // PHASE-AWARE ADAPTIVE SMOOTHING
  // During an active saccade, use a high-alpha (0.85) EMA instead of a full bypass.
  // A complete bypass (alpha=1.0) caused single noisy frames to snap gaze to screen
  // edges. Alpha=0.85 still responds within ~2 frames but rejects outlier spikes.
  if (state.trialActive && state.saccadePending && state.stimulusMode === 'saccadic') {
    const snapAlpha = 0.85;
    state.gazeX = snapAlpha * rawGazeX + (1 - snapAlpha) * state.gazeXPrev;
    state.gazeY = snapAlpha * rawGazeY + (1 - snapAlpha) * state.gazeYPrev;
    state.gazeXPrev = state.gazeX;
    state.gazeYPrev = state.gazeY;
    state.lastFx = fx;
    state.lastFy = fy;
    return;
  }

  // FIXATION / IDLE ADAPTIVE SMOOTHING
  // Measures instantaneous pupil velocity in feature space
  const lastFx = state.lastFx || fx;
  const lastFy = state.lastFy || fy;
  const velocity = Math.hypot(fx - lastFx, fy - lastFy);
  state.lastFx = fx;
  state.lastFy = fy;

  // Lower velocity trigger (0.007) and higher fast alpha (0.90) for quicker response;
  // faster ramp (0.55) so the filter transitions in ~2-3 frames instead of 5-6.
  const isMovingFast = velocity > 0.007;
  const targetAlpha = isMovingFast ? 0.90 : 0.16;
  state.emaAlpha = 0.55 * targetAlpha + 0.45 * state.emaAlpha;

  // Exponential moving average smooth
  state.gazeX = state.emaAlpha * rawGazeX + (1 - state.emaAlpha) * state.gazeXPrev;
  state.gazeY = state.emaAlpha * rawGazeY + (1 - state.emaAlpha) * state.gazeYPrev;

  state.gazeXPrev = state.gazeX;
  state.gazeYPrev = state.gazeY;
}

// Error Logging System
function logErrorToConsole(msg) {
  const container = document.getElementById('debug-log-container');
  const textDiv = document.getElementById('debug-log-text');
  if (container && textDiv) {
    container.classList.remove('hidden');
    const newErr = document.createElement('div');
    newErr.className = 'border-l border-rose-500 pl-1.5 py-0.5 leading-snug';
    newErr.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    textDiv.appendChild(newErr);
    container.scrollTop = container.scrollHeight;
  }
}

window.addEventListener('error', (event) => {
  logErrorToConsole(`${event.message} (${event.filename.split('/').pop()}:${event.lineno})`);
});

window.addEventListener('unhandledrejection', (event) => {
  logErrorToConsole(`Promise Exception: ${event.reason}`);
});

// ----------------------------------------------------
// WEBCAM & MEDIAPIPE CONTROLLERS
// ----------------------------------------------------

let frameCount = 0;
let lastFpsTime = performance.now();
let faceMesh = null;
let camera = null;

async function startCamera() {
  els.btnStartCamera.disabled = true;
  els.btnStartCamera.innerHTML = `<span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Connecting...`;

  try {
    // Create FaceMesh instance with pinned stable version
    faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    faceMesh.onResults(onResults);

    // Set camera state early so frame processing works from inception
    state.cameraActive = true;
    state.demoMode = false;

    // Initialize webcam capture
    camera = new Camera(els.webcam, {
      onFrame: async () => {
        if (state.cameraActive && !state.demoMode) {
          try {
            await faceMesh.send({ image: els.webcam });
          } catch (e) {
            console.error("FaceMesh processing exception:", e);
            logErrorToConsole(`WASM Pipeline Error: ${e.message || e}`);
          }
        }
      },
      width: 640,
      height: 480
    });

    await camera.start();
    
    // Adjust UI state
    els.webcam.classList.remove('hidden');
    els.videoFallback.classList.add('hidden');
    els.initWarning.classList.add('hidden');
    els.stimulusInstruction.classList.remove('bg-black/90');
    els.stimulusInstruction.classList.add('bg-black/60');
    
    // Status update
    els.cameraIndicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
    els.cameraStatusText.innerText = 'Active (Webcam)';
    els.modeText.innerText = 'Hardware Mode';
    els.modeBadge.className = 'flex items-center gap-1.5 bg-emerald-950/40 text-emerald-300 px-3 py-1.5 rounded-full border border-emerald-900/60';
    
    // Enable other controls
    els.btnCalibrate.disabled = false;
    els.btnCalibrate.className = 'py-1.5 px-4 rounded-lg font-bold text-xs bg-cyan-600 hover:bg-cyan-500 text-slate-950 transition-all flex items-center gap-1.5 border-none';
    
    els.btnStartCamera.innerHTML = `<i data-lucide="video-off" class="w-4 h-4"></i><span>Disable Camera</span>`;
    els.btnStartCamera.className = 'col-span-2 py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-900/30';
    lucide.createIcons();

  } catch (err) {
    console.error("Camera access failed, falling back to Demo Mode:", err);
    logErrorToConsole(`Camera Initialization Failed: ${err.message || err}`);
    triggerDemoFallback("Webcam Denied/Failed. Booting Demo Preset Mode.");
  }
}

function disableCamera() {
  if (camera) {
    camera.stop();
  }
  state.cameraActive = false;
  els.webcam.classList.add('hidden');
  els.videoFallback.classList.remove('hidden');
  els.initWarning.classList.remove('hidden');
  
  els.cameraIndicator.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse';
  els.cameraStatusText.innerText = 'Inactive';
  
  els.btnStartCamera.innerHTML = `<i data-lucide="video" class="w-4 h-4"></i><span>Initialize Camera</span>`;
  els.btnStartCamera.className = 'col-span-2 py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/30';
  lucide.createIcons();

  // Reset confidence
  state.confidence = 0;
  els.confidenceVal.innerText = '0%';
  ctxOverlay.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
}

function triggerDemoFallback(reason) {
  state.demoMode = true;
  state.isCalibrated = true; // Auto-calibrate for Demo Mode
  disableCamera();
  
  // Adjust UI
  els.initWarning.classList.add('hidden');
  els.stimulusInstruction.classList.remove('bg-black/90');
  els.stimulusInstruction.classList.add('bg-black/60');
  els.btnCalibrate.disabled = false;
  els.btnCalibrate.className = 'py-1.5 px-4 rounded-lg font-bold text-xs bg-cyan-600 hover:bg-cyan-500 text-slate-950 transition-all flex items-center gap-1.5 border-none';
  els.btnStartTest.disabled = false;
  els.btnStartTest.className = 'py-1.5 px-4 rounded-lg font-bold text-xs bg-indigo-600 hover:bg-indigo-500 text-slate-50 transition-all flex items-center gap-1.5';
  
  els.cameraIndicator.className = 'w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse';
  els.cameraStatusText.innerText = 'Demo Active';
  els.modeText.innerText = 'Demo Preset Mode';
  els.modeBadge.className = 'flex items-center gap-1.5 bg-indigo-950/40 text-indigo-300 px-3 py-1.5 rounded-full border border-indigo-900/60';
  
  // Start simulation loop
  requestAnimationFrame(simulationLoop);
  alert(reason);
}

// MediaPipe Results Processor
function onResults(results) {
  const videoWidth = els.webcam.videoWidth;
  const videoHeight = els.webcam.videoHeight;

  // Protect canvas size checks to prevent 0px values on startup
  if (!videoWidth || !videoHeight) return;

  if (els.overlayCanvas.width !== videoWidth || els.overlayCanvas.height !== videoHeight) {
    els.overlayCanvas.width = videoWidth;
    els.overlayCanvas.height = videoHeight;
  }

  const width = els.overlayCanvas.width;
  const height = els.overlayCanvas.height;
  ctxOverlay.clearRect(0, 0, width, height);

  // Check face detection
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];
    
    // Update tracking statistics
    state.confidence = 100;
    els.confidenceVal.innerText = '100%';
    
    // Calculate FPS
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      state.fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
      els.fpsVal.innerText = state.fps;
      frameCount = 0;
      lastFpsTime = now;
    }

    // Process Blink Detection
    const ear = calculateEAR(landmarks);
    processBlink(ear);

    // Compute pupil gaze normalization feature coordinates
    const eyeFeatures = extractGazeFeatures(landmarks);

    // Apply 3-frame median filter during fixation / idle for noise rejection.
    // During an active saccade (saccadePending = true) we skip the median buffer
    // and pass raw features directly — the buffer adds ~66ms lag at 30fps which
    // distorts latency measurement precisely when accuracy matters most.
    state.fxHistory.push(eyeFeatures.fx);
    state.fyHistory.push(eyeFeatures.fy);
    if (state.fxHistory.length > 3) state.fxHistory.shift();
    if (state.fyHistory.length > 3) state.fyHistory.shift();

    const usedFx = (state.trialActive && state.saccadePending && state.stimulusMode === 'saccadic')
      ? eyeFeatures.fx
      : getMedian(state.fxHistory);
    const usedFy = (state.trialActive && state.saccadePending && state.stimulusMode === 'saccadic')
      ? eyeFeatures.fy
      : getMedian(state.fyHistory);

    // Update Gaze estimates if calibrated
    if (state.isCalibrated) {
      estimateGaze(usedFx, usedFy);
      updateGazeIndicator();
      if (state.trialActive) {
        checkRealtimeDiagnostics(state.gazeX, state.gazeY);
      }
    }

    // Compute current face dimensions (distance metric) and luminance contrast
    const xCoords = landmarks.map(p => p.x);
    const yCoords = landmarks.map(p => p.y);
    const xMin = Math.min(...xCoords);
    const xMax = Math.max(...xCoords);
    const yMin = Math.min(...yCoords);
    const yMax = Math.max(...yCoords);
    const currentFaceSize = Math.hypot(xMax - xMin, yMax - yMin);
    const currentContrast = calculateWebcamContrast();

    // If Calibration Stage is running, collect calibration coordinate samples
    // Skip frames where the user blinked (EAR < 0.16) to prevent calibration corruption
    // Use median-filtered coordinates (usedFx/usedFy) for stable calibration sampling
    if (state.calibrationActive && ear >= 0.16) {
      recordCalibrationSample(usedFx, usedFy);
      state.calibFaceSizes.push(currentFaceSize);
      state.calibContrasts.push(currentContrast);
    }

    // Real-time checks for distance/positioning & lighting contrast shifts
    if (state.isCalibrated) {
      const sizeDev = state.baselineFaceSize > 0 ? Math.abs(currentFaceSize - state.baselineFaceSize) / state.baselineFaceSize : 0;
      const isContrastLow = currentContrast < 20; // Relaxed slightly to 20 for better sensitivity
      const isSizeShifted = sizeDev > 0.15;
      
      if (isContrastLow) {
        showCalibrationWarning("Light environment shifted. Recalibrating eye baseline...");
      } else if (isSizeShifted) {
        if (state.trialActive) {
          showCalibrationWarning("Position shifted. Please keep your head still during the trial.");
        } else {
          showCalibrationWarning("Position shifted. Maintain baseline distance or recalibrate.");
        }
      } else {
        hideCalibrationWarning();
      }
      
      if ((isContrastLow || isSizeShifted) && Math.random() < 0.03) {
        console.log(`[SaccadeGaze Warning] sizeDev: ${(sizeDev * 100).toFixed(1)}%, contrast: ${currentContrast.toFixed(1)}`);
      }
    } else {
      // Even if not calibrated, warn if contrast is extremely low
      if (currentContrast < 20) {
        showCalibrationWarning("Light environment shifted. Recalibrating eye baseline...");
      } else {
        hideCalibrationWarning();
      }
    }

    // Draw Overlays (Irises and Eye outlines)
    drawMeshDetails(landmarks, width, height);

  } else {
    // Face not detected
    state.confidence = 0;
    els.confidenceVal.innerText = '0%';
    
    // Check if the reason face is not detected is extremely low contrast (dark room/covered camera)
    const currentContrast = calculateWebcamContrast();
    if (currentContrast < 20) {
      showCalibrationWarning("Light environment shifted. Recalibrating eye baseline...");
    } else {
      hideCalibrationWarning();
    }
  }
}

// Render eyes and iris coordinates
function drawMeshDetails(landmarks, width, height) {
  ctxOverlay.lineWidth = 1;
  ctxOverlay.fillStyle = 'rgba(34, 211, 238, 0.85)'; // Cyan for iris nodes

  // 1. Draw irises center highlights
  const leftIrisCenter = landmarks[468];
  const rightIrisCenter = landmarks[473];

  ctxOverlay.beginPath();
  ctxOverlay.arc(leftIrisCenter.x * width, leftIrisCenter.y * height, 3, 0, 2 * Math.PI);
  ctxOverlay.arc(rightIrisCenter.x * width, rightIrisCenter.y * height, 3, 0, 2 * Math.PI);
  ctxOverlay.fill();

  // 2. Draw eye contour lines
  // Left eye indices in order: 33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246
  // Right eye indices in order: 263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466
  const leftEyeIndices = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
  const rightEyeIndices = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];

  ctxOverlay.strokeStyle = 'rgba(99, 102, 241, 0.4)'; // Light indigo contour
  drawEyeOutline(leftEyeIndices, landmarks, width, height);
  drawEyeOutline(rightEyeIndices, landmarks, width, height);

  // 3. Draw Iris boundaries
  const leftIris = [468, 469, 470, 471, 472];
  const rightIris = [473, 474, 475, 476, 477];
  ctxOverlay.strokeStyle = 'rgba(34, 211, 238, 0.6)';
  drawEyeOutline(leftIris, landmarks, width, height);
  drawEyeOutline(rightIris, landmarks, width, height);
}

function drawEyeOutline(indices, landmarks, width, height) {
  ctxOverlay.beginPath();
  for (let i = 0; i < indices.length; i++) {
    const pt = landmarks[indices[i]];
    if (i === 0) {
      ctxOverlay.moveTo(pt.x * width, pt.y * height);
    } else {
      ctxOverlay.lineTo(pt.x * width, pt.y * height);
    }
  }
  ctxOverlay.closePath();
  ctxOverlay.stroke();
}

// ----------------------------------------------------
// BLINK & DROWSINESS SYSTEM
// ----------------------------------------------------
function processBlink(ear) {
  state.totalFrames++;
  if (ear < 0.178) {
    state.closedFrames++;
    if (!state.eyesClosed) {
      state.eyesClosed = true;
      state.blinkStartTime = Date.now();
    }
  } else {
    if (state.eyesClosed) {
      state.eyesClosed = false;
      const blinkDuration = Date.now() - state.blinkStartTime;
      // Filter out micro-jitter or extremely long closures (which indicate naps)
      if (blinkDuration >= 45 && blinkDuration <= 500) {
        state.blinkCount++;
      }
    }
  }

  // Update rolling statistics indicators
  const blinkRate = Math.round(state.blinkCount * (60000 / (state.trialActive ? (20000 - state.trialTimeLeft * 1000 + 1) : 20000)));
  const perclos = (state.closedFrames / (state.totalFrames + 1)) * 100;
  
  if (state.trialActive) {
    els.blinkVal.innerText = state.blinkCount;
    els.drowsinessVal.innerText = `${perclos.toFixed(1)}% (${perclos < 5 ? 'Alert' : perclos < 15 ? 'Fatigued' : 'Drowsy'})`;
    
    if (perclos < 5) {
      els.drowsinessVal.className = "text-xs font-semibold text-emerald-400 mt-0.5";
    } else if (perclos < 15) {
      els.drowsinessVal.className = "text-xs font-semibold text-amber-400 mt-0.5";
    } else {
      els.drowsinessVal.className = "text-xs font-semibold text-rose-400 mt-0.5";
    }
  }
}

// ----------------------------------------------------
// CALIBRATION ENGINE
// ----------------------------------------------------

// Automated corner coordinates: percentages of test screen dimensions
const corners = [
  { name: 'Center Point', xPct: 0.5, yPct: 0.5 },
  { name: 'Top-Left', xPct: 0.1, yPct: 0.1 },
  { name: 'Top-Center', xPct: 0.5, yPct: 0.1 },
  { name: 'Top-Right', xPct: 0.9, yPct: 0.1 },
  { name: 'Middle-Right', xPct: 0.9, yPct: 0.5 },
  { name: 'Bottom-Right', xPct: 0.9, yPct: 0.9 },
  { name: 'Bottom-Center', xPct: 0.5, yPct: 0.9 },
  { name: 'Bottom-Left', xPct: 0.1, yPct: 0.9 },
  { name: 'Middle-Left', xPct: 0.1, yPct: 0.5 }
];

let calibrationTimer = null;
let calibXHistory = [];
let calibYHistory = [];

function startCalibration() {
  if (state.trialActive) return;

  state.calibrationActive = true;
  state.calibrationIndex = 0;
  state.calibrationSamples = [];
  state.isCalibrated = false;
  state.bilinearCorners = null; // Reset until new calibration completes
  state.fxHistory = [];
  state.fyHistory = [];
  state.calibFaceSizes = [];
  state.calibContrasts = [];
  
  els.stimulusInstruction.classList.add('hidden');
  els.calibrationGuide.classList.remove('hidden');
  els.calibrationTarget.classList.remove('hidden');
  els.gazeCrosshair.classList.add('hidden');
  
  nextCalibrationStep();
}

function nextCalibrationStep() {
  if (state.calibrationIndex >= corners.length) {
    finishCalibration();
    return;
  }

  const corner = corners[state.calibrationIndex];
  els.calibrationStepText.innerText = `Look at target: ${corner.name} Corner`;
  
  // Position calibration target on screen
  const rect = els.stimulusFrame.getBoundingClientRect();
  const tx = corner.xPct * rect.width;
  const ty = corner.yPct * rect.height;
  els.calibrationTarget.style.left = `${tx}px`;
  els.calibrationTarget.style.top = `${ty}px`;

  // Start sampling after 350ms (allows eye to move to new corner)
  calibXHistory = [];
  calibYHistory = [];
  let progressPct = 0;
  playBeep(450, 0.08);

  const sampleInterval = setInterval(() => {
    progressPct += 6.5;
    els.calibrationProgress.style.width = `${Math.min(100, progressPct)}%`;

    if (progressPct >= 100) {
      clearInterval(sampleInterval);
      
      // Store averages for corner
      if (calibXHistory.length > 0) {
        const avgX = calibXHistory.reduce((a,b)=>a+b, 0) / calibXHistory.length;
        const avgY = calibYHistory.reduce((a,b)=>a+b, 0) / calibYHistory.length;
        
        state.calibrationSamples.push({
          corner: corner.name,
          fx: avgX,
          fy: avgY
        });
      }

      state.calibrationIndex++;
      nextCalibrationStep();
    }
  }, 100);
}

function recordCalibrationSample(fx, fy) {
  calibXHistory.push(fx);
  calibYHistory.push(fy);
}

function finishCalibration() {
  state.calibrationActive = false;
  els.calibrationGuide.classList.add('hidden');
  els.calibrationTarget.classList.add('hidden');
  
  // Calculate spatial bounding boxes
  const samples = state.calibrationSamples;
  if (samples.length === 9) {
    // Save Center baseline (index 0)
    const centerSample = samples[0];
    state.centerFx = centerSample.fx;
    state.centerFy = centerSample.fy;

    // Left boundary: Top-Left (index 1), Bottom-Left (index 7), Middle-Left (index 8)
    const fxLeft = (samples[1].fx + samples[7].fx + samples[8].fx) / 3;

    // Right boundary: Top-Right (index 3), Middle-Right (index 4), Bottom-Right (index 5)
    const fxRight = (samples[3].fx + samples[4].fx + samples[5].fx) / 3;

    // Top boundary: Top-Left (index 1), Top-Center (index 2), Top-Right (index 3)
    const fyTop = (samples[1].fy + samples[2].fy + samples[3].fy) / 3;

    // Bottom boundary: Bottom-Left (index 7), Bottom-Center (index 6), Bottom-Right (index 5)
    const fyBottom = (samples[7].fy + samples[6].fy + samples[5].fy) / 3;

    // Store true 4-corner bilinear model for use in estimateGaze.
    // Correct 9-point indices: TL=1, TR=3, BL=7, BR=5
    // Store iris features AND screen percentage positions for each corner.
    // The xPct/yPct values are the actual screen positions of the calibration targets
    // (from the corners[] array) so estimateGaze can remap bilinear output correctly.
    state.bilinearCorners = {
      tl: { fx: samples[1].fx, fy: samples[1].fy, xPct: 0.1, yPct: 0.1 },
      tr: { fx: samples[3].fx, fy: samples[3].fy, xPct: 0.9, yPct: 0.1 },
      bl: { fx: samples[7].fx, fy: samples[7].fy, xPct: 0.1, yPct: 0.9 },
      br: { fx: samples[5].fx, fy: samples[5].fy, xPct: 0.9, yPct: 0.9 }
    };

    // Also update calibBounds (used by fallback path) with 10% outward padding.
    // This prevents normal eye positions near the periphery from getting hard-clamped
    // to the screen edges during the linear-fallback or pre-calibration phases.
    const fxRange = fxRight - fxLeft;
    const fyRange = fyBottom - fyTop;
    state.calibBounds.fxMin = fxLeft  - fxRange * 0.10;
    state.calibBounds.fxMax = fxRight + fxRange * 0.10;
    state.calibBounds.fyMin = fyTop   - fyRange * 0.10;
    state.calibBounds.fyMax = fyBottom + fyRange * 0.10;

    // Calculate baseline face size and contrast averages
    if (state.calibFaceSizes.length > 0) {
      state.baselineFaceSize = state.calibFaceSizes.reduce((a, b) => a + b, 0) / state.calibFaceSizes.length;
    }
    if (state.calibContrasts.length > 0) {
      state.baselineContrast = state.calibContrasts.reduce((a, b) => a + b, 0) / state.calibContrasts.length;
    }

    state.isCalibrated = true;
    
    // Update displays
    els.stimulusInstruction.innerHTML = `
      <div class="w-14 h-14 rounded-full bg-slate-950 border border-emerald-500 flex items-center justify-center text-emerald-400 glow-emerald">
        <i data-lucide="check-circle" class="w-7 h-7"></i>
      </div>
      <div>
        <h3 class="text-md font-bold text-emerald-400">9-Point Calibration Verified</h3>
        <p class="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Oculomotor mapping successfully computed. Click 'Start Screening' to begin latency diagnostic.</p>
      </div>
    `;
    lucide.createIcons();
    
    els.btnStartTest.disabled = false;
    els.btnStartTest.className = 'py-1.5 px-4 rounded-lg font-bold text-xs bg-indigo-600 hover:bg-indigo-500 text-slate-50 transition-all flex items-center gap-1.5 glow-indigo';
  } else {
    alert("Calibration sample incomplete. Please retry calibration.");
  }
}

// Update UI gaze dot location
function updateGazeIndicator() {
  if (els.toggleGaze.checked) {
    els.gazeCrosshair.classList.remove('hidden');
    els.gazeCrosshair.style.left = `${state.gazeX}px`;
    els.gazeCrosshair.style.top = `${state.gazeY}px`;
  } else {
    els.gazeCrosshair.classList.add('hidden');
  }
}

// ----------------------------------------------------
// SCREENING DIAGNOSTIC ENGINE (TRIAL LOOP)
// ----------------------------------------------------

let testTimerInterval = null;
let pursuitFrameId = null;
let targetIntervalId = null;

function startScreeningTrial() {
  if (state.trialActive || (!state.isCalibrated && !state.demoMode)) return;

  // Reset diagnostic lists
  state.trialActive = true;
  state.trialTimeLeft = 20.0;
  state.latencyHistory = [];
  state.jitterHistory = [];
  state.blinkCount = 0;
  state.totalFrames = 0;
  state.closedFrames = 0;
  state.eyesClosed = false;

  // Visual Setup
  els.stimulusInstruction.classList.add('hidden');
  els.testHud.classList.remove('hidden');
  els.stimulusDot.classList.remove('hidden');
  initChart();

  playBeep(800, 0.15, 'triangle');

  // Start the 20-second Countdown Timer
  els.testTimer.innerText = `${state.trialTimeLeft.toFixed(1)}s`;
  testTimerInterval = setInterval(() => {
    state.trialTimeLeft -= 0.1;
    if (state.trialTimeLeft <= 0) {
      state.trialTimeLeft = 0;
      clearInterval(testTimerInterval);
      stopScreeningTrial();
    }
    els.testTimer.innerText = `${state.trialTimeLeft.toFixed(1)}s`;
  }, 100);

  // Sequence: 0s - 5s Smooth Pursuit drift, 5s - 20s Saccade teleports
  state.stimulusMode = 'pursuit';
  startSmoothPursuit();

  // Schedule transition to Saccade Step after 5 seconds
  setTimeout(() => {
    if (state.trialActive) {
      state.stimulusMode = 'saccadic';
      cancelAnimationFrame(pursuitFrameId);
      startSaccadeJumps();
    }
  }, 5000);
}

// Phase 1: Smooth Pursuit (Cosine wave drift)
let pursuitAngle = 0;
function startSmoothPursuit() {
  const rect = els.stimulusFrame.getBoundingClientRect();
  
  function updatePursuit() {
    if (!state.trialActive || state.stimulusMode !== 'pursuit') return;

    pursuitAngle += 0.038;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    // Lissajous curve movement path
    state.targetX = cx + Math.sin(pursuitAngle) * (rect.width * 0.35);
    state.targetY = cy + Math.sin(pursuitAngle * 1.5) * (rect.height * 0.3);

    els.stimulusDot.style.left = `${state.targetX}px`;
    els.stimulusDot.style.top = `${state.targetY}px`;

    // Demo Mode gaze updates follow the drift
    if (state.demoMode) {
      updateDemoGazeSmooth();
    }

    pursuitFrameId = requestAnimationFrame(updatePursuit);
  }

  updatePursuit();
}

// Phase 2: Saccadic Step jumps
function startSaccadeJumps() {
  triggerNextSaccadeJump();

  // Jump Target every 1200ms
  targetIntervalId = setInterval(() => {
    if (state.trialActive && state.stimulusMode === 'saccadic') {
      triggerNextSaccadeJump();
    }
  }, 1200);
}

function triggerNextSaccadeJump() {
  // If there's a pending saccade from the previous jump that never finished, we record it as missed or max latency
  if (state.saccadePending) {
    state.latencyHistory.push(500); // 500ms fallback max
    updateChart(state.latencyHistory.length, 500);
  }

  // If we collected fixation logs during the last part of the stationary phase, compute jitter
  if (state.fixationGazeLogs.length > 5) {
    calculateAndLogJitter();
  }

  // Compute new target location: avoid margins
  const rect = els.stimulusFrame.getBoundingClientRect();
  const borderMargin = 60;
  
  state.targetOriginX = state.targetX;
  state.targetOriginY = state.targetY;
  
  // Select coordinates with a minimum distance from origin to ensure a clear step
  let nx = 0, ny = 0, tries = 0;
  do {
    nx = borderMargin + Math.random() * (rect.width - borderMargin * 2);
    ny = borderMargin + Math.random() * (rect.height - borderMargin * 2);
    tries++;
  } while (Math.hypot(nx - state.targetOriginX, ny - state.targetOriginY) < 180 && tries < 15);

  state.targetX = nx;
  state.targetY = ny;

  // Move Stimulus Dot visually
  els.stimulusDot.style.left = `${state.targetX}px`;
  els.stimulusDot.style.top = `${state.targetY}px`;

  // Start latency watch
  state.lastJumpTime = Date.now();
  state.saccadePending = true;
  state.fixationGazeLogs = []; // Clear for next step

  // Setup Demo Mode reaction trigger
  if (state.demoMode) {
    state.simGazeTargetX = state.targetX;
    state.simGazeTargetY = state.targetY;
    // Set random simulated latency
    state.simLatencyDelay = 180 + Math.random() * 85; 
  }

  playBeep(650, 0.04);
}

// Latency & Jitter checker within rendering loops
function checkRealtimeDiagnostics(currentGazeX, currentGazeY) {
  const now = Date.now();
  const timeSinceJump = now - state.lastJumpTime;

  // 1. Saccadic Latency Checker (Saccadic Mode only)
  if (state.trialActive && state.stimulusMode === 'saccadic' && state.saccadePending) {
    
    // Jump vector from origin to new target
    const vx = state.targetX - state.targetOriginX;
    const vy = state.targetY - state.targetOriginY;
    const targetDist = Math.hypot(vx, vy);

    if (targetDist > 10) {
      // Vector from origin to current gaze
      const gx = currentGazeX - state.targetOriginX;
      const gy = currentGazeY - state.targetOriginY;

      // Project gaze displacement onto jump vector
      // progress = (G . V) / (V . V)
      const progress = (gx * vx + gy * vy) / (targetDist * targetDist);

      // Saccade trigger check: has gaze crossed 28% progress threshold?
      // Lowered from 38% — with phase-aware EMA the gaze snaps accurately so
      // a 28% crossing is a reliable, early saccade signal that captures the
      // true reaction time before any residual smoothing lag accumulates.
      if (progress >= 0.28) {
        const latency = timeSinceJump;
        
        // Filter out accidental spikes or noise (<80ms)
        if (latency >= 80 && latency <= 1000) {
          state.saccadePending = false;
          state.latencyHistory.push(latency);
          updateChart(state.latencyHistory.length, latency);
          
          // Audio feedback
          playBeep(900, 0.04);
        }
      }
    }
  }

  // 2. Fixation Jitter Collector: Collect gaze samples between 350ms and 1150ms after target jump
  if (state.trialActive && state.stimulusMode === 'saccadic' && timeSinceJump >= 350 && timeSinceJump < 1150) {
    state.fixationGazeLogs.push({ x: currentGazeX, y: currentGazeY });
  }
}

// Compute standard deviation of coordinates during fixation
function calculateAndLogJitter() {
  const logs = state.fixationGazeLogs;
  const n = logs.length;

  const meanX = logs.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = logs.reduce((sum, p) => sum + p.y, 0) / n;

  const varianceX = logs.reduce((sum, p) => sum + Math.pow(p.x - meanX, 2), 0) / n;
  const varianceY = logs.reduce((sum, p) => sum + Math.pow(p.y - meanY, 2), 0) / n;

  const stdDevX = Math.sqrt(varianceX);
  const stdDevY = Math.sqrt(varianceY);

  // Mean jitter in pixels
  const jitter = (stdDevX + stdDevY) / 2;

  // Filter abnormal errors (e.g. tracking failures)
  if (jitter > 0.5 && jitter < 150) {
    state.jitterHistory.push(jitter);
    
    // Update live metrics dashboard values
    const avgJitter = state.jitterHistory.reduce((a,b)=>a+b, 0) / state.jitterHistory.length;
    els.jitterVal.innerText = avgJitter.toFixed(1);
    
    if (avgJitter < 22.0) {
      els.jitterStatus.innerText = "Steady Gaze";
      els.jitterStatus.className = "text-xs font-semibold text-emerald-400 mt-0.5";
    } else if (avgJitter < 40.0) {
      els.jitterStatus.innerText = "Moderate Jitter";
      els.jitterStatus.className = "text-xs font-semibold text-amber-400 mt-0.5";
    } else {
      els.jitterStatus.innerText = "High Microsaccades";
      els.jitterStatus.className = "text-xs font-semibold text-rose-400 mt-0.5";
    }
  }
}

function updateChart(step, value) {
  if (latencyChart) {
    latencyChart.data.labels.push(`#${step}`);
    latencyChart.data.datasets[0].data.push(value);
    latencyChart.update('none'); // Update without full layout reflow
  }

  // Update real-time average latency display
  const avgLatency = Math.round(state.latencyHistory.reduce((a,b)=>a+b, 0) / state.latencyHistory.length);
  els.latencyVal.innerText = avgLatency;
  
  if (avgLatency <= 280) {
    els.latencyStatus.innerText = "Optimal Latency";
    els.latencyStatus.className = "text-xs font-semibold text-emerald-400 mt-0.5";
  } else if (avgLatency <= 400) {
    els.latencyStatus.innerText = "Borderline Delay";
    els.latencyStatus.className = "text-xs font-semibold text-amber-400 mt-0.5";
  } else {
    els.latencyStatus.innerText = "Sluggish Latency";
    els.latencyStatus.className = "text-xs font-semibold text-rose-400 mt-0.5";
  }

  // Update Readiness Gauge live
  updateReadinessGauge();
}

function updateReadinessGauge() {
  const scores = computeScores();
  els.readinessVal.innerText = `${scores.readiness}%`;
  
  if (scores.readiness >= 80) {
    els.readinessStatus.innerText = "Optimal Alertness";
    els.readinessStatus.className = "text-xs font-semibold text-emerald-400";
  } else if (scores.readiness >= 50) {
    els.readinessStatus.innerText = "Moderate Fatigue";
    els.readinessStatus.className = "text-xs font-semibold text-amber-400";
  } else {
    els.readinessStatus.innerText = "High Latency & Fatigue";
    els.readinessStatus.className = "text-xs font-semibold text-rose-400";
  }

  // Animate circular dashboard gauge
  // Circumference = 2 * PI * 28 = ~175.9px
  const offset = 175.9 - (scores.readiness / 100) * 175.9;
  els.readinessCircle.style.strokeDashoffset = offset;
}

function computeScores() {
  const avgLatency = state.latencyHistory.length > 0 
    ? state.latencyHistory.reduce((a,b)=>a+b, 0) / state.latencyHistory.length 
    : 220;
  
  const avgJitter = state.jitterHistory.length > 0 
    ? state.jitterHistory.reduce((a,b)=>a+b, 0) / state.jitterHistory.length 
    : 10.0;

  const perclos = state.totalFrames > 0 
    ? (state.closedFrames / state.totalFrames) 
    : 0;

  // Latency Factor: 160ms is perfect (1.0), 550ms is fully fatigued (0.0)
  const lFactor = Math.max(0, Math.min(1, 1 - (avgLatency - 160) / 390));
  // Jitter Factor: 15px is steady (1.0), 60px is highly unstable (0.0)
  const jFactor = Math.max(0, Math.min(1, 1 - (avgJitter - 15) / 45));
  // Drowsiness Factor: 0% closed time is perfect (1.0), 22% is fatigued (0.0)
  const dFactor = Math.max(0, Math.min(1, 1 - perclos / 0.22));

  // Weighted Cognitive Readiness Calculation
  const readiness = Math.round((0.45 * lFactor + 0.20 * jFactor + 0.35 * dFactor) * 100);
  
  return {
    readiness: Math.max(1, readiness),
    avgLatency: Math.round(avgLatency),
    avgJitter: avgJitter,
    perclos: perclos * 100
  };
}

function stopScreeningTrial() {
  state.trialActive = false;
  state.stimulusMode = 'idle';
  
  // Clear game loops
  clearInterval(targetIntervalId);
  cancelAnimationFrame(pursuitFrameId);

  els.stimulusDot.classList.add('hidden');
  els.testHud.classList.add('hidden');
  els.gazeCrosshair.classList.add('hidden');
  
  // Display instruction overlay again
  els.stimulusInstruction.classList.remove('hidden');

  // Trigger modal display
  showDiagnosticSummaryModal();
}

function showDiagnosticSummaryModal() {
  const scores = computeScores();
  
  els.modalReadinessVal.innerText = `${scores.readiness}%`;
  els.modalLatencyVal.innerText = `${scores.avgLatency} ms`;
  els.modalJitterVal.innerText = `${scores.avgJitter.toFixed(1)} px`;
  els.modalBlinksVal.innerText = `${state.blinkCount} / ${scores.perclos.toFixed(1)}%`;

  // Set visual rating badges
  let rating = "Optimal Alertness";
  let badgeClass = "px-4 py-1 rounded-full text-xs font-bold border bg-emerald-950/40 text-emerald-300 border-emerald-900/60";
  let message = "";

  if (scores.readiness >= 80) {
    rating = "Optimal Alertness";
    badgeClass = "px-4 py-1 rounded-full text-xs font-bold border bg-emerald-950/40 text-emerald-300 border-emerald-900/60";
    message = "Your neurological profile indicates high alert levels. Saccadic velocity is rapid (optimal range), micro-movements during fixation are minimized, and drowsiness indicators are absent. Ideal state for complex cognitive tasks.";
  } else if (scores.readiness >= 50) {
    rating = "Moderate Mental Fatigue";
    badgeClass = "px-4 py-1 rounded-full text-xs font-bold border bg-amber-950/40 text-amber-300 border-amber-900/60";
    message = "Moderate latency delay detected. Ocular fatigue markers indicate minor drowsiness or mental exhaustion. Consider a brief break, hydration, or moving away from screens to restore focus.";
  } else {
    rating = "High Cognitive Latency";
    badgeClass = "px-4 py-1 rounded-full text-xs font-bold border bg-rose-950/40 text-rose-300 border-rose-900/60";
    message = "Critical latency indicators identified. Prolonged saccade reaction delays coupled with elevated eye closures suggest high levels of fatigue. Rest is strongly recommended before resuming critical tasks.";
  }

  els.modalStatusBadge.innerText = rating;
  els.modalStatusBadge.className = badgeClass;
  els.modalDiagnosticText.innerText = message;

  // Open modal
  els.resultsModal.classList.remove('hidden');
  els.resultsModal.classList.add('flex');
}

// ----------------------------------------------------
// DEMO PRESET MODE SIMULATION
// ----------------------------------------------------

let lastSimTime = performance.now();
let simFrameCount = 0;

function simulationLoop() {
  if (!state.demoMode) return;

  const now = performance.now();
  
  // Calculate FPS (Simulated)
  simFrameCount++;
  if (now - lastFpsTime >= 1000) {
    state.fps = Math.round((simFrameCount * 1000) / (now - lastFpsTime));
    els.fpsVal.innerText = state.fps;
    simFrameCount = 0;
    lastFpsTime = now;
  }

  // Update confidence
  state.confidence = 100;
  els.confidenceVal.innerText = '100% (Sim)';

  // Process Simulated Blink
  // Introduce a random blink every 3 to 6 seconds
  if (Math.random() < 0.0035) {
    // Start blink
    state.totalFrames += 12;
    state.closedFrames += 8;
    state.blinkCount++;
  } else {
    state.totalFrames += 1;
  }
  
  // Simulated Blink update
  const blinkRate = Math.round(state.blinkCount * (60000 / (state.trialActive ? (30000 - state.trialTimeLeft * 1000 + 1) : 30000)));
  const perclos = (state.closedFrames / (state.totalFrames + 1)) * 100;
  if (state.trialActive) {
    els.blinkVal.innerText = state.blinkCount;
    els.drowsinessVal.innerText = `${perclos.toFixed(1)}% (${perclos < 5 ? 'Alert' : 'Fatigued'})`;
  }

  // If calibrating, simulate gaze features for the current corner
  if (state.calibrationActive) {
    const corner = corners[state.calibrationIndex];
    if (corner) {
      // Create features that map to the corners dynamically based on grid coordinates
      // Maps xPct 0.1 -> 0.36, 0.5 -> 0.50, 0.9 -> 0.64
      let simFx = 0.36 + (corner.xPct - 0.1) * 0.35;
      let simFy = 0.36 + (corner.yPct - 0.1) * 0.35;
      // Add slight jitter
      simFx += (Math.random() - 0.5) * 0.015;
      simFy += (Math.random() - 0.5) * 0.015;
      
      recordCalibrationSample(simFx, simFy);
    }
  }

  // Drive gaze coordinates simulation
  if (state.trialActive) {
    if (state.stimulusMode === 'pursuit') {
      updateDemoGazeSmooth();
    } else if (state.stimulusMode === 'saccadic') {
      updateDemoGazeSaccadic();
    }
    
    // Check diagnostics with simulated coordinates
    checkRealtimeDiagnostics(state.gazeX, state.gazeY);
    updateGazeIndicator();
  }

  requestAnimationFrame(simulationLoop);
}

function updateDemoGazeSmooth() {
  // Gaze follows target coordinates with small delay and jitter
  const noiseX = (Math.random() - 0.5) * state.simJitterScale;
  const noiseY = (Math.random() - 0.5) * state.simJitterScale;
  
  state.gazeX = 0.15 * state.targetX + 0.85 * state.gazeXPrev + noiseX;
  state.gazeY = 0.15 * state.targetY + 0.85 * state.gazeYPrev + noiseY;
  
  state.gazeXPrev = state.gazeX;
  state.gazeYPrev = state.gazeY;
}

function updateDemoGazeSaccadic() {
  const timeSinceJump = Date.now() - state.lastJumpTime;
  const noiseX = (Math.random() - 0.5) * state.simJitterScale;
  const noiseY = (Math.random() - 0.5) * state.simJitterScale;

  if (timeSinceJump < state.simLatencyDelay) {
    // Keep looking at origin target
    state.gazeX = state.targetOriginX + noiseX;
    state.gazeY = state.targetOriginY + noiseY;
  } else {
    // Saccade transition: move towards target quickly
    const transitionTime = 70; // ms
    const t = Math.min(1, (timeSinceJump - state.simLatencyDelay) / transitionTime);
    // Sigmoid step for natural eye movement velocity profile
    const ease = 1 / (1 + Math.exp(-10 * (t - 0.5)));
    
    state.gazeX = state.targetOriginX + (state.targetX - state.targetOriginX) * ease + noiseX;
    state.gazeY = state.targetOriginY + (state.targetY - state.targetOriginY) * ease + noiseY;
  }

  state.gazeXPrev = state.gazeX;
  state.gazeYPrev = state.gazeY;
}

// ----------------------------------------------------
// UI INTERACTION EVENT BINDINGS
// ----------------------------------------------------

els.btnStartCamera.addEventListener('click', () => {
  if (state.cameraActive) {
    disableCamera();
  } else {
    startCamera();
  }
});

els.btnDemoMode.addEventListener('click', () => {
  triggerDemoFallback("Initializing Demo Simulation Mode. Camera bypassed.");
});

els.btnCalibrate.addEventListener('click', () => {
  startCalibration();
});

els.btnStartTest.addEventListener('click', () => {
  startScreeningTrial();
});

els.btnReset.addEventListener('click', () => {
  state.latencyHistory = [];
  state.jitterHistory = [];
  state.blinkCount = 0;
  state.totalFrames = 0;
  state.closedFrames = 0;
  state.fxHistory = [];
  state.fyHistory = [];
  state.calibFaceSizes = [];
  state.calibContrasts = [];
  
  els.latencyVal.innerText = '--';
  els.latencyStatus.innerText = 'Not Tested';
  els.latencyStatus.className = 'text-xs font-semibold text-slate-500 mt-0.5';
  
  els.jitterVal.innerText = '--';
  els.jitterStatus.innerText = 'Not Tested';
  els.jitterStatus.className = 'text-xs font-semibold text-slate-500 mt-0.5';
  
  els.blinkVal.innerText = '--';
  els.drowsinessVal.innerText = 'Not Tested';
  els.drowsinessVal.className = 'text-xs font-semibold text-slate-500 mt-0.5';
  
  els.readinessVal.innerText = '--%';
  els.readinessStatus.innerText = 'Pending';
  els.readinessStatus.className = 'text-xs font-semibold text-slate-500';
  els.readinessCircle.style.strokeDashoffset = '175.9';
  
  initChart();
  playBeep(400, 0.1);
});

// Modal Actions
const closeModal = () => {
  els.resultsModal.classList.add('hidden');
  els.resultsModal.classList.remove('flex');
};

function downloadReport() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const scores = computeScores();
  const status = els.modalStatusBadge.innerText;
  const interpretation = els.modalDiagnosticText.innerText;

  // Font setup
  doc.setFont("helvetica", "normal");

  // Premium Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, 210, 38, "F");

  // Title
  doc.setTextColor(34, 211, 238); // Cyan Accent
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text("SACCADEGAZE AI", 15, 18);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Ocular Latency & Neurological Readiness Screening Report", 15, 26);

  // Time stamp
  const dateStr = new Date().toLocaleString();
  doc.text(`Generated: ${dateStr}`, 140, 26);

  // Layout Borders and Frames
  doc.setDrawColor(226, 232, 240); // Slate-200
  doc.setLineWidth(0.5);

  // Readiness Score Banner Card
  doc.setFillColor(248, 250, 252); // slate-50
  doc.rect(15, 48, 180, 42, "FD");

  doc.setTextColor(71, 85, 105); // slate-600
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("NEUROLOGICAL READINESS INDEX", 25, 58);

  doc.setTextColor(99, 102, 241); // Indigo-500
  doc.setFontSize(38);
  doc.setFont("helvetica", "bold");
  doc.text(`${scores.readiness}%`, 25, 80);

  // Status Badge card inside banner
  doc.setFillColor(238, 242, 255); // Indigo-50
  doc.rect(85, 68, 95, 12, "F");
  doc.setTextColor(79, 70, 229); // Indigo-600
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(status, 90, 76.5);

  // Table Title
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Ocular Screening Metrics Summary", 15, 106);

  // Draw Grid lines
  doc.line(15, 110, 195, 110);
  doc.line(15, 118, 195, 118);

  // Table Headers
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Metric Parameter", 20, 115);
  doc.text("Measured Value", 85, 115);
  doc.text("Clinical Reference Target", 140, 115);

  // Rows
  doc.setFont("helvetica", "normal");

  // Row 1: Saccadic Latency
  doc.text("Average Saccadic Latency", 20, 125);
  doc.setFont("helvetica", "bold");
  doc.text(`${scores.avgLatency} ms`, 85, 125);
  doc.setFont("helvetica", "normal");
  doc.text("160ms - 280ms (Optimal)", 140, 125);
  doc.line(15, 129, 195, 129);

  // Row 2: Fixation Jitter
  doc.text("Average Fixation Gaze Jitter", 20, 136);
  doc.setFont("helvetica", "bold");
  doc.text(`${scores.avgJitter.toFixed(2)} px`, 85, 136);
  doc.setFont("helvetica", "normal");
  doc.text("< 22.0 px (Steady Gaze)", 140, 136);
  doc.line(15, 140, 195, 140);

  // Row 3: Blink Frequency
  doc.text("Blink Frequency", 20, 147);
  doc.setFont("helvetica", "bold");
  doc.text(`${state.blinkCount} blinks`, 85, 147);
  doc.setFont("helvetica", "normal");
  doc.text("6 - 15 blinks/trial", 140, 147);
  doc.line(15, 151, 195, 151);

  // Row 4: PERCLOS
  doc.text("Eye Closure Ratio (PERCLOS)", 20, 158);
  doc.setFont("helvetica", "bold");
  doc.text(`${scores.perclos.toFixed(2)}%`, 85, 158);
  doc.setFont("helvetica", "normal");
  doc.text("< 5.00% (Alert Status)", 140, 158);
  doc.line(15, 162, 195, 162);

  // Clinical Interpretation
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Neurological Assessment & Interpretation", 15, 178);

  doc.setTextColor(71, 85, 105); // slate-600
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  // Word-wrap paragraph content to match page bounds
  const wrappedText = doc.splitTextToSize(interpretation, 180);
  doc.text(wrappedText, 15, 186);

  // Footer Disclaimer Section
  doc.line(15, 265, 195, 265);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.setFontSize(8);
  doc.text("Disclaimer: SaccadeGaze is a non-diagnostic research utility for ocular tracking analysis. Not intended for clinical or diagnostic use.", 15, 272);
  doc.text("Processed locally in-browser using WebAssembly. No data is stored or transmitted.", 15, 277);

  // Trigger PDF file download
  doc.save(`SaccadeGaze_Screening_Report_${new Date().toISOString().slice(0,10)}.pdf`);
}

els.btnCloseModal.addEventListener('click', closeModal);
els.btnModalClose.addEventListener('click', closeModal);
els.btnModalDownload.addEventListener('click', downloadReport);
els.btnModalRestart.addEventListener('click', () => {
  closeModal();
  startScreeningTrial();
});

// Initialize dashboard components
initChart();
