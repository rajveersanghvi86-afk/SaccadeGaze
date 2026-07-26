// src/ui/app.js
import { GazeEngine } from '../engine/gazeEngine.js';
import { FocusAnalytics } from '../engine/focusAnalytics.js';

// Elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d');
const btnRecalibrate = document.getElementById('btnRecalibrate');
const statBpm = document.getElementById('statBpm');
const statPerclos = document.getElementById('statPerclos');
const statPerclosDesc = document.getElementById('statPerclosDesc');
const statPosture = document.getElementById('statPosture');
const statPostureDesc = document.getElementById('statPostureDesc');
const statFocus = document.getElementById('statFocus');
const chartCanvas = document.getElementById('focusChart');

// State
let baselineSet = false;
let totalBlinks = 0;
let lastBpmUpdate = Date.now();
let lastVideoTime = -1;
let focusChart = null;

// Modules
const gazeEngine = new GazeEngine();
const focusAnalytics = new FocusAnalytics();
const perclosWorker = new Worker(new URL('../engine/perclosWorker.js', import.meta.url), { type: 'module' });
const postureWorker = new Worker(new URL('../engine/postureModule.js', import.meta.url), { type: 'module' });

// Tauri vs Web Fallback Adapters
function notifyUser(title, body) {
    if (window.__TAURI__ && window.__TAURI__.notification) {
        window.__TAURI__.notification.sendNotification({ title, body });
    } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
    }
}

function updateTray(state) {
    if (window.__TAURI__) {
        window.__TAURI__.core.invoke('update_tray_state', { state }).catch(e => console.warn('Tray update failed:', e));
    }
}

async function init() {
    // Request notification permissions for Web fallback
    if (!window.__TAURI__ && 'Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }

    // Initialize Chart.js
    initChart();

    await gazeEngine.init();
    await focusAnalytics.init();

    // Setup Worker Handlers
    perclosWorker.onmessage = (e) => {
        if (e.data.type === 'METRICS_UPDATE') {
            const perclos = e.data.perclos.toFixed(1);
            statPerclos.innerText = `${perclos}%`;
            
            if (e.data.state === 'NORMAL') {
                statPerclos.className = 'stat-value healthy';
                statPerclosDesc.innerText = 'Alert & Awake';
            } else if (e.data.state === 'MODERATE') {
                statPerclos.className = 'stat-value warning';
                statPerclosDesc.innerText = 'Getting Tired';
            } else {
                statPerclos.className = 'stat-value danger';
                statPerclosDesc.innerText = 'Drowsy';
            }
        } else if (e.data.type === 'BLINK_DETECTED') {
            totalBlinks++;
        } else if (e.data.type === 'DROWSINESS_ALERT') {
            updateTray('drowsy');
            notifyUser('FocusEye', 'You seem drowsy. Take a break!');
        } else if (e.data.type === 'STRAIN_ALERT') {
            notifyUser('FocusEye', e.data.message);
        }
    };

    postureWorker.onmessage = (e) => {
        if (e.data.type === 'POSTURE_UPDATE') {
            if (e.data.status === 'HEALTHY') {
                statPosture.innerText = 'Healthy';
                statPosture.className = 'stat-value healthy';
                statPostureDesc.innerText = 'Distance optimal';
                updateTray('focus');
            } else {
                statPosture.innerText = 'Slumping';
                statPosture.className = 'stat-value warning';
                statPostureDesc.innerText = 'Leaning in';
                updateTray('warning');
            }
        } else if (e.data.type === 'POSTURE_ALERT') {
            notifyUser('FocusEye', e.data.message);
        }
    };

    // BPM and Focus Score Loop
    setInterval(() => {
        const now = Date.now();
        const elapsedMinutes = (now - lastBpmUpdate) / 60000;
        // Require at least 10 seconds to update BPM to avoid highly volatile jumps
        if (elapsedMinutes >= 10/60) {
            const bpm = Math.round(totalBlinks / elapsedMinutes);
            statBpm.innerHTML = `${bpm}<span style="font-size: 1rem; color: var(--text-muted);"> BPM</span>`;
            statBpm.className = (bpm >= 15 && bpm <= 20) ? 'stat-value healthy' : 'stat-value warning';
            
            const { score } = focusAnalytics.calculateCurrentScore(bpm);
            statFocus.innerText = Math.round(score);
            if (score >= 80) statFocus.className = 'stat-value healthy';
            else if (score >= 50) statFocus.className = 'stat-value warning';
            else statFocus.className = 'stat-value danger';
            
            // Update chart in real-time
            updateChart(score);

            totalBlinks = 0;
            lastBpmUpdate = now;
        }
    }, 10000);

    // Save metrics every 5 mins
    setInterval(() => { focusAnalytics.logScoreInterval(); }, 5 * 60 * 1000);

    // Camera Setup
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 } });
        video.srcObject = stream;
        video.play();
        video.addEventListener('loadeddata', () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            requestAnimationFrame(predictWebcam);
        });
    } catch (err) {
        console.error("Camera access denied:", err);
        alert("Camera access is required for FocusEye to monitor your gaze. Please allow camera permissions.");
    }
}

