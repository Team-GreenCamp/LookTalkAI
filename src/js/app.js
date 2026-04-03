import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const statusText = document.getElementById('status-text');
const video = document.getElementById('webcam');
let faceLandmarker;

async function initializeFaceLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numFaces: 1
  });
  startCamera();
}

function startCamera() {
  navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
    video.srcObject = stream;
    video.addEventListener("loadeddata", predictWebcam);
  }).catch((err) => console.error("카메라 에러:", err));
}

let lastVideoTime = -1;
function predictWebcam() {
  let startTimeMs = performance.now();
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    const results = faceLandmarker.detectForVideo(video, startTimeMs);

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];
      
      // 1. 얼굴 방향 계산을 위한 포인트 추출
      // --- 좌우(Yaw) 계산용 포인트 ---
      const nose = landmarks[1];      // 코끝
      const leftCheek = landmarks[234]; // 왼쪽 끝
      const rightCheek = landmarks[454]; // 오른쪽 끝
      const yawRatio = (nose.x - leftCheek.x) / (rightCheek.x - nose.x);

      // --- 상하(Pitch) 계산용 포인트 ---
      const forehead = landmarks[10]; // 이마 위쪽
      const chin = landmarks[152];    // 턱 끝
      const pitchRatio = (nose.y - forehead.y) / (chin.y - nose.y);

      // 2. 위젯의 화면 위치 파악 (X, Y 비율)
      const screenW = window.screen.width;
      const screenH = window.screen.height;
      const widgetX = window.screenX + 75; // 위젯 중심
      const widgetY = window.screenY + 75;

      const posX = widgetX / screenW; // 0~1 (좌~우)
      const posY = widgetY / screenH; // 0~1 (상~하)

      // 3. 시선 판별 로직
      let matchX = false;
      let matchY = false;

      // 좌우 매칭
      if (posX < 0.35 && yawRatio > 1.4) matchX = true;       // 왼쪽 위젯 & 왼쪽 봄
      else if (posX > 0.65 && yawRatio < 0.7) matchX = true;  // 오른쪽 위젯 & 오른쪽 봄
      else if (posX >= 0.35 && posX <= 0.65 && yawRatio >= 0.7 && yawRatio <= 1.4) matchX = true; // 중앙

      // 상하 매칭 (비율 숫자는 카메라 각도에 따라 0.8~1.2 사이에서 튜닝)
      if (posY < 0.3 && pitchRatio < 0.9) matchY = true;      // 상단 위젯 & 고개 듦
      else if (posY > 0.7 && pitchRatio > 1.08) matchY = true; // 하단 위젯 & 고개 숙임
      else if (posY >= 0.3 && posY <= 0.7 && pitchRatio >= 0.9 && pitchRatio <= 1.1) matchY = true; // 중앙


      // 5. 상태 업데이트
      updateStatus(matchX && matchY);
    } else {
      updateStatus(false, "얼굴 없음");
    }
  }
  window.requestAnimationFrame(predictWebcam);
}

function updateStatus(isActive, msg) {
  if (msg === "얼굴 없음") {
    statusText.innerText = "얼굴을 보여주세요";
    statusText.style.color = "gray";
    return;
  }

  if (isActive) {
    if (statusText.innerText !== "🎙️ 듣는 중...") {
      statusText.innerText = "🎙️ 듣는 중...";
      statusText.style.color = "#4ade80";
      // TODO: startSTT(); 
    }
  } else {
    if (statusText.innerText !== "딴 곳 보는 중") {
      statusText.innerText = "딴 곳 보는 중";
      statusText.style.color = "gray";
      // TODO: stopSTT();
    }
  }
}

initializeFaceLandmarker();