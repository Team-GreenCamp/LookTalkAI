import { ThemeManager } from './themeManager.js';
import { UIController } from './uiController.js';
import { HistoryManager } from './historyManager.js';
import { FaceTracker } from './faceTracker.js';
import { SpeechHandler } from './speechHandler.js';
import { ROBOT_STATE } from './constants.js'; // 상수 임포트 추가
import { AiClient } from './aiClient.js';
import { TtsService } from './ttsService.js';

const ui = new UIController();
const theme = new ThemeManager();
const history = new HistoryManager();
const video = document.getElementById('webcam');
const statusText = document.getElementById('status-text');
const robotFace = document.getElementById('robot-face');
const settingsPanel = document.getElementById('settings-panel');
const historyDrawer = document.getElementById('history-drawer');
const toggleHistoryButton = document.getElementById('toggle-history-button');
const widget = document.getElementById('widget');
const textInput = document.getElementById('text-input');

let isGeneratingResponse = false;
let isAppReady = false;
let isSpeechTriggerLocked = false;
let appSettings = theme.loadSettings();
let cameraStream = null;

// ── 드래그 이동 및 설정 패널 클릭 감지 ──
let isDragging = false;
let dragStartX, dragStartY;
let hasMoved = false;

// ── 화면 캡처 기능 제어용 변수 ──
let isScreenContextArmed = false; // 화면 인식 모드가 켜져있는지 확인

document.querySelectorAll('.drag-handle').forEach(handle => {
  handle.addEventListener('mousedown', (e) => {
    // 버튼이나 입력창 클릭 시에는 드래그 무시
    if (e.target.closest('button') || e.target.closest('input')) return;

    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  });
});

window.addEventListener('mousemove', (e) => {
  if (isDragging) {
    hasMoved = true;
    window.lookTalkAPI.dragWindow({ mouseX: dragStartX, mouseY: dragStartY });
  }
});

window.addEventListener('mouseup', (e) => {
  isDragging = false;
});

// ── 우클릭 종료 패널 (캐릭터 우클릭 시) ──
robotFace.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const confirmClose = confirm("LookTalk AI를 종료할까요?");
  if (confirmClose) {
    window.lookTalkAPI.closeApp();
  }
});

// ── UI 토글 시 크기 업데이트 호출 ──
robotFace.addEventListener('click', () => {
  if (!hasMoved) {
    settingsPanel.classList.toggle('hidden');
    historyDrawer.classList.add('hidden');
    updateSettingsUI();
    updateWindowSize(); // 크기 조절
  }
});

// ── 대화 기록(히스토리) 패널 열기 ──
toggleHistoryButton.addEventListener('click', () => {
  const isHidden = historyDrawer.classList.toggle('hidden');
  settingsPanel.classList.add('hidden'); // 설정창은 닫음

  if (!isHidden) history.render();
  updateWindowSize(); // 크기 조절
});

document.getElementById('clear-history-button').addEventListener('click', () => {
  history.clear();
});

// ── 입력 모드 및 버튼 텍스트 복구 ──
function setInputMode(show) {
  const inputRow = document.getElementById('input-row');
  const toggleBtn = document.getElementById('toggle-input-button');

  if (show) {
    if (speech.isRecording) {
      speech.stop();
    }
    inputRow.classList.remove('hidden');
    setTimeout(() => textInput.focus(), 10);
  } else {
    inputRow.classList.add('hidden');
    // 아이콘을 덮어씌우던 텍스트 변경 로직 제거
    toggleBtn.style.backgroundColor = ''; // 빨간색 해제 (필요시 유지)
    textInput.blur();
  }
  updateWindowSize();
}

// ── 음성 핸들러 설정 ──
const speech = new SpeechHandler(
  async (audioBase64, mimeType) => {
    await requestAiResponse('', { base64: audioBase64, mimeType: mimeType });
  },
  (isRecording) => {
    // 에러나던 setListeningSessionActive 대신 uiController 활용
    if (isRecording) {
      ui.setRobotState(ROBOT_STATE.LISTENING);
      ui.setReadiness(false);
      statusText.innerText = '듣는 중...';
      statusText.style.color = '#4ade80';
    } else {
      ui.handleVolumeEffect(0, false);
      if (!isGeneratingResponse) {
        ui.setRobotState(ROBOT_STATE.IDLE);
        ui.setReadiness(appSettings.voiceTriggerEnabled);
        statusText.innerText = '준비 완료';
        statusText.style.color = '#60a5fa';
      }
    }
  },
  (rms) => {
    ui.handleVolumeEffect(rms, speech.isRecording);
  }
);

