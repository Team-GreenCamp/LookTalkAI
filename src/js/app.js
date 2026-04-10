import { FaceTracker } from './faceTracker.js';
import { SpeechHandler } from './speechHandler.js';

const { ipcRenderer } = require('electron');

// ── DOM 요소 캐싱 ──
const widget = document.getElementById('widget');
const statusText = document.getElementById('status-text');
const speechBubble = document.getElementById('speech-bubble');
const video = document.getElementById('webcam');
const inputRow = document.getElementById('input-row');
const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');
const sendIcon = document.getElementById('send-icon');
const sendSpinner = document.getElementById('send-spinner');
const toggleInputButton = document.getElementById('toggle-input-button');
const leftEye = document.getElementById('left-eye');
const rightEye = document.getElementById('right-eye');
const leftPupil = document.getElementById('left-pupil');
const rightPupil = document.getElementById('right-pupil');
const robotFace = document.getElementById('robot-face');
const antennaBall = document.getElementById('antenna-ball');
const mouthShape = document.getElementById('mouth-shape');

let isGeneratingResponse = false;
let bubbleTimerId = null;
let isListeningSessionActive = false;
let blinkIntervalId = null;
let typingTimerId = null;

// 준비 가능 여부를 안테나 색으로만 표시한다.
function setReadinessState(isReady) {
  widget.setAttribute('data-ready', isReady ? 'ready' : 'not-ready');
}

// ══════════════════════════════════════════════
// 로봇 상태 관리 (바운스 트랜지션 포함)
// ══════════════════════════════════════════════
let currentState = 'idle';

function setRobotState(state) {
  if (currentState === state) return;

  currentState = state;
  widget.setAttribute('data-state', state);

  // 상태 전환 시 바운스 효과
  robotFace.classList.remove('bounce');
  void robotFace.offsetWidth; // reflow 트리거
  robotFace.classList.add('bounce');
}

// ══════════════════════════════════════════════
// 눈 깜빡임
// ══════════════════════════════════════════════
function blink() {
  const s = currentState;
  if (s === 'happy' || s === 'error' || s === 'sleeping') return;

  leftEye.classList.add('blink');
  rightEye.classList.add('blink');
  setTimeout(() => {
    leftEye.classList.remove('blink');
    rightEye.classList.remove('blink');
  }, 150);
}

function startBlinking() {
  if (blinkIntervalId) return;

  function scheduleNextBlink() {
    const delay = 2000 + Math.random() * 3000;
    blinkIntervalId = setTimeout(() => {
      blink();
      scheduleNextBlink();
    }, delay);
  }
  scheduleNextBlink();
}

// ══════════════════════════════════════════════
// 마우스 시선 추적 (전역 – IPC 기반)
// ══════════════════════════════════════════════
const MAX_PUPIL_OFFSET = 6;

function updatePupilPosition(mouseX, mouseY) {
  // 특수 상태에서는 CSS 애니메이션에 맡김
  if (currentState === 'thinking' || currentState === 'error' ||
      currentState === 'happy' || currentState === 'sleeping') {
    return;
  }

  [
    { eye: leftEye, pupil: leftPupil },
    { eye: rightEye, pupil: rightPupil }
  ].forEach(({ eye, pupil }) => {
    const rect = eye.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = mouseX - centerX;
    let dy = mouseY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
      // 거리가 멀어도 최대 오프셋까지만 이동
      const clampedDistance = Math.min(distance, 200);
      const ratio = clampedDistance / 200;
      dx = (dx / distance) * MAX_PUPIL_OFFSET * ratio;
      dy = (dy / distance) * MAX_PUPIL_OFFSET * ratio;
    }

    pupil.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  });
}

// 메인 프로세스에서 전역 커서 좌표를 받아서 눈동자 추적 (창 밖에서도 동작)
ipcRenderer.on('cursor-position', (_event, pos) => {
  updatePupilPosition(pos.x, pos.y);
});

