const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { generateGeminiResponse } = require('./geminiService'); // 분리한 모듈 불러오기

// 환경 변수 로드
const envPath = path.join(__dirname, '../../.env'); // 경로 수정 (main.js 위치 기준)
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of envLines) {
    const [key, ...val] = line.split('=');
    if (key && val) process.env[key.trim()] = val.join('=').trim();
  }
}

let win;
const configPath = path.join(app.getPath('userData'), 'window-bounds.json');

// 마이크 및 최적화 설정
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WindowOcclusionPrediction');

// ── Gemini 멀티모달 통합 핸들러 ──
ipcMain.handle('process-ai-request', async (_event, payload) => {
  try {
    const parts = [];

    // 1. 첨부된 사진이 있으면 추가
    if (payload.attachedImage) {
      parts.push({ inlineData: { mimeType: payload.attachedImage.mimeType, data: payload.attachedImage.imageBase64 } });
      parts.push({ text: "이 이미지는 사용자가 첨부한 사진이야." });
    }

    // 2. 화면 캡처가 켜져있었다면 추가
    if (payload.screenContext) {
      parts.push({ inlineData: { mimeType: payload.screenContext.mimeType, data: payload.screenContext.imageBase64 } });
      parts.push({ text: "이 이미지는 현재 내 컴퓨터 화면이야. 참고해서 대답해줘." });
      console.log('[LLM][SCREEN_CONTEXT]', {
        mimeType: payload.screenContext.mimeType,
        imageBase64Length: payload.screenContext.imageBase64.length
      });
    }

    // 3. 음성 질문이 들어왔다면 추가 (STT 없이 오디오 자체를 전달)
    if (payload.audioBase64) {
      parts.push({ inlineData: { mimeType: payload.audioMime, data: payload.audioBase64 } });
      parts.push({ text: "이 음성을 듣고 내 질문에 대답해줘." });
    }

    // 4. 텍스트 질문이 있다면 추가
    if (payload.userText && payload.userText.trim() !== '') {
      parts.push({ text: payload.userText });
    }

    // 아무것도 안 보냈다면 에러 방지
    if (parts.length === 0) {
      return { ok: false, error: '전달된 내용이 없습니다.' };
    }

    // geminiService.js에서 최근 대화 맥락과 현재 입력을 함께 Vertex AI로 보낸다.
    const reply = await generateGeminiResponse(parts, payload.personality, {
      responseLength: payload.responseLength,
      conversationContext: payload.conversationContext
    });
    return { ok: true, reply };

  } catch (error) {
    console.error('❌ AI 응답 생성 실패:', error);
    return { ok: false, error: error.message };
  }
});

// ── 화면 캡처 IPC 핸들러 (보안 통로) ──
ipcMain.handle('capture-screen', async () => {
  try {
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);

    // 메인 프로세스에서 안전하게 화면을 캡처합니다.
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    });

    const source = sources.find((item) => item.display_id === String(activeDisplay.id)) || sources[0];

    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('화면 캡처 이미지를 가져오지 못했습니다. macOS 화면 기록 권한을 확인해 주세요.');
    }

    // 이미지를 Base64 문자열로 변환해서 프론트엔드로 보내줍니다.
    const imageBase64 = source.thumbnail.toPNG().toString('base64');
    console.log('[SCREEN][CAPTURE]', {
      displayId: source.display_id,
      imageBase64Length: imageBase64.length
    });

    return imageBase64;
  } catch (error) {
    console.error('화면 캡처 에러:', error);
    return null;
  }
});

function createWindow() {
  let savedBounds = {};
  if (fs.existsSync(configPath)) {
    try { savedBounds = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { }
  }

  win = new BrowserWindow({
    width: 220, height: 350,
    x: savedBounds.x, y: savedBounds.y,
    transparent: true, frame: false, alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,    // [보안강화] 직접 Node.js 사용 금지
      contextIsolation: true,    // [보안강화] 메인과 렌더러 환경 완전 분리
      preload: path.join(__dirname, 'preload.js') // [보안강화] 우리가 만든 다리 연결
    }
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'screen-saver');

  // HTML 로드 경로 수정 (renderer 폴더 바라보게)
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  ipcMain.on('window-drag', (event, { mouseX, mouseY }) => {
    const { x, y } = screen.getCursorScreenPoint();
    win.setPosition(x - mouseX, y - mouseY);
  });

  ipcMain.on('resize-window', (event, { width, height }) => {
    if (win && !win.isDestroyed()) {
      win.setSize(width, height, false);
    }
  });

  ipcMain.on('close-app', () => {
    app.quit();
  });

  const saveWindowPosition = () => {
    const bounds = win.getBounds();
    fs.writeFileSync(configPath, JSON.stringify(bounds));
  };
  win.on('moved', saveWindowPosition);
  win.on('close', saveWindowPosition);

  // 마우스 위치를 추적해서 프론트엔드로 쏴주는 로직
  setInterval(() => {
    if (win && !win.isDestroyed()) {
      const cursor = screen.getCursorScreenPoint();
      const bounds = win.getBounds();
      // 창 기준 상대 좌표로 계산해서 보냄
      win.webContents.send('mouse-move-external', {
        x: cursor.x - bounds.x,
        y: cursor.y - bounds.y
      });
    }
  }, 50);
}

app.whenReady().then(createWindow);
