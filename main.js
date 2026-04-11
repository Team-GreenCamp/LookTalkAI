const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// 환경 변수 로드
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of envLines) {
    const [key, ...val] = line.split('=');
    if (key && val) process.env[key.trim()] = val.join('=').trim();
  }
}

let win;
const configPath = path.join(app.getPath('userData'), 'window-bounds.json');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';

// 마이크 및 최적화 설정
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WindowOcclusionPrediction');

// Gemini 응답 생성 통합 함수
async function generateGeminiResponse(contentPayload, personality = 'calm', responseLength = 'short') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 없습니다.');

  const personalityPrompts = {
    calm: '차분하고 안정적인 말투로 답해라.',
    bright: '발랄하고 친근한 말투로 답해라.',
    tsundere: '조금 시크하지만 밉지 않은 말투로 답해라.',
    assistant: '정돈된 프로 비서 톤으로 답해라.'
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: `너는 한국어로 답하는 데스크톱 비서다. ${personalityPrompts[personality]} 아주 짧게 한두 문장으로만 답해라.` }]
      },
      contents: [{ role: 'user', parts: contentPayload }]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '응답을 생성할 수 없습니다.';
}

ipcMain.handle('process-ai-request', async (_event, { type, data, mimeType, personality }) => {
  try {
    let parts = [];
    if (type === 'text') {
      parts.push({ text: data });
    } else if (type === 'audio') {
      parts.push({ inlineData: { mimeType: mimeType || 'audio/webm', data: data } });
      parts.push({ text: "이 음성을 듣고 적절하게 대답해줘." });
    }
    const reply = await generateGeminiResponse(parts, personality);
    return { ok: true, reply };
  } catch (error) {
    return { ok: false, error: error.message };
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
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile('src/index.html');

  // 드래그 이동을 위한 로직 추가
  ipcMain.on('window-drag', (event, { mouseX, mouseY }) => {
    const { x, y } = screen.getCursorScreenPoint();
    win.setPosition(x - mouseX, y - mouseY);
  });


  // 윈도우 위치 저장 (듀얼 모니터 대응)
  const saveWindowPosition = () => {
    const bounds = win.getBounds();
    fs.writeFileSync(configPath, JSON.stringify(bounds));
  };
  win.on('moved', saveWindowPosition);
  win.on('close', saveWindowPosition);

  setInterval(() => {
    if (win && !win.isDestroyed()) {
      const cursor = screen.getCursorScreenPoint();
      const bounds = win.getBounds();
      win.webContents.send('cursor-position', { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
    }
  }, 33);
}

// 윈도우에서 가상 데스크톱 이동 시 창이 사라지는 현상 방지
app.commandLine.appendSwitch('disable-features', 'WindowOcclusionPrediction');

app.whenReady().then(createWindow);