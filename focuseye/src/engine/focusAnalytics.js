// focusAnalytics.js
// Handles Focus Score calculation and local Tauri Store persistence.

import { Store } from '@tauri-apps/plugin-store';

export class FocusAnalytics {
    constructor() {
        this.store = new Store('focuseye-analytics.bin');
        this.resetSession();
    }

    async init() {
        await this.store.load();
        const history = await this.store.get('daily_scores') || [];
        console.log('Loaded focus history:', history);
    }

    resetSession() {
        this.sessionStartTime = Date.now();
        this.totalFrames = 0;
        this.onScreenFrames = 0;
        this.distractionShifts = 0;
        
        this.lastGazeOnScreen = true;
        this.currentFocusScore = 0;
    }

    updateGaze(gazeX, gazeY, screenWidth, screenHeight) {
        this.totalFrames++;

        const isOnScreen = gazeX >= 0 && gazeX <= screenWidth && gazeY >= 0 && gazeY <= screenHeight;
        
        if (isOnScreen) {
            this.onScreenFrames++;
        }

        // Detect a shift from on-screen to off-screen
        if (this.lastGazeOnScreen && !isOnScreen) {
            this.distractionShifts++;
        }

        this.lastGazeOnScreen = isOnScreen;
    }

    // Call this periodically (e.g. every second) to compute the score
    calculateCurrentScore(currentBPM) {
        const sar = this.totalFrames > 0 ? (this.onScreenFrames / this.totalFrames) : 1.0;
        
        // Optimal blink score: Assume 15-20 BPM is optimal. 
        // If BPM is too low (staring), penalty. If too high (dry eyes/stress), penalty.
        let blinkScore = 20;
        if (currentBPM < 5) blinkScore = 5;
        else if (currentBPM >= 5 && currentBPM < 10) blinkScore = 10;
        else if (currentBPM > 30) blinkScore = 15;
        else blinkScore = 20;

        // Focus Score = (SAR * 60) + (Optimal Blink Score) - (Distraction Shifts * 2)
        let score = (sar * 60.0) + blinkScore - (this.distractionShifts * 2);
        
        score = Math.max(0, Math.min(100, score)); // Clamp between 0 and 100
        this.currentFocusScore = score;
        
        return { score, sar: (sar * 100).toFixed(1) };
    }

    // Call this every 5 minutes to log the score securely
    async logScoreInterval() {
        const timestamp = new Date().toISOString();
        let history = await this.store.get('daily_scores');
        if (!Array.isArray(history)) {
            history = [];
        }

        history.push({
            time: timestamp,
            score: this.currentFocusScore,
            distractions: this.distractionShifts
        });

        // Keep last 288 intervals (24 hours at 5 min intervals)
        if (history.length > 288) {
            history.shift();
        }

        await this.store.set('daily_scores', history);
        await this.store.save();
        console.log(`Saved focus score: ${this.currentFocusScore.toFixed(1)}`);
        
        // Reset counters for the next 5 minute interval
        this.totalFrames = 0;
        this.onScreenFrames = 0;
        this.distractionShifts = 0;
    }
}
