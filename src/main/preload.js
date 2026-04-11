const { contextBridge, ipcRenderer } = require('electron');

// 웹 화면(Renderer)에서 window.lookTalkAPI 라는 이름으로 쓸 수 있게 허락해줍니다.
contextBridge.exposeInMainWorld('lookTalkAPI', {
    // 1. 창 드래그
    dragWindow: (coords) => ipcRenderer.send('window-drag', coords),
    // 2. 창 크기 조절
    resizeWindow: (size) => ipcRenderer.send('resize-window', size),
    // 3. 앱 종료
    closeApp: () => ipcRenderer.send('close-app'),
    // 4. AI 응답 요청 (비동기)
    processAiRequest: (payload) => ipcRenderer.invoke('process-ai-request', payload)
});