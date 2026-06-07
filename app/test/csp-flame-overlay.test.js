const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEGACY_FLAME_OVERLAY_ONCLICK_HASHES = [
    'sha256-pkIZTNQY7BAA6zzvdEQOswJQVdWjCCJ1kfPGeTNsf7I=',
    'sha256-NLOkSEP75l2qahhI8V8waw8g5W+9Zf51oD/q4a/qGUQ=',
    'sha256-D/hVuFkLXG80cISOvW06JGm4tZkFXx4l076EvvbhR7c=',
    'sha256-95XKTDnFGaz2BCZfpSens5prP2Lv+5i+tOn158I8V40='
];

function getInlineEventHandlers(html) {
    return [...html.matchAll(/\s(on[a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
        .map(match => ({
            attribute: match[1].toLowerCase(),
            code: match[2] ?? match[3] ?? match[4] ?? ''
        }));
}

function hashInlineHandler(code) {
    return `sha256-${crypto.createHash('sha256').update(code).digest('base64')}`;
}

describe('CSP Configuration for Flame Overlay', () => {
    let serverJsContent;
    let settingsHtml;
    
    beforeAll(() => {
        const serverPath = path.join(__dirname, '..', 'server.js');
        const settingsPath = path.join(__dirname, '..', 'plugins', 'flame-overlay', 'ui', 'settings.html');
        serverJsContent = fs.readFileSync(serverPath, 'utf8');
        settingsHtml = fs.readFileSync(settingsPath, 'utf8');
    });
    
    test('settings.html has no inline event handlers', () => {
        expect(getInlineEventHandlers(settingsHtml)).toEqual([]);
    });
    
    test('server.js does not carry stale flame-overlay onclick hashes', () => {
        expect(serverJsContent).not.toContain('Flame overlay inline handlers');
        LEGACY_FLAME_OVERLAY_ONCLICK_HASHES.forEach(hash => {
            expect(serverJsContent).not.toContain(hash);
        });
    });
    
    test('server.js hash list is derived from current settings UI behavior', () => {
        const currentHandlers = getInlineEventHandlers(settingsHtml);
        currentHandlers.forEach(handler => {
            expect(serverJsContent).not.toContain(hashInlineHandler(handler.code));
        });
    });
});
