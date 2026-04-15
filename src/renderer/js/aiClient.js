export class AiClient {
    // 백엔드와의 통신을 전담하는 모듈입니다.
    static async request(payload) {
        try {
            // preload.js를 통해 메인 프로세스로 요청을 보냅니다.
            const response = await window.lookTalkAPI.processAiRequest(payload);
            return response; // { ok: true/false, reply: '...', error: '...' }
        } catch (error) {
            console.error("IPC 통신 에러:", error);
            return { ok: false, error: '네트워크 통신에 실패했습니다.' };
        }
    }
}