function initChart() {
    if (!chartCanvas || typeof Chart === 'undefined') return;
    
    // Set default Chart.js colors to match our theme
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Outfit', sans-serif";

    focusChart = new Chart(chartCanvas, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Focus Score',
                data: [],
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#10b981',
                pointRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false }
            },
            animation: { duration: 400 }
        }
    });
}

function updateChart(score) {
    if (!focusChart) return;
    const now = new Date();
    const timeLabel = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    focusChart.data.labels.push(timeLabel);
    focusChart.data.datasets[0].data.push(score);

    // Keep last 15 points
    if (focusChart.data.labels.length > 15) {
        focusChart.data.labels.shift();
        focusChart.data.datasets[0].data.shift();
    }
    
    focusChart.update();
}

function predictWebcam() {
    const startTimeMs = performance.now();
    
    // 1. Draw mirrored video frame to canvas so the user sees the live feed!
    ctx.save();
    ctx.scale(-1, 1); // Flip horizontally
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    // 2. Process landmarks on top
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        const results = gazeEngine.processFrame(video, startTimeMs);

        if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
            const landmarks = results.faceLandmarks[0];
            
            // Left Eye (Image right): 362, 385, 387, 263, 373, 380
            // Right Eye (Image left): 33, 160, 158, 133, 153, 144
            const rightEye = [landmarks[33], landmarks[160], landmarks[158], landmarks[133], landmarks[153], landmarks[144]];
            const leftEye = [landmarks[362], landmarks[385], landmarks[387], landmarks[263], landmarks[373], landmarks[380]];
            const leftIris = [landmarks[468]];
            const rightIris = [landmarks[473]];

            perclosWorker.postMessage({
                type: 'PROCESS_FRAME',
                leftEye, rightEye, timestamp: startTimeMs
            });

            if (!baselineSet) {
                postureWorker.postMessage({
                    type: 'SET_BASELINE',
                    landmarks, leftIris, rightIris, timestamp: startTimeMs
                });
                baselineSet = true;
            }

            postureWorker.postMessage({
                type: 'PROCESS_FRAME',
                landmarks, leftIris, rightIris, timestamp: startTimeMs
            });

            if (leftIris[0]) {
                const gazeX = leftIris[0].x * window.innerWidth;
                const gazeY = leftIris[0].y * window.innerHeight;
                focusAnalytics.updateGaze(gazeX, gazeY, window.innerWidth, window.innerHeight);
            }
            
            // Draw eye tracking dots (must also mirror their X coordinates!)
            ctx.fillStyle = '#10b981'; // Emerald
            for (const pt of leftEye) { 
                ctx.beginPath(); 
                // Notice: 1 - pt.x handles the horizontal mirroring for the dots!
                ctx.arc((1 - pt.x) * canvas.width, pt.y * canvas.height, 2, 0, 2*Math.PI); 
                ctx.fill(); 
            }
            for (const pt of rightEye) { 
                ctx.beginPath(); 
                ctx.arc((1 - pt.x) * canvas.width, pt.y * canvas.height, 2, 0, 2*Math.PI); 
                ctx.fill(); 
            }
        }
    }
    requestAnimationFrame(predictWebcam);
}

btnRecalibrate.addEventListener('click', () => {
    baselineSet = false;
});

// Start app
init();