// ══════════════════════════════════════════════
// 말풍선 타이핑 효과
// ══════════════════════════════════════════════
function showResponseBubble(text) {
  if (typingTimerId) {
    clearTimeout(typingTimerId);
    typingTimerId = null;
  }
  if (bubbleTimerId) {
    clearTimeout(bubbleTimerId);
    bubbleTimerId = null;
  }

  speechBubble.innerHTML = '<span class="typing-cursor"></span>';
  speechBubble.style.display = 'block';

  requestAnimationFrame(() => {
    speechBubble.classList.add('visible');
  });

  let charIndex = 0;
  const chars = [...text]; // 한글 안전 분리

  function typeNext() {
    if (charIndex < chars.length) {
      const cursor = speechBubble.querySelector('.typing-cursor');
      if (cursor) {
        cursor.insertAdjacentText('beforebegin', chars[charIndex]);
      } else {
        speechBubble.textContent += chars[charIndex];
      }
      charIndex++;
      typingTimerId = setTimeout(typeNext, 35 + Math.random() * 25);
    } else {
      // 타이핑 완료 → 커서 제거
      const cursor = speechBubble.querySelector('.typing-cursor');
      if (cursor) cursor.remove();
      typingTimerId = null;

      bubbleTimerId = setTimeout(() => {
        speechBubble.classList.remove('visible');
        setTimeout(() => {
          speechBubble.style.display = 'none';
          speechBubble.innerHTML = '';
        }, 400);
        bubbleTimerId = null;
      }, 5000);
    }
  }

  typingTimerId = setTimeout(typeNext, 200);
}

// ══════════════════════════════════════════════
// 전송 버튼 로딩 스피너
// ══════════════════════════════════════════════
function setSendButtonLoading(isLoading) {
  if (isLoading) {
    sendIcon.classList.add('hidden');
    sendSpinner.classList.remove('hidden');
  } else {
    sendIcon.classList.remove('hidden');
    sendSpinner.classList.add('hidden');
  }
}

function setGeneratingState(isGenerating) {
  isGeneratingResponse = isGenerating;
  textInput.disabled = isGenerating;
  sendButton.disabled = isGenerating;
  setSendButtonLoading(isGenerating);
}

// ══════════════════════════════════════════════
// 볼륨 반응 (듣는 중)
// ══════════════════════════════════════════════
function handleVolumeChange(rms) {
  if (currentState !== 'listening') return;

  const normalized = Math.min(rms / 0.15, 1);

  // 입 크기 – 볼륨에 따라 scaleY
  const mouthScale = 0.5 + normalized * 0.8;
  mouthShape.style.transform = `scaleY(${mouthScale.toFixed(2)})`;

  // 안테나 볼 – 볼륨에 따라 크기
  const ballScale = 1 + normalized * 0.5;
  antennaBall.style.transform = `scale(${ballScale.toFixed(2)})`;
}

function resetVolumeEffects() {
  mouthShape.style.transform = '';
  antennaBall.style.transform = '';
}

// ══════════════════════════════════════════════
// 상태 전환 헬퍼
// ══════════════════════════════════════════════
function setListeningSessionActive(isActive) {
  isListeningSessionActive = isActive;

  if (isActive) {
    setRobotState('listening');
    statusText.innerText = '';
    statusText.style.color = 'transparent';
    return;
  }

  resetVolumeEffects();

  if (isGeneratingResponse) {
    return;
  }

  setRobotState('idle');
  setReadinessState(false);
  statusText.innerText = '';
  statusText.style.color = 'transparent';
}

