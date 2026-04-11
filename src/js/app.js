import { ThemeManager } from './themeManager.js';
import { UIController } from './uiController.js';
import { HistoryManager } from './historyManager.js';
import { FaceTracker } from './faceTracker.js';
import { SpeechHandler } from './speechHandler.js';
const { ipcRenderer } = require('electron');

const ui = new UIController();
const theme = new ThemeManager();
const history = new HistoryManager();
const video = document.getElementById('webcam');

let isAborted = false;
let isGeneratingResponse = false;
let appSettings = theme.loadSettings();

// ── 입력 모드 통합 관리 ──
function setInputMode(show) {
  const inputRow = document.getElementById('input-row');
  const toggleBtn = document.getElementById('toggle-input-button');

  if (show) {
    if (speech.isRecording) {
      isAborted = true; // 중단 플래그 활성화
      speech.stop();
    }
    inputRow.classList.remove('hidden');
    toggleBtn.innerText = '닫기';
    setTimeout(() => document.getElementById('text-input').focus(), 10);
  } else {
    inputRow.classList.add('hidden');
    toggleBtn.innerText = '입력';
  }
}

// ── 음성 핸들러 설정 ──
const speech = new SpeechHandler(
  (base64, mime) => {
    if (isAborted) {
      isAborted = false;
      return; // 중단 시 전송 방지
    }
    requestAi({ type: 'audio', data: base64, mimeType: mime });
  },
  (isRecording) => {
    document.getElementById('widget').classList.toggle('recording', isRecording);
    if (isRecording) {
      ui.setRobotState('listening');
      document.getElementById('toggle-input-button').innerText = '중단';
    } else {
      if (!isGeneratingResponse) ui.setRobotState('idle');
    }
  },
  (rms) => ui.handleVolumeEffect(rms, speech.isRecording)
);

// ── AI 요청 함수 ──
async function requestAi(payload) {
  if (isGeneratingResponse) return;
  isGeneratingResponse = true;
  ui.setRobotState('thinking');

  if (payload.type === 'text') history.addMessage('user', payload.data, appSettings.historyPersistenceEnabled);

  try {
    const response = await ipcRenderer.invoke('process-ai-request', {
      ...payload,
      personality: localStorage.getItem('looktalk.personality') || 'calm'
    });

    if (response.ok) {
      ui.setRobotState('happy');
      ui.showBubble(response.reply, appSettings.bubbleDurationMs);
      history.addMessage('assistant', response.reply, appSettings.historyPersistenceEnabled);
    }
  } catch (e) {
    ui.setRobotState('error');
  } finally {
    isGeneratingResponse = false;
  }
}

// ── 메인 루프 및 초기화 ──
const tracker = new FaceTracker(video);
async function startApp() {
  await tracker.init();
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  video.onloadedmetadata = () => {
    video.play();
    history.load(appSettings.historyPersistenceEnabled);
    theme.applyPalette(localStorage.getItem('looktalk.palette') || 'mint');
    loop();
  };
}

function loop() {
  const result = tracker.checkGaze();
  if (result && result.handRaised && !speech.isRecording && !isGeneratingResponse) {
    setInputMode(false);
    speech.start(); // 손 들기 감지 시 마이크 시작
  }
  requestAnimationFrame(loop);
}

document.getElementById('toggle-input-button').addEventListener('click', () => {
  if (speech.isRecording) {
    isAborted = true;
    speech.stop();
    return;
  }
  setInputMode(document.getElementById('input-row').classList.contains('hidden'));
});

startApp();