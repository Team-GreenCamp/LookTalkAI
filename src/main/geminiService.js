const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VERTEX_AI_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
const VERTEX_AI_LOCATION = process.env.VERTEX_AI_LOCATION || 'global';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
const GEMINI_TTS_LOCATION = process.env.GEMINI_TTS_LOCATION || 'global';
const GEMINI_TTS_LANGUAGE_CODE = process.env.GEMINI_TTS_LANGUAGE_CODE || 'ko-KR';
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Kore';
const GEMINI_TTS_AUDIO_ENCODING = process.env.GEMINI_TTS_AUDIO_ENCODING || 'MP3';
const responseLengthConfigs = {
    short: {
        prompt: '아주 짧게 한두 문장으로만 답해라.',
        maxTokens: 90
    },
    medium: {
        prompt: '짧은 두세 문장 안에서 자연스럽게 답해라.',
        maxTokens: 160
    }
};

let googleAccessTokenCache = null;
let googleAccessTokenExpiresAt = 0;
let googleQuotaProjectId = null;

function toBase64Url(value) {
    return Buffer.from(value)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function getGoogleApplicationDefaultCredentials() {
    const adcPathFromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const defaultAdcPath = path.join(
        os.homedir(),
        '.config',
        'gcloud',
        'application_default_credentials.json'
    );
    const credentialsPath = adcPathFromEnv || defaultAdcPath;

    if (!fs.existsSync(credentialsPath)) {
        throw new Error('Application Default Credentials 파일을 찾지 못했습니다. `gcloud auth application-default login`을 먼저 실행하세요.');
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    googleQuotaProjectId = credentials.quota_project_id || process.env.GOOGLE_CLOUD_QUOTA_PROJECT || null;
    return credentials;
}

async function getGoogleAccessToken() {
    const now = Date.now();

    if (googleAccessTokenCache && now < googleAccessTokenExpiresAt) {
        return googleAccessTokenCache;
    }

    const credentials = getGoogleApplicationDefaultCredentials();
    let tokenResponse;

    if (credentials.type === 'authorized_user') {
        tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: credentials.client_id,
                client_secret: credentials.client_secret,
                refresh_token: credentials.refresh_token,
                grant_type: 'refresh_token'
            })
        });
    } else if (credentials.type === 'service_account') {
        const issuedAt = Math.floor(now / 1000);
        const expiresAt = issuedAt + 3600;
        const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
        const claimSet = toBase64Url(JSON.stringify({
            iss: credentials.client_email,
            scope: 'https://www.googleapis.com/auth/cloud-platform',
            aud: 'https://oauth2.googleapis.com/token',
            exp: expiresAt,
            iat: issuedAt
        }));
        const unsignedToken = `${header}.${claimSet}`;
        const signature = crypto
            .createSign('RSA-SHA256')
            .update(unsignedToken)
            .sign(credentials.private_key, 'base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');

        tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: `${unsignedToken}.${signature}`
            })
        });
    } else {
        throw new Error(`지원하지 않는 ADC 자격 증명 타입입니다: ${credentials.type}`);
    }

    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Google OAuth 토큰 발급 실패 (${tokenResponse.status}): ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    googleAccessTokenCache = tokenData.access_token;
    googleAccessTokenExpiresAt = now + Math.max((tokenData.expires_in - 60) * 1000, 0);

    return googleAccessTokenCache;
}

function getVertexAiGenerateContentUrl() {
    // global 위치는 리전 prefix 없이 공용 endpoint를 사용해야 한다.
    const endpoint = VERTEX_AI_LOCATION === 'global'
        ? 'https://aiplatform.googleapis.com'
        : `https://${VERTEX_AI_LOCATION}-aiplatform.googleapis.com`;

    return `${endpoint}/v1/projects/${VERTEX_AI_PROJECT_ID}/locations/${VERTEX_AI_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;
}

function getTextToSpeechUrl() {
    // global 위치는 prefix 없이 기본 Text-to-Speech endpoint를 사용한다.
    const endpoint = GEMINI_TTS_LOCATION === 'global'
        ? 'https://texttospeech.googleapis.com'
        : `https://${GEMINI_TTS_LOCATION}-texttospeech.googleapis.com`;

    return `${endpoint}/v1/text:synthesize`;
}

