// gazeEngine.js
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export class GazeEngine {
    constructor() {
        this.faceLandmarker = null;
    }

    async init() {
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
        );
        this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "GPU"
            },
            outputFaceBlendshapes: false,
            runningMode: "VIDEO",
            numFaces: 1
        });
    }

    processFrame(videoElement, timestamp) {
        if (!this.faceLandmarker) return null;
        return this.faceLandmarker.detectForVideo(videoElement, timestamp);
    }
}