async function requestAiResponse(userText) {
  const trimmedText = userText.trim();

  if (trimmedText.length === 0 || isGeneratingResponse) {
    return;
  }

  setGeneratingState(true);
  setRobotState('thinking');
  statusText.innerText = '';
  statusText.style.color = 'transparent';

  try {
    const response = await ipcRenderer.invoke('generate-ai-response', trimmedText);

    if (!response?.ok) {
      throw new Error(response?.error || 'AI 응답 생성에 실패했습니다.');
    }

    showResponseBubble(response.reply);
    setRobotState('happy');
    statusText.innerText = '';
    statusText.style.color = 'transparent';

    setTimeout(() => {
      if (currentState === 'happy') {
        setRobotState('idle');
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    }, 3500);
  } catch (error) {
    console.error('❌ 렌더러 AI 요청 실패:', error);
    showResponseBubble('으앙... 오류가 났어요 😢');
    setRobotState('error');
    statusText.innerText = '';
    statusText.style.color = 'transparent';

    setTimeout(() => {
      if (currentState === 'error') {
        setRobotState('idle');
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    }, 3000);
  } finally {
    setGeneratingState(false);
  }
}

// ══════════════════════════════════════════════
// 음성 인식기 (볼륨 콜백 포함)
// ══════════════════════════════════════════════
const speech = new SpeechHandler(
  async (text, isFinal) => {
    const trimmedText = text.trim();
    if (!isFinal) return;
    await requestAiResponse(trimmedText);
  },
  (isRecording) => {
    setListeningSessionActive(isRecording);
  },
  (rms) => {
    handleVolumeChange(rms);
  }
);

// ══════════════════════════════════════════════
// 얼굴 추적기
// ══════════════════════════════════════════════
const tracker = new FaceTracker(video);

// ══════════════════════════════════════════════
// 입력 UI 이벤트
// ══════════════════════════════════════════════
function toggleTextInput() {
  const isHidden = inputRow.classList.toggle('hidden');

  if (!isHidden) {
    textInput.focus();
    return;
  }

  textInput.value = '';
}

toggleInputButton.addEventListener('click', () => {
  toggleTextInput();
});

sendButton.addEventListener('click', async () => {
  await requestAiResponse(textInput.value);
  textInput.value = '';
});

textInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  await requestAiResponse(textInput.value);
  textInput.value = '';
});

// ══════════════════════════════════════════════
// 메인 루프
// ══════════════════════════════════════════════
function loop() {
  const result = tracker.checkGaze();

  if (result) {
    if (isListeningSessionActive || speech.isRecording) {
      // 듣는 중 상태는 setListeningSessionActive에서 관리
    } else if (result.msg === "얼굴 없음") {
      if (currentState !== 'thinking' &&
          currentState !== 'happy' &&
          currentState !== 'error') {
        setRobotState('sleeping');
        setReadinessState(false);
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    } else if (result.gazeActive && result.handRaised) {
      if (!isListeningSessionActive && !speech.isRecording && !speech.isStarting) {
        speech.start();
      }
    } else if (result.gazeActive) {
      if (!isListeningSessionActive && !speech.isRecording && !isGeneratingResponse) {
        setRobotState('idle');
        setReadinessState(true);
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    } else {
      if (!isListeningSessionActive && !speech.isRecording && !isGeneratingResponse) {
        setRobotState('idle');
        setReadinessState(false);
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }
    }
  }
  requestAnimationFrame(loop);
}

// ══════════════════════════════════════════════
// 앱 시작
// ══════════════════════════════════════════════
async function startApp() {
  try {
    console.log("🚀 앱 시작 시퀀스 가동...");
    setRobotState('thinking');
    setReadinessState(false);
    statusText.innerText = '';
    statusText.style.color = 'transparent';

    await tracker.init();
    console.log("✅ AI 모델 준비 완료");

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }
    });
    video.srcObject = stream;

    video.onloadedmetadata = () => {
      video.play();
      console.log("🎥 카메라 재생 시작");

      setRobotState('happy');
      statusText.innerText = '';
      statusText.style.color = 'transparent';

      setTimeout(() => {
        setRobotState('idle');
        setReadinessState(false);
        statusText.innerText = '';
        statusText.style.color = 'transparent';
      }, 2500);

      startBlinking();
      loop();
    };

  } catch (err) {
    setRobotState('error');
    setReadinessState(false);
    statusText.innerText = '';
    statusText.style.color = 'transparent';
    console.error("❌ 앱 시작 중 치명적 오류:", err);
  }
}

setReadinessState(false);
startApp();
