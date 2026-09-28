const express = require('express');
const { spawn } = require('child_process');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// This acts like the Recall.ai Fleet Manager
app.post('/api/v1/bot', (req, res) => {
    const { meeting_url, webhook_url, bot_name } = req.body;

    if (!meeting_url) {
        return res.status(400).json({ error: "meeting_url is required" });
    }

    // Generate a unique ID for this bot
    const botId = crypto.randomUUID();

    console.log(`[Fleet Manager] Received request to start bot ${botId} for meeting ${meeting_url}`);

    // In a real startup, you'd send this to an AWS Queue. 
    // Here, we just spawn the Docker container directly from Node!
    const dockerArgs = [
        'run', '--rm',
        '-v', `${__dirname}/output:/usr/src/app/output`,
        '-e', `MEETING_URL=${meeting_url}`,
        '-e', `BOT_NAME=${bot_name || 'My Recall Clone'}`,
        '-e', `WEBHOOK_URL=${webhook_url || ''}`,
        '-e', `BOT_ID=${botId}`,
        'my-recall-clone'
    ];

    const botProcess = spawn('docker', dockerArgs);

    botProcess.stdout.on('data', (data) => console.log(`[Bot ${botId}] ${data.toString().trim()}`));
    botProcess.stderr.on('data', (data) => console.log(`[Bot ${botId} Error] ${data.toString().trim()}`));

    botProcess.on('close', (code) => {
        console.log(`[Fleet Manager] Bot ${botId} finished with code ${code}`);
    });

    // Immediately return the Bot ID to the user, just like Recall.ai!
    res.json({
        id: botId,
        status: "starting",
        meeting_url: meeting_url
    });
});

app.listen(3000, () => {
    console.log("🚀 Recall.ai Clone API Server running on http://localhost:3000");
    console.log("Send a POST request to /api/v1/bot to start a meeting bot!");
});
