export class SpeechHandler {
    constructor(onSpeechComplete, onStateChange) {
        this.onSpeechComplete = onSpeechComplete; // 최종 오디오 데이터를 넘겨줄 콜백
        this.onStateChange = onStateChange;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
    }

    // MIME 타입 확인 (Gemini는 webm/opus 지원)
    getSupportedMimeType() {
        return 'audio/webm;codecs=opus';
    }

    async start() {
        if (this.isRecording) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioChunks = [];
            this.mediaRecorder = new MediaRecorder(stream, { mimeType: this.getSupportedMimeType() });

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.audioChunks.push(e.data);
            };

            this.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(this.audioChunks, { type: this.getSupportedMimeType() });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64Data = reader.result.split(',')[1];
                    this.onSpeechComplete(base64Data, this.getSupportedMimeType());
                };
                this.onStateChange(false);
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.onStateChange(true); // 여기서 초록색 테두리 트리거 발생

            // 5초 후 자동 종료 (필요시 조정)
            setTimeout(() => this.stop(), 5000);
        } catch (err) {
            console.error('마이크 시작 실패:', err);
        }
    }

    stop() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.isRecording = false;
        }
    }
}