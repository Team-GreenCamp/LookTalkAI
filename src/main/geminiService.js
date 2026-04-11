// AI 통신만 전담하는 모듈
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';

async function generateGeminiResponse(contentPayload, personality = 'calm') {
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

module.exports = { generateGeminiResponse };