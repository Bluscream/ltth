const { chromium } = require('playwright');
(async () => {
    console.log('🚀 Launching Playwright Chromium...');
    try {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        console.log('--------------------------------------------------');
        console.log('🖥️ INITIALIZING DASHBOARD LOG DUMP OVER 5 SECONDS 🖥️');
        console.log('--------------------------------------------------');
        
        // Listen to console and page errors
        page.on('console', msg => {
            console.log('[' + msg.type().toUpperCase() + '] ' + msg.text());
        });
        page.on('pageerror', err => {
            console.log('[PAGE CRASH]', err.message);
        });

        console.log('📡 Navigating to dashboard.html...');
        await page.goto('http://localhost:3000/dashboard.html');
        
        // Wait required initialization time
        await page.waitForTimeout(5000);
        
        console.log('--------------------------------------------------');
        console.log('✅ PAGE LOG DUMP COMPLETE ✅');
        console.log('--------------------------------------------------');
        await browser.close();
        process.exit(0);
    } catch (e) {
        console.error('Test script crash:', e);
        process.exit(1);
    }
})();