// ── 통합 AI 요청 함수 ──
// 인자로 audioData를 추가로 받을 수 있게 합니다.
async function requestAiResponse(userText = '', audioData = null) {
  const trimmedText = userText.trim();

  // 텍스트, 오디오, 첨부 파일 중 아무것도 없으면 취소
  if ((!trimmedText && !audioData && !attachedImageData) || isGeneratingResponse) {
    return;
  }

  if (trimmedText) history.addMessage('user', trimmedText, appSettings.historyPersistenceEnabled);
  else history.addMessage('user', '🎤 (음성/파일/화면 질문)', appSettings.historyPersistenceEnabled);

  isSpeechTriggerLocked = true;
  isGeneratingResponse = true;

  // UI 로딩 상태 처리
  const sendBtn = document.getElementById('send-button');
  const spinner = document.getElementById('send-spinner');
  const icon = document.getElementById('send-icon');

  textInput.disabled = true;
  sendBtn.disabled = true;
  spinner.classList.remove('hidden');
  icon.classList.add('hidden');

  ui.setRobotState(ROBOT_STATE.THINKING);
  ui.setReadiness(false);
  statusText.innerText = 'AI 생각 중...';
  statusText.style.color = '#facc15';

  try {
    const currentPersonality = localStorage.getItem('looktalk.personality') || 'calm';
    const payload = {
      userText: trimmedText,
      personality: currentPersonality,
      responseLength: appSettings.responseLength,
      conversationContext: history.getRecentContext(),
      screenContext: await captureCurrentScreenContext(),
      attachedImage: attachedImageData,
      audioBase64: audioData ? audioData.base64 : null,
      audioMime: audioData ? audioData.mimeType : null
    };

    // 통로를 통해 전송
    const response = await AiClient.request(payload);

    if (!response?.ok) throw new Error(response?.error);

    // 💡 [TTS 적용] 설정에서 TTS가 켜져 있다면 읽어주기
    // (appSettings.ttsEnabled 가 없으면 기본값 true로 설정하거나 무조건 읽게 할 수 있습니다)
    if (appSettings.ttsEnabled !== false) {
      // 텍스트 타이핑 애니메이션보다 먼저 TTS 생성을 요청해 재생 지연을 줄인다.
      void TtsService.speak(response.reply, currentPersonality);
    }

    ui.showBubble(response.reply, appSettings.bubbleDurationMs);
    history.addMessage('assistant', response.reply, appSettings.historyPersistenceEnabled);
    ui.setRobotState(ROBOT_STATE.HAPPY);
    ui.setReadiness(false);

  } catch (error) {
    console.error('❌ AI 요청 실패:', error);
    ui.showBubble('으앙... 오류가 났어요 😢', 3000);
    ui.setRobotState(ROBOT_STATE.ERROR);
    ui.setReadiness(false);
  } finally {
    // 전송 후 데이터 초기화
    attachedImageData = null;
    if (attachButton) attachButton.classList.remove('active');

    isScreenContextArmed = false;
    if (screenButton) screenButton.classList.remove('active');

    isGeneratingResponse = false;
    isSpeechTriggerLocked = false;

    textInput.disabled = false;
    sendBtn.disabled = false;
    spinner.classList.add('hidden');
    icon.classList.remove('hidden');
    textInput.focus();

    setTimeout(() => {
      ui.setReadiness(appSettings.voiceTriggerEnabled);
      if (appSettings.voiceTriggerEnabled) {
        statusText.innerText = '준비 완료';
        statusText.style.color = '#60a5fa';
      } else {
        statusText.innerText = '음성 트리거 꺼짐';
        statusText.style.color = '#f87171';
      }
    }, 3000);
  }
}

