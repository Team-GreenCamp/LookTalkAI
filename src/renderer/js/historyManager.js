export class HistoryManager {
    constructor() {
        this.storageKey = 'looktalk.history';
        this.historyList = document.getElementById('history-list');
        this.conversationHistory = [];
    }

    // HTML 태그가 UI를 깨뜨리지 않도록 안전하게 텍스트로 변환
    escapeHtml(text) {
        return text
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    load(persistenceEnabled) {
        if (!persistenceEnabled) return [];
        const saved = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
        this.conversationHistory = Array.isArray(saved) ? saved : [];
        this.render();
        return this.conversationHistory;
    }

    addMessage(role, text, persistenceEnabled) {
        const trimmed = text.trim();
        if (!trimmed) return;
        this.conversationHistory.push({ role, text: trimmed });
        this.render();
        if (persistenceEnabled) {
            localStorage.setItem(this.storageKey, JSON.stringify(this.conversationHistory.slice(-30)));
        }
    }

    clear() {
        this.conversationHistory = [];
        localStorage.removeItem(this.storageKey);
        this.render();
    }

    render() {
        if (this.conversationHistory.length === 0) {
            this.historyList.innerHTML = '<p class="history-empty">대화가 아직 없어요.</p>';
            return;
        }
        this.historyList.innerHTML = this.conversationHistory.map(msg => `
                <div class="history-item ${msg.role === 'user' ? 'user' : 'assistant'}">
                <span class="history-role">${msg.role === 'user' ? '나' : 'AI'}</span>
                <p class="history-message">${this.escapeHtml(msg.text)}</p>
                </div>
            `).join('');
        this.historyList.scrollTop = this.historyList.scrollHeight;
    }
}