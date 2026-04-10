const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 마이크 및 최적화 설정 유지
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,WindowOcclusionPrediction');

let win;
const configPath = path.join(app.getPath('userData'), 'window-bounds.json');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview'; // 음성 인식을 위해 1.5 버전 권장

async function generateGeminiResponse(contentPayload) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 없습니다.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: '너는 짧고 자연스러운 한국어로 답하는 데스크톱 비서다. 한두 문장 이내로 간결하게 답해라.' }]
      },
      contents: [{ role: 'user', parts: contentPayload }]
    })
  });

  const data = await response.json();

  // 에러 핸들링 강화
  if (data.error) {
    console.error('Gemini API Error Details:', data.error);
    return `API 에러: ${data.error.message}`;
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text || '응답을 생성할 수 없습니다.';
}

ipcMain.handle('process-ai-request', async (_event, { type, data, mimeType }) => {
  try {
    let parts = [];
    if (type === 'text') {
      parts.push({ text: data });
    } else if (type === 'audio') {
      // Gemini 멀티모달 입력: 오디오 데이터를 직접 전달
      parts.push({
        inlineData: {
          mimeType: mimeType || 'audio/webm',
          data: data // base64 string
        }
      });
      parts.push({ text: "이 음성을 듣고 한국어로 자연스럽게 대답해줘." });
    }

    const reply = await generateGeminiResponse(parts);
    return { ok: true, reply };
  } catch (error) {
    console.error('Gemini Error:', error);
    return { ok: false, error: error.message };
  }
});

function createWindow() {
  let savedBounds = {};
  try {
    if (fs.existsSync(configPath)) {
      savedBounds = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('위치 정보 로드 실패');
  }

  win = new BrowserWindow({
    width: 240,
    height: 300,
    x: savedBounds.x,
    y: savedBounds.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 가상 데스크톱 이동 시에도 유지 설정
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'screen-saver');


  win.loadFile('src/index.html');

  // 윈도우 위치 저장 (듀얼 모니터 대응)
  const saveWindowPosition = () => {
    const bounds = win.getBounds();
    fs.writeFileSync(configPath, JSON.stringify(bounds));
  };

  win.on('moved', saveWindowPosition);
  win.on('close', saveWindowPosition);
}

app.whenReady().then(createWindow);