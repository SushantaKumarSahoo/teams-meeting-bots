const { chromium } = require('playwright');
const { spawn } = require('child_process');

async function main() {
    const meetingUrl = process.env.MEETING_URL || "https://teams.microsoft.com/meet/418778817299435?p=FY3Ic8YhLWGXWQ3JUq";

    console.log("Launching browser on virtual display :99...");

    const browser = await chromium.launch({
        headless: false, // Must be FALSE to render on Xvfb properly
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-features=WebRtcHideLocalIpsWithMdns',
            '--window-size=1920,1080',
            '--start-maximized'
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        permissions: ['camera', 'microphone']
    });

    const page = await context.newPage();

    // Stealth mode: Hide the fact that this is an automated browser
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Automatically dismiss native browser popups (like "Open xdg-open?")
    page.on('dialog', async dialog => {
        console.log("Dismissed native browser popup!");
        await dialog.dismiss();
    });

    console.log("Navigating to meeting URL...");
    await page.goto(meetingUrl);

    // Wait for Teams to load
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Try to navigate the initial Teams UI
    try {
        console.log("Looking for 'Continue on this browser'...");
        const continueBtn = page.getByRole('button', { name: /Continue on this browser/i });
        if (await continueBtn.isVisible({ timeout: 5000 })) {
            await continueBtn.click();
        }

        console.log("Looking for name input...");
        const nameInput = page.getByPlaceholder('Type your name');
        await nameInput.waitFor({ timeout: 15000 });
        await nameInput.fill("My Enterprise Clone");

        console.log("Clicking Join Now...");
        await page.getByRole('button', { name: /Join now/i }).click();
    } catch (e) {
        console.log("Join UI flow error (might be different UI):", e.message);
    }

    console.log("Injecting CSS to hide Teams UI and make it look like Recall.ai...");
    try {
        await page.addStyleTag({ content: `
            /* Hide the bottom/top control bar */
            div[data-tid="calling-control-bar"], 
            #calling-control-bar { display: none !important; }
            
            /* Hide annoying toast notifications (like "You're muted") */
            div[role="alert"], 
            .ui-toast { display: none !important; }
            
            /* Hide side panels */
            div[data-tid="chat-pane"] { display: none !important; }
            
            /* Make the video grid take up the full screen */
            .video-stage { background: black !important; }
        `});
        // Give it a second to apply
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
        console.log("Error hiding UI:", e.message);
    }

    console.log("Bot has attempted to join. Starting FFmpeg recording...");

    // Start FFmpeg to record the virtual screen and virtual audio
    const ffmpegProcess = spawn('ffmpeg', [
        '-y', // Overwrite output file
        // Input 1: The Xvfb screen
        '-f', 'x11grab',
        '-video_size', '1920x1080',
        '-framerate', '30',
        '-i', ':99.0',
        // Input 2: The PulseAudio virtual sink
        '-f', 'pulse',
        '-i', 'v1.monitor',
        // Output format encoding
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-strict', 'experimental',
        './output/recording.mp4' // Final output file
    ]);

    ffmpegProcess.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));

    console.log("Recording in progress... Will record for 10 minutes and monitor for drops.");

    // Record for 10 minutes, checking every 2 seconds if the call dropped
    for (let i = 0; i < 300; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Anti-Bot: If Teams drops our connection, automatically click "Rejoin call"
        try {
            const rejoinBtn = page.getByRole('button', { name: /Rejoin call/i });
            if (await rejoinBtn.isVisible({ timeout: 100 })) {
                console.log("⚠️ Teams blocked the connection! Auto-rejoining...");
                await rejoinBtn.click();
            }
        } catch (e) { } // Ignore errors if button doesn't exist
    }

    console.log("Stopping FFmpeg...");
    ffmpegProcess.kill('SIGINT');

    // Wait a moment for FFmpeg to finalize the MP4 file
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log("Closing browser...");
    await browser.close();

    console.log("Done! Recording successfully saved to ./output/recording.mp4");

    // Simulating the Cloud Platform: Sending the Webhook
    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl) {
        console.log("Sending final webhook payload...");
        const payload = {
            id: process.env.BOT_ID,
            meeting_url: { business_meeting_id: "418778817299435" },
            bot_name: process.env.BOT_NAME || "My Clone Bot",
            status_changes: [{ code: "done", message: null }],
            recordings: [{
                format: "mp4",
                media_shortcuts: {
                    video_mixed: {
                        data: {
                            // In a real startup, you upload the file to S3 and put the S3 URL here.
                            // We are returning a local placeholder for the demo!
                            download_url: `file:///usr/src/app/output/recording_${process.env.BOT_ID}.mp4`
                        }
                    }
                }
            }]
        };

        try {
            // Need to require native fetch or use http module, but Node 18+ has global fetch
            await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            console.log("Webhook sent successfully!");
        } catch (err) {
            console.log("Failed to send webhook:", err.message);
        }
    }
}

main().catch(console.error);
