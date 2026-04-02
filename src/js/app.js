// 구글 MediaPipe 라이브러리 불러오기
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const statusText = document.getElementById('status-text');
const video = document.getElementById('webcam');
let faceLandmarker;

// 1. AI 모델 세팅하기
async function initializeFaceLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
      delegate: "GPU"
    },
    outputFaceBlendshapes: false,
    runningMode: "VIDEO",
    numFaces: 1 // 한 명의 얼굴만 추적
  });
  
  startCamera(); // 세팅 끝나면 카메라 켜기
}

// 2. 웹캠 켜기
function startCamera() {
  navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
    video.srcObject = stream;
    video.addEventListener("loadeddata", predictWebcam);
    statusText.innerText = "카메라 연동 완료!";
  }).catch((err) => {
    statusText.innerText = "카메라 권한 에러!";
    console.error(err);
  });
}

// 3. 매 프레임마다 고개 방향 확인하기
let lastVideoTime = -1;
function predictWebcam() {
  let startTimeMs = performance.now();
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    const results = faceLandmarker.detectForVideo(video, startTimeMs);

    // 얼굴이 화면에 보인다면
    if (results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];
      
      // 코끝(1), 왼쪽 뺨(234), 오른쪽 뺨(454) 좌표 추출
        const nose = landmarks[1].x;
        const leftCheek = landmarks[234].x;
        const rightCheek = landmarks[454].x;
        
        const ratio = (nose - leftCheek) / (rightCheek - nose); // 고개 방향 비율 계산

      // 1. 위젯이 모니터의 왼쪽 절반에 있는지 오른쪽 절반에 있는지 파악 (화면 가로 길이의 절반 기준)
      const isWidgetOnLeft = window.screenX < (window.screen.width / 2);

      // 2. 사용자의 시선 방향 (반대였던 방향을 수정했습니다)
      const isLookingLeft = ratio > 1.2;
      const isLookingRight = ratio < 0.8;

      // 3. 위젯 위치와 내 시선이 일치하는지 확인!
      let isLookingAtWidget = false;
      if (isWidgetOnLeft && isLookingLeft) {
        isLookingAtWidget = true; // 위젯이 왼쪽에 있고, 나도 왼쪽을 봄
      } else if (!isWidgetOnLeft && isLookingRight) {
        isLookingAtWidget = true; // 위젯이 오른쪽에 있고, 나도 오른쪽을 봄
      }

      // 4. 결과 출력
      if (isLookingAtWidget) {
        statusText.innerText = "🎙️ 듣는 중...";
        statusText.style.color = "#4ade80"; // 초록색으로 변경 (여기서 음성인식 시작!)
      } else {
        statusText.innerText = "딴 곳 보는 중";
        statusText.style.color = "gray"; // 시선을 떼면 대기 상태 (여기서 음성인식 종료!)
      }
    }
  }
  // 계속 반복
  window.requestAnimationFrame(predictWebcam);
}

// 프로그램 시작!
initializeFaceLandmarker();