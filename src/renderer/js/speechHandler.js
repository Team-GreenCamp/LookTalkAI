export class SpeechHandler {
    // 💡 3번째 콜백(onVolumeChange) 추가: 목소리 크기에 따라 UI를 움직이기 위함
    constructor(onSpeechComplete, onStateChange, onVolumeChange) {
        this.onSpeechComplete = onSpeechComplete;
        this.onStateChange = onStateChange;
        this.onVolumeChange = onVolumeChange;

        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;

        // VAD (Voice Activity Detection) 관련 변수
        this.audioContext = null;
        this.analyser = null;
        this.animationFrameId = null;
        this.silenceDelayMs = 1500;    // 1.5초 동안 조용하면 종료 (원하면 수정 가능)
        this.silenceThreshold = 0.08;  // 조용함의 기준 볼륨 (0~1 사이)
    }

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

                // 녹음이 끝나면 볼륨 분석기도 정리
                this.stopAudioAnalysis();
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.onStateChange(true);

            // 💡 기존의 무조건 5초 종료 타이머를 지우고, 실시간 볼륨 분석기 실행
            this.startAudioAnalysis(stream);

        } catch (err) {
            console.error('마이크 시작 실패:', err);
        }
    }

    // ── 실시간 볼륨 분석 및 자동 종료 로직 ──
    startAudioAnalysis(stream) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        source.connect(this.analyser);

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        let lastSpeechTime = Date.now();

        const checkVolume = () => {
            if (!this.isRecording) return;

            this.analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            const rms = avg / 255; // 0 ~ 1 사이로 정규화된 볼륨값

            // UI 업데이트 (입 크기, 안테나 빛남)
            if (this.onVolumeChange) this.onVolumeChange(rms);

            // 조용함 감지 로직
            if (rms > this.silenceThreshold) {
                // 소리가 기준치 이상이면 타이머 초기화 (말하고 있는 중)
                lastSpeechTime = Date.now();
            } else {
                // 조용한 상태가 silenceDelayMs(1.5초) 이상 지속되면
                if (Date.now() - lastSpeechTime > this.silenceDelayMs) {
                    console.log("🤫 말끝맺음 감지됨. 녹음 자동 종료.");
                    this.stop();
                    return; // 루프 즉시 빠져나가기
                }
            }

            this.animationFrameId = requestAnimationFrame(checkVolume);
        };

        checkVolume();
    }

    stopAudioAnalysis() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }
        if (this.onVolumeChange) this.onVolumeChange(0); // UI 볼륨 초기화
    }

    stop() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.isRecording = false;
        }
    }
}