// ── 버튼 이벤트 리스너 연결 ──
document.getElementById('toggle-input-button').addEventListener('click', () => {
  if (speech.isRecording) {
    speech.stop();
    return;
  }
  setInputMode(document.getElementById('input-row').classList.contains('hidden'));
});

document.getElementById('send-button').addEventListener('click', () => {
  requestAiResponse(textInput.value);
  textInput.value = '';
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('send-button').click();
  }
});

// 현재 선택된 설정 시각화 업데이트
function updateSettingsUI() {
  // 기존 선택 해제
  document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));

  const curPalette = localStorage.getItem('looktalk.palette') || 'mint';
  const curPersonality = localStorage.getItem('looktalk.personality') || 'calm';

  document.querySelector(`.palette-option[data-palette="${curPalette}"]`)?.classList.add('selected');
  document.querySelector(`.personality-option[data-personality="${curPersonality}"]`)?.classList.add('selected');

  Object.keys(appSettings).forEach(key => {
    document.querySelector(`.setting-pill[data-setting-key="${key}"][data-setting-value="${appSettings[key]}"]`)?.classList.add('selected');
  });
}

// ── 창 크기 자동 조절 최적화 ──
function updateWindowSize() {
  const isSettingsOpen = !settingsPanel.classList.contains('hidden');
  const isHistoryOpen = !historyDrawer.classList.contains('hidden');
  const isInputOpen = !document.getElementById('input-row').classList.contains('hidden');

  let targetWidth = 240;
  // 상단 패딩이 135px로 늘어났으므로 계산에 추가 반영 (15px 여유 포함 총 150px)
  let targetHeight = Math.max(400, widget.offsetHeight + 150);

  if (isHistoryOpen) {
    targetWidth = 500;
    targetHeight = Math.max(targetHeight, 470);
  } else if (isSettingsOpen) {
    targetWidth = 400;
    targetHeight = Math.max(targetHeight, 560);
  }

  window.lookTalkAPI.resizeWindow({ width: targetWidth, height: targetHeight });
}

async function startCameraStream() {
  if (cameraStream) {
    return;
  }

  // 음성 트리거가 켜졌을 때만 손 들기 인식을 위해 카메라를 연다.
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = cameraStream;
  await video.play();
}

function stopCameraStream() {
  if (!cameraStream) {
    return;
  }

  cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.pause();
  video.srcObject = null;
}

async function applyVoiceTriggerCameraState() {
  if (appSettings.voiceTriggerEnabled) {
    await startCameraStream();
    ui.setReadiness(true);
    return;
  }

  if (speech.isRecording) {
    speech.stop();
  }
  stopCameraStream();
  ui.setRobotState(ROBOT_STATE.IDLE);
  ui.setReadiness(false);
  statusText.innerText = '음성 트리거 꺼짐';
  statusText.style.color = '#f87171';
}

// ── 설정 변경 이벤트 연결 ──
function setupSettings() {
  document.querySelectorAll('.palette-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      theme.applyPalette(e.target.dataset.palette);
      updateSettingsUI();
    });
  });

  document.querySelectorAll('.personality-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      localStorage.setItem('looktalk.personality', e.target.dataset.personality);
      updateSettingsUI();
    });
  });

  // 누락되었던 세부 설정(시간, 음성, 기록) 클릭 이벤트 연동
  document.querySelectorAll('.setting-pill').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const key = e.target.dataset.settingKey;
      let value = e.target.dataset.settingValue;

      // 문자열을 데이터 타입에 맞게 변환
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(value)) value = Number(value);

      theme.saveSettings({ [key]: value });
      appSettings = theme.loadSettings(); // 동기화
      if (key === 'voiceTriggerEnabled') {
        await applyVoiceTriggerCameraState();
      }
      updateSettingsUI();
    });
  });
}

// ── 마우스 눈동자 추적 리스너 ──
if (window.lookTalkAPI.onMouseMoveExternal) {
  window.lookTalkAPI.onMouseMoveExternal((coords) => {
    ui.updateEyeGaze(coords.x, coords.y);
  });
}

