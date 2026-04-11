export class AiClient {
    // AI에게 질문을 보내고 응답을 받아오는 역할만 전담합니다.
    static async request(payload, personality) {
        try {
            const response = await window.lookTalkAPI.processAiRequest({
                ...payload,
                personality: personality
            });
            return response; // { ok: true/false, reply: '...', error: '...' }
        } catch (error) {
            console.error("IPC 통신 에러:", error);
            return { ok: false, error: '네트워크 통신에 실패했습니다.' };
        }
    }
}