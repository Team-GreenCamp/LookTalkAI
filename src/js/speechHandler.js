const { ipcRenderer } = require('electron');

export class SpeechHandler {
    constructor(onResultCallback, onStateChangeCallback = null) {
        this.onResultCallback = onResultCallback;
        this.onStateChangeCallback = onStateChangeCallback;
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.audioSource = null;
        this.analyser = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.isStarting = false;
        this.hasDetectedSpeech = false;
        this.lastSpeechAt = 0;
        this.monitorFrameId = null;
        this.maxRecordingTimerId = null;
        this.mimeType = this.getSupportedMimeType();
    }

    getSupportedMimeType() {
        const preferredMimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus'
        ];

        return preferredMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
    }

    async ensureMediaStream() {
        if (this.mediaStream) {
            return this.mediaStream;
        }

        // 한글 음성 입력을 위해 마이크 스트림을 한 번만 열고 재사용
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        return this.mediaStream;
    }

    async setupAudioMonitor(stream) {
        this.audioContext = new AudioContext();
        this.audioSource = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.audioSource.connect(this.analyser);
        this.hasDetectedSpeech = false;
        this.lastSpeechAt = performance.now();

        const buffer = new Uint8Array(this.analyser.fftSize);
        const silenceThreshold = 0.035;
        const silenceDurationMs = 1200;

        const monitorAudioLevel = () => {
            if (!this.isRecording || !this.analyser) {
                return;
            }

            this.analyser.getByteTimeDomainData(buffer);

            let sum = 0;

            for (const sample of buffer) {
                const normalized = (sample - 128) / 128;
                sum += normalized * normalized;
            }

            const rms = Math.sqrt(sum / buffer.length);
            const now = performance.now();

            if (rms > silenceThreshold) {
                this.hasDetectedSpeech = true;
                this.lastSpeechAt = now;
            }

            // 말이 시작된 뒤 일정 시간 무음이면 자동 종료
            if (this.hasDetectedSpeech && now - this.lastSpeechAt > silenceDurationMs) {
                this.stop();
                return;
            }

            this.monitorFrameId = requestAnimationFrame(monitorAudioLevel);
        };

        this.monitorFrameId = requestAnimationFrame(monitorAudioLevel);
    }

    async cleanupAudioMonitor() {
        if (this.monitorFrameId) {
            cancelAnimationFrame(this.monitorFrameId);
            this.monitorFrameId = null;
        }

        if (this.maxRecordingTimerId) {
            clearTimeout(this.maxRecordingTimerId);
            this.maxRecordingTimerId = null;
        }

        if (this.audioSource) {
            this.audioSource.disconnect();
            this.audioSource = null;
        }

        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }

        this.analyser = null;
    }

    async handleRecordingStop() {
        this.isRecording = false;
        this.onStateChangeCallback?.(false);

        const audioBlob = new Blob(this.audioChunks, {
            type: this.mimeType || 'audio/webm'
        });
        this.audioChunks = [];

        if (!audioBlob.size) {
            await this.cleanupAudioMonitor();
            return;
        }

        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBase64 = btoa(
            new Uint8Array(arrayBuffer).reduce(
                (binary, byte) => binary + String.fromCharCode(byte),
                ''
            )
        );

        console.log('[SpeechHandler] audio captured', {
            size: audioBlob.size,
            mimeType: audioBlob.type || this.mimeType || 'audio/webm'
        });

        const response = await ipcRenderer.invoke('transcribe-audio', {
            audioBase64,
            mimeType: audioBlob.type || this.mimeType || 'audio/webm'
        });

        await this.cleanupAudioMonitor();

        if (!response?.ok) {
            console.error('[SpeechHandler] transcription failed', response?.error || response);
            return;
        }

        console.log('[SpeechHandler] transcription success', response.transcript);
        this.onResultCallback(response.transcript, true);
    }

    async start() {
        if (this.isRecording || this.isStarting) {
            return false;
        }

        this.isStarting = true;
        console.log('[SpeechHandler] recording start requested');

        try {
            const stream = await this.ensureMediaStream();
            this.audioChunks = [];
            this.mediaRecorder = new MediaRecorder(
                stream,
                this.mimeType ? { mimeType: this.mimeType } : undefined
            );

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                console.log('[SpeechHandler] recording stop');
                await this.handleRecordingStop();
            };

            this.mediaRecorder.onerror = async (event) => {
                console.error('[SpeechHandler] recorder error', event?.error || event);
                await this.cleanupAudioMonitor();
                this.isRecording = false;
                this.onStateChangeCallback?.(false);
            };

            await this.setupAudioMonitor(stream);

            // 너무 길게 녹음되는 경우를 막기 위한 최대 길이 제한
            this.maxRecordingTimerId = setTimeout(() => {
                this.stop();
            }, 6000);

            this.mediaRecorder.start(250);
            this.isStarting = false;
            this.isRecording = true;
            console.log('[SpeechHandler] recording start');
            this.onStateChangeCallback?.(true);
            return true;
        } catch (error) {
            this.isStarting = false;
            console.error('[SpeechHandler] recording start failed', error);
            await this.cleanupAudioMonitor();
            return false;
        }
    }

    stop() {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
            return false;
        }

        console.log('[SpeechHandler] recording stop requested');
        this.mediaRecorder.stop();
        return true;
    }
}
