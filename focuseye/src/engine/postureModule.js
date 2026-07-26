// postureModule.js
// Analyzes head position and ergonomics (slumping / leaning forward).

let baselineIPD = null;
let baselineArea = null;

let slumpingStartTime = null;
const SLUMP_DURATION_THRESHOLD_MS = 15000; // 15 consecutive seconds
const EXPANSION_THRESHOLD = 1.35; // 1.35x baseline size

function euclideanDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Computes bounding box area for the face mesh
function computeFaceArea(landmarks) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const point of landmarks) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
    }
    
    return (maxX - minX) * (maxY - minY);
}

self.onmessage = function(e) {
    const { type, landmarks, leftIris, rightIris, timestamp } = e.data;

    if (type === 'SET_BASELINE') {
        baselineIPD = euclideanDistance(leftIris[0], rightIris[0]);
        baselineArea = computeFaceArea(landmarks);
        self.postMessage({ type: 'BASELINE_SET', ipd: baselineIPD, area: baselineArea });
    } 
    else if (type === 'PROCESS_FRAME') {
        if (!baselineIPD || !baselineArea) return;

        const currentIPD = euclideanDistance(leftIris[0], rightIris[0]);
        const currentArea = computeFaceArea(landmarks);

        const ipdRatio = currentIPD / baselineIPD;
        const areaRatio = currentArea / baselineArea;

        // If either the IPD or the bounding box area expands beyond 1.35x, user is leaning in
        if (ipdRatio > EXPANSION_THRESHOLD || areaRatio > EXPANSION_THRESHOLD) {
            if (!slumpingStartTime) {
                slumpingStartTime = timestamp;
            } else if (timestamp - slumpingStartTime > SLUMP_DURATION_THRESHOLD_MS) {
                self.postMessage({
                    type: 'POSTURE_ALERT',
                    message: 'Posture Warning: You are leaning too close to the screen. Please sit back.'
                });
                // Reset timer so it doesn't spam every frame, will trigger again after 15s if they don't move
                slumpingStartTime = timestamp; 
            }
        } else {
            // User is in a healthy posture, reset the timer
            slumpingStartTime = null;
        }

        self.postMessage({
            type: 'POSTURE_UPDATE',
            status: slumpingStartTime ? 'WARNING_PENDING' : 'HEALTHY',
            ipdRatio,
            areaRatio
        });
    }
};
