export class TtsService {
    static currentAudio = null;

    static async speak(text, personality = 'calm') {
        this.stop();

        try {
            const response = await window.lookTalkAPI.synthesizeSpeech({
                text,
                personality
            });

            if (!response?.ok) {
                throw new Error(response?.error || 'TTS 생성에 실패했습니다.');
            }

            // 메인 프로세스에서 받은 Google Cloud TTS 오디오를 브라우저 Audio로 재생한다.
            const audio = new Audio(`data:${response.mimeType};base64,${response.audioBase64}`);
            this.currentAudio = audio;
            await audio.play();
        } catch (error) {
            console.error('❌ TTS 재생 실패:', error);
        }
    }

    static stop() {
        if (!this.currentAudio) {
            return;
        }

        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio = null;
    }
}
