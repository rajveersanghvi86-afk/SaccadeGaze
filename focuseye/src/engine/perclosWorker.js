// perclosWorker.js
// Processes facial landmark coordinates to monitor EAR, blinks, PERCLOS, and the 20-20-20 rule.

let frameBuffer = []; // stores { timestamp, ear }
const BUFFER_WINDOW_MS = 60000; // 60 seconds rolling window
const BLINK_EAR_THRESHOLD = 0.20;
const PERCLOS_EAR_THRESHOLD = 0.15;

let consecutiveBlinkFrames = 0;
let totalBlinks = 0; // within the 60s window
let lastBlinkTime = 0;

let continuousFocusStart = Date.now();
const TWENTY_MINUTES_MS = 20 * 60 * 1000;

// EAR Formula: (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function calculateEAR(eyeLandmarks) {
    // eyeLandmarks is an array of 6 points for the eye contour
    // Typically: 0:Left, 1:TopLeft, 2:TopRight, 3:Right, 4:BottomRight, 5:BottomLeft
    const p1 = eyeLandmarks[0];
    const p2 = eyeLandmarks[1];
    const p3 = eyeLandmarks[2];
    const p4 = eyeLandmarks[3];
    const p5 = eyeLandmarks[4];
    const p6 = eyeLandmarks[5];

    const v1 = euclideanDistance(p2, p6);
    const v2 = euclideanDistance(p3, p5);
    const h  = euclideanDistance(p1, p4);

    return (v1 + v2) / (2.0 * h + 1e-6);
}

self.onmessage = function(e) {
    const { type, leftEye, rightEye, timestamp } = e.data;

    if (type === 'PROCESS_FRAME') {
        const leftEAR = calculateEAR(leftEye);
        const rightEAR = calculateEAR(rightEye);
        const avgEAR = (leftEAR + rightEAR) / 2.0;

        frameBuffer.push({ timestamp, ear: avgEAR });

        // Clean up old frames > 60s
        while (frameBuffer.length > 0 && timestamp - frameBuffer[0].timestamp > BUFFER_WINDOW_MS) {
            frameBuffer.shift();
        }

        // Blink Detection
        if (avgEAR < BLINK_EAR_THRESHOLD) {
            consecutiveBlinkFrames++;
        } else {
            // Blink finished
            if (consecutiveBlinkFrames >= 1 && consecutiveBlinkFrames <= 3) {
                // Register a valid blink
                // We don't count blinks that are too long (could be looking away or sleeping)
                totalBlinks++;
                lastBlinkTime = timestamp;
                self.postMessage({ type: 'BLINK_DETECTED', timestamp });
            }
            consecutiveBlinkFrames = 0;
        }

        // Calculate current metrics
        const totalFrames = frameBuffer.length;
        let closedFrames = 0;
        let recentBlinks = 0;

        for (let i = 0; i < totalFrames; i++) {
            if (frameBuffer[i].ear < PERCLOS_EAR_THRESHOLD) {
                closedFrames++;
            }
            // For BPM, we could track exact blink timestamps, but we'll approximate 
            // by keeping a separate array of blink timestamps if needed, 
            // or just use `totalBlinks` and reset it periodically. 
            // Actually, let's just track blink events in the main thread for BPM,
            // or let the worker manage a blinkBuffer.
        }

        const perclos = (closedFrames / totalFrames) * 100;

        let state = 'NORMAL';
        if (perclos >= 15.0) {
            state = 'SEVERE';
            // Alert main thread immediately
            self.postMessage({ type: 'DROWSINESS_ALERT', level: 'SEVERE', perclos });
        } else if (perclos >= 7.5) {
            state = 'MODERATE';
        }

        // 20-20-20 Rule Check
        if (timestamp - continuousFocusStart > TWENTY_MINUTES_MS) {
            self.postMessage({ type: 'STRAIN_ALERT', message: '20-20-20 Rule: Look 20 feet away for 20 seconds!' });
            continuousFocusStart = timestamp; // Reset timer after alert
        }

        self.postMessage({
            type: 'METRICS_UPDATE',
            ear: avgEAR,
            perclos,
            state
        });
    } else if (type === 'RESET_FOCUS_TIMER') {
        continuousFocusStart = Date.now();
    }
};
