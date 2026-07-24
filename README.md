# SaccadeGaze AI — Neurological & Ocular Latency Screening Tool

SaccadeGaze is a premium, client-side web application hosted on GitHub Pages that uses the user's webcam and Google MediaPipe Face Mesh / Iris Tracking to screen for ocular micro-movements, saccadic reaction latency, and cognitive fatigue.

---

## 🔬 Scientific Foundations & Methodology

Ocular movement monitoring is a non-invasive window into neurological function. The SaccadeGaze engine tracks three primary metrics to determine a user's **Neurological Readiness / Fatigue Score**:

### 1. Saccadic Reaction Latency
A saccade is a rapid, conjugate eye movement that shifts the center of gaze from one target to another. 
- **Method**: The target dot teleports to a random coordinates. Saccade latency measures the time elapsed from target jump to the initiation of the rapid gaze repositioning.
- **Metric**: Measured in milliseconds (ms). Standard latencies range from **180ms to 240ms** in alert individuals. Prolonged delays (>350ms) are correlated with sleep deprivation, mental burnout, or cognitive fatigue.
- **Trigger**: Saccade completion is registered when the estimated gaze moves past **38% of the distance** from the origin to the destination along the jump vector.

### 2. Fixation Jitter (Microsaccades)
During steady fixation on a stationary object, the eyes continue to make micro-movements (microsaccades, drift, and tremor).
- **Method**: The stimulus dot remains stationary for a 1.2-second pause after jumping. The first 300ms is discarded to allow eye relocation. During the final 900ms, the standard deviation of gaze coordinate offsets is collected.
- **Metric**: Measured in pixels (px). Elevated jitter suggests unstable oculomotor control, typical under high mental strain or focus fatigue.

### 3. Blink Rate & Drowsiness (PERCLOS)
Eye closures and blink patterns change significantly with fatigue.
- **Method**: Tracking the vertical-to-horizontal ratio of the eyelids (Eye Aspect Ratio - EAR).
- **PERCLOS**: Percentage of eye closure time (EAR < 0.18) during the 20-second trial window. A high PERCLOS score (>15%) is a clinically established indicator of micro-sleep states and severe drowsiness.

---

## 🛠️ Architecture & Math Formulas

The app uses **Eye Socket Normalization** to make pupil tracking robust against minor head rotations and shifts:

1. **Normalized Eye Ratios**:
   $$fx = \frac{\text{IrisCenter.x} - \text{InnerCorner.x}}{|\text{OuterCorner.x} - \text{InnerCorner.x}| + \epsilon}$$
   $$fy = \frac{\text{IrisCenter.y} - \text{TopEyelid.y}}{|\text{BottomEyelid.y} - \text{TopEyelid.y}| + \epsilon}$$

   By calculating offsets relative to the eye socket corners rather than the raw pixel coordinates, we maintain head-pose-invariant gaze features. Denominator operations utilize absolute values (`Math.abs`) to prevent widths from flipping under mirroring.

2. **Calibration Engine**:
   Displays targets at four corners ($10\%$ and $90\%$ of screen margins). It samples the minimum and maximum normal features ($fx_{min}, fx_{max}, fy_{min}, fy_{max}$) to construct a linear interpolation mapping to pixel coordinates.

3. **Cognitive Readiness Index**:
   $$Readiness (%) = (0.50 \times LatencyFactor + 0.25 \times JitterFactor + 0.25 \times DrowsinessFactor) \times 100\%$$
   - **Latency Factor**: Clamped linear function between 180ms (1.0) and 450ms (0.0).
   - **Jitter Factor**: Clamped linear function between 7px (1.0) and 38px (0.0).
   - **Drowsiness Factor**: Clamped linear function between 0% PERCLOS (1.0) and 22% PERCLOS (0.0).

---

## 💻 How to Run Locally

Since the app is entirely client-side, it runs out of the box in modern browsers:

1. Clone or download the workspace directory.
2. Open `index.html` in Google Chrome, Microsoft Edge, or Safari.
3. Ensure you grant webcam permissions when prompted.
4. **No Webcam?** Click the **Demo Preset** button to simulate human-like gaze tracking metrics and verify chart functions live!

---

## 🔒 Privacy & Security

All mathematical calculations and video frames are processed **locally in the browser** using WebAssembly. No webcam footage or coordinate telemetry is sent to external servers or cloud services.

---

Copyright (c) 2026 Rajveer Sanghvi. All Rights Reserved.

This repository and its source code are proprietary and confidential. 
Unauthorized copying, modification, distribution, or commercial use of 
this software via any medium is strictly prohibited without explicit 
written permission from the copyright owner.
