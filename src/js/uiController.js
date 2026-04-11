export class UIController {
    constructor() {
        this.widget = document.getElementById('widget');
        this.robotFace = document.getElementById('robot-face');
        this.speechBubble = document.getElementById('speech-bubble');
        this.mouthShape = document.getElementById('mouth-shape');
        this.antennaBall = document.getElementById('antenna-ball');
        this.typingTimerId = null;
        this.bubbleTimerId = null;
    }

    setRobotState(state) {
        this.widget.setAttribute('data-state', state);
        this.robotFace.classList.remove('bounce');
        void this.robotFace.offsetWidth;
        this.robotFace.classList.add('bounce');
    }

    setReadiness(isReady) {
        this.widget.setAttribute('data-ready', isReady ? 'ready' : 'not-ready');
    }

    // 볼륨에 따른 입과 안테나 반응
    handleVolumeEffect(rms, isListening) {
        if (!isListening) {
            this.mouthShape.style.transform = '';
            this.antennaBall.style.transform = '';
            return;
        }
        const normalized = Math.min(rms / 0.15, 1);
        this.mouthShape.style.transform = `scaleY(${0.5 + normalized * 0.8})`;
        this.antennaBall.style.transform = `scale(${1 + normalized * 0.5})`;
    }

    showBubble(text, durationMs) {
        if (this.typingTimerId) clearTimeout(this.typingTimerId);
        if (this.bubbleTimerId) clearTimeout(this.bubbleTimerId);

        this.speechBubble.innerHTML = '<span class="typing-cursor"></span>';
        this.speechBubble.style.display = 'block';
        requestAnimationFrame(() => this.speechBubble.classList.add('visible'));

        let charIndex = 0;
        const chars = [...text];

        const typeNext = () => {
            if (charIndex < chars.length) {
                const cursor = this.speechBubble.querySelector('.typing-cursor');
                if (cursor) cursor.insertAdjacentText('beforebegin', chars[charIndex]);
                charIndex++;
                this.typingTimerId = setTimeout(typeNext, 35 + Math.random() * 25);
            } else {
                const cursor = this.speechBubble.querySelector('.typing-cursor');
                if (cursor) cursor.remove();
                this.bubbleTimerId = setTimeout(() => {
                    this.speechBubble.classList.remove('visible');
                    setTimeout(() => { this.speechBubble.style.display = 'none'; }, 400);
                }, durationMs);
            }
        };
        this.typingTimerId = setTimeout(typeNext, 200);
    }
}