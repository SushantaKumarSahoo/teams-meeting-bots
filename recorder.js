const RECALL_API_KEY = "9d8565caba4c00fac2f72efbcf57268786c16b8c";
const MEETING_URL = "https://teams.microsoft.com/meet/418778817299435?p=FY3Ic8YhLWGXWQ3JUq";

async function sendBot() {
  console.log("Sending bot to meeting...");
  
  const response = await fetch("https://ap-northeast-1.recall.ai/api/v1/bot", {
    method: "POST",
    headers: {
      "Authorization": `Token ${RECALL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      meeting_url: MEETING_URL,
      bot_name: "My Recall Recording Bot",
      recording_options: {
        video_mixed_mp4: {},
        audio_mixed_mp3: {}
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("API Error:", data);
    return;
  }
  
  console.log("Success! Bot ID:", data.id);
  console.log("Check your Recall.ai Dashboard to watch the bot join and view the recording!");
}

sendBot();
