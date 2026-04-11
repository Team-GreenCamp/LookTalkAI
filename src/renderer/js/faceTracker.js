import { FaceLandmarker, FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

export class FaceTracker {
    constructor(videoElement) {
        this.video = videoElement;
        this.faceLandmarker = null;
        this.handLandmarker = null;
        this.lastVideoTime = -1;
        this.lastDebugLogTime = 0;
    }

    async init() {
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );

        this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1
        });

        this.handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 1
        });
        console.log("✅ 모델 초기화 완료 (디버그 모드 활성)");
    }

    // 주기적인 디버그 로그 출력
    logDebug(message, data = null) {
        const now = performance.now();
        if (now - this.lastDebugLogTime < 1000) return; // 1초 간격 제한
        this.lastDebugLogTime = now;
        console.log(`[FaceTracker] ${message}`, data || "");
    }

    isHandRaised(handLandmarks, faceLandmarks) {
        if (!handLandmarks || handLandmarks.length === 0) return false;

        const foreheadY = faceLandmarks && faceLandmarks[0] ? faceLandmarks[0][10].y : 0.4;

        return handLandmarks.some((hand) => {
            const wrist = hand[0];
            const middleFingerTip = hand[12];
            const indexFingerTip = hand[8];
            const isUp = middleFingerTip.y < wrist.y && indexFingerTip.y < wrist.y;
            const isAboveHead = middleFingerTip.y < foreheadY - 0.05; // 이마보다 5% 더 위
            const handExtension = Math.abs(wrist.y - middleFingerTip.y);
            const isExtended = handExtension > 0.1;

            if (isUp && isAboveHead && isExtended) {
                this.logDebug("🖐️ 손 들기 감지됨!");
            }
            return isUp && isAboveHead && isExtended;
        });
    }

    checkGaze() {
        if (!this.faceLandmarker || !this.handLandmarker || this.video.readyState < 2) return null;
        if (this.video.currentTime === this.lastVideoTime) return null;

        this.lastVideoTime = this.video.currentTime;
        const timestamp = performance.now();

        const faceResults = this.faceLandmarker.detectForVideo(this.video, timestamp);
        const handResults = this.handLandmarker.detectForVideo(this.video, timestamp);

        const faceVisible = faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0;
        const handRaised = this.isHandRaised(handResults?.landmarks, faceResults?.faceLandmarks);
        // 얼굴 상태 디버깅
        if (!faceVisible) {
            this.logDebug("👤 얼굴 미검출 상태");
        }

        return {
            faceVisible,
            handRaised,
            msg: faceVisible ? "OK" : "얼굴 없음"
        };
    }
}