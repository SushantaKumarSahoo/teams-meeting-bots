const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const { spawn } = require('child_process');
const { startCapture } = require('./capture');

async function main() {
    const meetingUrl = process.env.MEETING_URL;
    if (!meetingUrl) {
        console.error('Please set MEETING_URL environment variable.');
        process.exit(1);
    }

    // Set up Xvfb and PulseAudio (assuming these are running in the container or spawned here)
    // In our container, we'll run Xvfb and PulseAudio before starting node, or spawn them here.
    // For this example, we assume Xvfb is on :99 and PulseAudio is default.

    const browser = await chromium.launch({
        headless: false, // Make it visible for testing
        channel: 'msedge', // Force using Microsoft Edge to support H.264 video codecs!
        args: [
            '--window-size=1920,1080',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        permissions: [] // Deny all permissions (camera, microphone) to force them off
    });

    const page = await context.newPage();

    // Block Teams from trying to launch the native desktop app (which causes the xdg-open dialog to block the screen)
    await context.route('msteams://**/*', route => route.abort());

    // Spoof webdriver so Teams doesn't detect the bot and force the 'Light' client
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    console.log('Navigating to meeting...');
    await page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Click "Continue on this browser"
    // Note: Teams DOM selectors change often. These are illustrative.
    try {
        await page.click('[data-tid="joinOnWeb"]', { timeout: 10000 });
    } catch (e) {
        console.log('Join on web button not found or not needed.');
    }

    // Wait for the name input
    await page.waitForSelector('input[type="text"]', { timeout: 60000 });
    await page.fill('input[type="text"]', 'CSM Notetaker');

    // Turn off camera and mic before joining
    console.log('Turning off camera and microphone...');
    try {
        // Teams often uses these specific data-tid attributes or aria-labels for the toggles
        const videoToggle = await page.$('div[role="switch"][data-tid="toggle-video"]');
        if (videoToggle) {
            const isVideoOn = await videoToggle.getAttribute('aria-checked');
            if (isVideoOn === 'true') await videoToggle.click();
        } else {
            // Fallback for newer UI
            const videoBtn = await page.$('div[role="switch"][aria-label*="camera"]');
            if (videoBtn && await videoBtn.getAttribute('aria-checked') === 'true') await videoBtn.click();
        }

        const micToggle = await page.$('div[role="switch"][data-tid="toggle-mute"]');
        if (micToggle) {
            const isMicOn = await micToggle.getAttribute('aria-checked');
            if (isMicOn === 'true') await micToggle.click();
        } else {
            // Fallback for newer UI
            const micBtn = await page.$('div[role="switch"][aria-label*="microphone"]');
            if (micBtn && await micBtn.getAttribute('aria-checked') === 'true') await micBtn.click();
        }
    } catch (e) {
        console.log('Could not automatically turn off camera/mic (DOM may have changed).', e);
    }

    // Click Join (use evaluate to bypass all overlays and keyboard fallback)
    try {
        await page.evaluate(() => {
            const btn = document.querySelector('button[data-tid="prejoin-join-button"]');
            if (btn) btn.click();
        });
        await page.waitForTimeout(1000);
        // Fallback: press Enter if focus is on it or globally
        const joinBtn = await page.$('button[data-tid="prejoin-join-button"]');
        if (joinBtn) {
            await joinBtn.focus();
            await page.keyboard.press('Enter');
        }
    } catch(err) {
        console.log('Error clicking join', err);
    }

    console.log('Joined the lobby. Waiting to be admitted by the organizer...');
    
    // Wait infinitely (timeout: 0) for the "Leave" button to appear, which only appears once admitted into the meeting.
    await page.waitForSelector('button#hangup-button, button[data-tid="call-hangup"], button[aria-label="Leave"], button:has-text("Leave")', { timeout: 0 });
    
    console.log('Admitted to the meeting! Starting recording...');

    // Start ffmpeg capture after joining
    const captureProcess = startCapture();

    // Keep alive until meeting ends or container is killed
    page.on('close', () => {
        console.log('Page closed, exiting...');
        if (captureProcess) captureProcess.kill('SIGINT');
        browser.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