function buildTtsPrompt(personality = 'calm') {
    const prompts = {
        calm: '차분하고 안정적인 한국어 데스크톱 비서 목소리로 말해라.',
        bright: '밝고 친근하며 살짝 생동감 있는 한국어 목소리로 말해라.',
        tsundere: '조금 시크하지만 밉지 않은 한국어 목소리로 말해라.',
        assistant: '또박또박하고 정돈된 전문 비서 톤의 한국어 목소리로 말해라.'
    };

    return prompts[personality] || prompts.calm;
}

function buildConversationContents(currentParts, conversationContext = []) {
    const safeContext = Array.isArray(conversationContext) ? conversationContext : [];
    const contents = safeContext
        .filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message?.text === 'string' && message.text.trim())
        .slice(-10)
        .map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [
                {
                    text: message.text.trim()
                }
            ]
        }));

    // Vertex AI 대화 입력은 사용자 발화부터 시작하도록 맞춘다.
    while (contents[0]?.role === 'model') {
        contents.shift();
    }

    contents.push({
        role: 'user',
        parts: currentParts
    });

    return contents;
}

function extractResponseText(data) {
    const parts = data?.candidates?.[0]?.content?.parts;

    if (!Array.isArray(parts)) {
        return '';
    }

    return parts
        .map((part) => part?.text || '')
        .join('')
        .trim();
}

async function generateGeminiResponse(contentPayload, personality = 'calm', options = {}) {
    if (!VERTEX_AI_PROJECT_ID) {
        throw new Error('GOOGLE_CLOUD_PROJECT 환경 변수가 설정되지 않았습니다.');
    }

    const personalityPrompts = {
        calm: '차분하고 안정적인 말투로 답해라.',
        bright: '발랄하고 친근한 말투로 답해라.',
        tsundere: '조금 시크하지만 밉지 않은 말투로 답해라.',
        assistant: '정돈된 프로 비서 톤으로 답해라.'
    };
    const lengthConfig = responseLengthConfigs[options.responseLength] || responseLengthConfigs.short;
    const accessToken = await getGoogleAccessToken();

    console.log('[LLM][CONTEXT_COUNT]', Array.isArray(options.conversationContext) ? options.conversationContext.length : 0);

    const response = await fetch(getVertexAiGenerateContentUrl(), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...(googleQuotaProjectId ? { 'x-goog-user-project': googleQuotaProjectId } : {})
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [
                    {
                        // 성격과 답변 길이 설정을 Vertex AI 요청에 함께 반영한다.
                        text: `너는 한국어로 답하는 데스크톱 비서다. ${personalityPrompts[personality] || personalityPrompts.calm} ${lengthConfig.prompt}`
                    }
                ]
            },
            contents: buildConversationContents(contentPayload, options.conversationContext),
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: lengthConfig.maxTokens
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Vertex AI 호출 실패 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const replyText = extractResponseText(data);

    if (!replyText) {
        throw new Error('Vertex AI 응답에서 텍스트를 찾지 못했습니다.');
    }

    return replyText;
}

async function synthesizeGeminiSpeech(text, personality = 'calm') {
    const normalizedText = typeof text === 'string' ? text.trim() : '';

    if (!normalizedText) {
        throw new Error('TTS로 변환할 텍스트가 없습니다.');
    }

    if (!VERTEX_AI_PROJECT_ID) {
        throw new Error('GOOGLE_CLOUD_PROJECT 환경 변수가 설정되지 않았습니다.');
    }

    const accessToken = await getGoogleAccessToken();
    const response = await fetch(getTextToSpeechUrl(), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...(googleQuotaProjectId ? { 'x-goog-user-project': googleQuotaProjectId } : {})
        },
        body: JSON.stringify({
            input: {
                // Gemini-TTS는 스타일 지시와 읽을 텍스트를 분리해서 전달한다.
                prompt: buildTtsPrompt(personality),
                text: normalizedText
            },
            voice: {
                languageCode: GEMINI_TTS_LANGUAGE_CODE,
                name: GEMINI_TTS_VOICE,
                model_name: GEMINI_TTS_MODEL
            },
            audioConfig: {
                audioEncoding: GEMINI_TTS_AUDIO_ENCODING
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Cloud TTS 호출 실패 (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.audioContent) {
        throw new Error('Google Cloud TTS 응답에서 오디오를 찾지 못했습니다.');
    }

    return {
        audioBase64: data.audioContent,
        mimeType: GEMINI_TTS_AUDIO_ENCODING === 'MP3' ? 'audio/mpeg' : 'audio/wav'
    };
}

module.exports = { generateGeminiResponse, synthesizeGeminiSpeech };