// ── 파일 첨부 로직 ──
let attachedImageData = null;
const attachButton = document.getElementById('attach-button');
const imageInput = document.getElementById('file-input');
const screenButton = document.getElementById('screen-context-button');
const textFileExtensions = new Set(['txt', 'md', 'json', 'csv', 'tsv', 'js', 'ts', 'html', 'css', 'xml', 'log']);

function isTextFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return file.type.startsWith('text/') || textFileExtensions.has(extension);
}

function isPdfFile(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

if (attachButton && imageInput) {
  attachButton.addEventListener('click', () => imageInput.click());

  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (file.type.startsWith('image/')) {
        attachedImageData = {
          kind: 'image',
          name: file.name,
          mimeType: file.type,
          imageBase64: event.target.result.split(',')[1]
        };
      } else if (isPdfFile(file)) {
        attachedImageData = {
          kind: 'pdf',
          name: file.name,
          mimeType: 'application/pdf',
          fileBase64: event.target.result.split(',')[1]
        };
      } else {
        attachedImageData = {
          kind: 'text',
          name: file.name,
          mimeType: file.type || 'text/plain',
          text: String(event.target.result).slice(0, 20000)
        };
      }
      attachButton.classList.add('active');
      imageInput.value = '';
    };

    if (file.type.startsWith('image/') || isPdfFile(file)) {
      reader.readAsDataURL(file);
    } else if (isTextFile(file)) {
      reader.readAsText(file);
    } else {
      attachedImageData = null;
      imageInput.value = '';
      attachButton.classList.remove('active');
      ui.showBubble('아직 이 파일 형식은 읽을 수 없어요. PDF, 이미지, txt, md, json, csv 같은 파일을 첨부해 주세요.', 3500);
    }
  });
}

if (screenButton) {
  screenButton.addEventListener('click', () => {
    isScreenContextArmed = !isScreenContextArmed;
    // 💡 시각적 피드백: 활성화 여부에 따라 클래스 토글
    screenButton.classList.toggle('active', isScreenContextArmed);
  });
}

// ── 안전한 화면 캡처 함수 ──
async function captureCurrentScreenContext() {
  if (!isScreenContextArmed) return null; // 버튼이 안 눌려있으면 캡처 안 함

  try {
    // 💡 preload.js에 뚫어둔 통로를 통해 메인 프로세스에게 캡처 이미지(Base64)를 부탁합니다.
    const imageBase64 = await window.lookTalkAPI.captureScreen();

    if (!imageBase64) return null;

    // AI에게 보낼 수 있는 형태로 포맷팅해서 리턴합니다.
    return {
      mimeType: 'image/png',
      imageBase64: imageBase64
    };
  } catch (error) {
    console.warn('⚠️ 화면 캡처 실패, 텍스트 질문만 전송합니다:', error);
    return null;
  }
}

// ── 메인 루프 및 초기화 ──
const tracker = new FaceTracker(video);
async function startApp() {
  try {
    await tracker.init();
    history.load(appSettings.historyPersistenceEnabled);
    theme.applyPalette(localStorage.getItem('looktalk.palette') || 'mint');
    setupSettings();
    await applyVoiceTriggerCameraState();

    isAppReady = true;
    if (appSettings.voiceTriggerEnabled) {
      ui.setReadiness(true);
      statusText.innerText = '준비 완료';
      statusText.style.color = '#60a5fa';
    } else {
      ui.setReadiness(false);
    }
    ui.setRobotState(ROBOT_STATE.IDLE); // 초기 상태 설정

    loop();
  } catch (err) {
    statusText.innerText = '카메라 에러';
    statusText.style.color = '#f87171';
  }
}

function loop() {
  if (!isAppReady) {
    requestAnimationFrame(loop);
    return;
  }
  if (!appSettings.voiceTriggerEnabled) {
    requestAnimationFrame(loop);
    return;
  }
  const result = tracker.checkGaze();
  if (appSettings.voiceTriggerEnabled && result && result.handRaised) {
    if (!speech.isRecording && !isGeneratingResponse && !isSpeechTriggerLocked) {
      setInputMode(false);
      speech.start();
    }
  }
  requestAnimationFrame(loop);
}

startApp();
