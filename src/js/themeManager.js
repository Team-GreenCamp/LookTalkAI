export const paletteThemes = {
    mint: { body: '#24313a', face: '#182127', accent: '#38d6b5', accentGlow: 'rgba(56, 214, 181, 0.35)', cheek: 'rgba(255, 146, 122, 0.35)' },
    coral: { body: '#3a2a30', face: '#24171c', accent: '#ff7d7d', accentGlow: 'rgba(255, 125, 125, 0.35)', cheek: 'rgba(255, 189, 171, 0.38)' },
    lemon: { body: '#353127', face: '#221f17', accent: '#f4cf4f', accentGlow: 'rgba(244, 207, 79, 0.35)', cheek: 'rgba(255, 177, 108, 0.34)' },
    blue: { body: '#243245', face: '#17212e', accent: '#5eb6ff', accentGlow: 'rgba(94, 182, 255, 0.35)', cheek: 'rgba(255, 166, 166, 0.28)' }
};

export class ThemeManager {
    constructor() {
        this.settingsStorageKey = 'looktalk.settings';
        this.defaultSettings = {
            bubbleDurationMs: 5000,
            responseLength: 'short',
            voiceTriggerEnabled: true,
            historyPersistenceEnabled: true
        };
        this.appSettings = { ...this.defaultSettings };
    }

    loadSettings() {
        const saved = JSON.parse(localStorage.getItem(this.settingsStorageKey) || 'null');
        this.appSettings = { ...this.defaultSettings, ...(saved || {}) };
        return this.appSettings;
    }

    saveSettings(newSettings) {
        this.appSettings = { ...this.appSettings, ...newSettings };
        localStorage.setItem(this.settingsStorageKey, JSON.stringify(this.appSettings));
    }

    applyPalette(paletteName) {
        const theme = paletteThemes[paletteName] || paletteThemes.mint;
        const root = document.documentElement;
        root.style.setProperty('--robot-body', theme.body);
        root.style.setProperty('--robot-face', theme.face);
        root.style.setProperty('--accent', theme.accent);
        root.style.setProperty('--accent-glow', theme.accentGlow);
        root.style.setProperty('--cheek', theme.cheek);
        localStorage.setItem('looktalk.palette', paletteName);
        return paletteName;
    }
}