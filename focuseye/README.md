# FocusEye

FocusEye is a privacy-first, cross-platform desktop ergonomics suite built with Tauri v2 (Rust + Vanilla JS). It monitors knowledge worker eye strain (20-20-20 rule), PERCLOS drowsiness, postural slumping, and daily deep-work focus scores—all running entirely locally without any video streams leaving your machine.

## Features
- **True Privacy**: 100% offline, local machine learning models via MediaPipe. No frames saved, no CDN calls.
- **Eye Tracking**: Robust 9-point Inverse Distance Weighting (IDW) gaze estimation engine.
- **Ergonomics**: Real-time Eye Aspect Ratio (EAR) for blink counting and 20-20-20 eye strain monitoring.
- **Fatigue Monitoring**: PERCLOS (Percentage of Eye Closure) drowsiness tracking with OS-native alerts.
- **Posture Tracking**: Warns against slumping and forward leaning based on IPD bounding box expansion.
- **Deep Work Analytics**: Daily Focus Score tracking securely stored via native Tauri store.

## Development Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+)
- [Rust](https://rustup.rs/) (v1.75+)

### Running Locally
```bash
npm install
npm run tauri dev
```
