import { FaceTracker } from './faceTracker.js';
import { SpeechHandler } from './speechHandler.js';
const { ipcRenderer } = require('electron');

// UI 요소 가져오기
const widget = document.getElementById('widget');
const statusText = document.getElementById('status-text');
const speechBubble = document.getElementById('speech-bubble');
const video = document.getElementById('webcam');
const inputRow = document.getElementById('input-row');
const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');
const toggleInputButton = document.getElementById('toggle-input-button');

let isGeneratingResponse = false;
let isAppReady = false;
let isAborted = false; // 중단 여부를 체크하는 플래그 추가

// 1. 공통 AI 응답 요청 함수
async function requestAi(payload) {
  if (isGeneratingResponse) return;

  setGeneratingState(true);
  statusText.innerText = 'AI 생각 중...';
  statusText.style.color = '#facc15';

  try {
    const response = await ipcRenderer.invoke('process-ai-request', payload);

    if (response.ok) {
      showResponseBubble(response.reply);
      statusText.innerText = '준비 완료';
      statusText.style.color = '#60a5fa';
    } else {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('AI 요청 실패:', error);
    statusText.innerText = '에러 발생';
    statusText.style.color = '#f87171';
  } finally {
    setGeneratingState(false);
  }
}

// 입력 상태 제어
function setGeneratingState(isGenerating) {
  isGeneratingResponse = isGenerating;
  textInput.disabled = isGenerating;
  sendButton.disabled = isGenerating;
  // AI가 응답 중일 때는 입력창을 닫아주는 것이 UX상 깔끔합니다.
  if (isGenerating) setInputMode(false);
}

// 2. 음성 핸들러 설정
const speech = new SpeechHandler(
  (base64Data, mimeType) => {
    // ✅ 중단 버튼을 눌러서 멈춘 경우라면 AI에게 요청하지 않음
    if (isAborted) {
      console.log('[App] 음성 인식 취소됨: 대기 상태로 전환합니다.');
      isAborted = false; // 플래그 초기화
      return;
    }
    requestAi({ type: 'audio', data: base64Data, mimeType });
  },
  (isRecording) => {
    widget.classList.toggle('recording', isRecording);

    if (isRecording) {
      statusText.innerText = '🎙️ 듣는 중...';
      statusText.style.color = '#4ade80';

      // ✅ 마이크 사용 중일 때 버튼을 '중단'으로 변경
      toggleInputButton.innerText = '중단';
      toggleInputButton.style.backgroundColor = '#f87171'; // 중단 느낌의 빨간색 계열
    } else {
      // 녹음이 끝나면 다시 상태 확인 후 복구
      if (!isGeneratingResponse) {
        statusText.innerText = '준비 완료';
        statusText.style.color = '#60a5fa';
      }

      // 입력창이 닫혀있는 상태라면 다시 '입력'으로, 열려있다면 '닫기'로 복구
      const isTextInputActive = !inputRow.classList.contains('hidden');
      toggleInputButton.innerText = isTextInputActive ? '닫기' : '입력';
      toggleInputButton.style.backgroundColor = '';
    }
  }
);

// 3. 얼굴/손 추적기 설정
const tracker = new FaceTracker(video);

// 메인 루프
function loop() {
  if (!isAppReady || isGeneratingResponse) {
    requestAnimationFrame(loop);
    return;
  }

  const result = tracker.checkGaze();

  if (result) {
    // UI 상태 업데이트
    statusText.innerText = result.faceVisible ? "준비 완료" : "얼굴을 보여주세요";
    statusText.style.color = result.faceVisible ? "#60a5fa" : "gray";

    // ✅ 마이크 중복 실행 방지 및 강화된 손 인식 적용
    if (result.handRaised && !speech.isRecording) {
      // 이미 텍스트 입력창이 열려있다면 닫고 마이크 시작
      if (!inputRow.classList.contains('hidden')) {
        setInputMode(false);
      }
      console.log('[App] 손 감지됨: 마이크 시작');
      speech.start();
    }
  }
  requestAnimationFrame(loop);
}

// 4. 입력 모드 및 텍스트 제출 로직
function setInputMode(show) {
  if (show) {
    // 마이크 녹음 중이라면 즉시 중단 및 UI 초기화
    if (speech.isRecording) {
      isAborted = true;
      console.log('[App] 마이크 취소: 텍스트 모드로 전환합니다.');
      speech.stop();
      // speech.stop()이 호출되면 SpeechHandler 내부에서 onStateChange(false)를 실행하므로
      // 테두리(recording 클래스)는 자동으로 제거됩니다.
    }

    inputRow.classList.remove('hidden');
    toggleInputButton.innerText = '닫기';
    toggleInputButton.style.backgroundColor = '';

    // 약간의 지연 후 포커스를 주어야 Electron에서 확실히 인식됨
    setTimeout(() => textInput.focus(), 10);
  } else {
    inputRow.classList.add('hidden');
    if (!speech.isRecording) {
      toggleInputButton.innerText = '입력';
    }
    textInput.value = '';
    textInput.blur();
  }
}

function toggleTextInput() {
  const isCurrentlyHidden = inputRow.classList.contains('hidden');

  // ✅ 만약 마이크가 켜져 있는 상태에서 버튼(중단)을 누른 것이라면
  if (speech.isRecording) {
    speech.stop(); // 녹음 중단 (이후 SpeechHandler 콜백에 의해 '입력'으로 돌아감)
    return;
  }

  setInputMode(isCurrentlyHidden);
}

// ✅ 누락되었던 텍스트 제출 함수 추가
async function handleTextSubmit() {
  const text = textInput.value.trim();
  if (text && !isGeneratingResponse) {
    await requestAi({ type: 'text', data: text });
    textInput.value = '';
  }
}

toggleInputButton.addEventListener('click', toggleTextInput);
sendButton.addEventListener('click', handleTextSubmit); // 전송 버튼 연결

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleTextSubmit();
  }
});

// 5. 말풍선 표시
function showResponseBubble(text) {
  speechBubble.innerText = text;
  speechBubble.style.display = 'block';

  // 기존에 설정된 타이머가 있다면 초기화하는 로직을 추가하면 더 안정적입니다.
  if (window.bubbleTimeout) clearTimeout(window.bubbleTimeout);

  window.bubbleTimeout = setTimeout(() => {
    speechBubble.style.display = 'none';
    speechBubble.innerText = '';
  }, 7000); // 답변이 길 수 있으니 7초로 넉넉하게 설정
}

// 6. 앱 시작
async function startApp() {
  try {
    statusText.innerText = "로딩 중...";
    await tracker.init();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 240, height: 300 }
    });

    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      isAppReady = true;
      statusText.innerText = "준비 완료";
      loop();
    };
  } catch (err) {
    console.error(err);
    statusText.innerText = "카메라 에러";
    statusText.style.color = "#f87171";
  }
}

startApp();