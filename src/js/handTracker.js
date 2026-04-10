import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

export class HandTracker {
    constructor(videoElement) {
        this.video = videoElement;
        this.handLandmarker = null;
        this.lastVideoTime = -1;
    }

    async init() {
        try {
            const filesetResolver = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );
            this.handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                    delegate: "GPU" // 에러 시 "CPU"로 폴백하는 로직 추가 가능
                },
                runningMode: "VIDEO",
                numHands: 1 // 한 손만 인식
            });
            console.log("✅ 손 인식 모델 로드 완료");
        } catch (error) {
            console.error("❌ 손 인식 모델 로드 실패:", error);
        }
    }

    // 손바닥이 확실히 보이는지 체크하는 함수
    checkHandGesture() {
        if (!this.handLandmarker || this.video.readyState < 2) return false;
        if (this.video.currentTime === this.lastVideoTime) return false;

        this.lastVideoTime = this.video.currentTime;
        const results = this.handLandmarker.detectForVideo(this.video, performance.now());

        if (results.landmarks && results.landmarks.length > 0) {
            const hand = results.landmarks[0];

            // 손목(0)과 중지 끝(12)의 거리를 계산하여 손을 쫙 폈는지(손바닥을 보였는지) 대략적으로 판별
            const wrist = hand[0];
            const middleFingerTip = hand[12];

            // 손가락이 화면 위쪽을 향하고 있는지 (y값이 작을수록 위쪽)
            const isHandUp = middleFingerTip.y < wrist.y;

            // 손이 화면 안쪽에 적당히 들어왔는지 판단 (너무 가장자리가 아닐 것)
            const isInsideFrame = wrist.x > 0.1 && wrist.x < 0.9 && wrist.y > 0.1;

            return isHandUp && isInsideFrame;
        }

        return false;
    }
}