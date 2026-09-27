using Microsoft.Graph;
using Microsoft.Graph.Models;
using Azure.Identity;
using System.Collections.Concurrent;

namespace bot_graph_media;

public class GraphBotService
{
    private readonly GraphServiceClient _graphClient;
    private readonly ConcurrentDictionary<string, BotInstance> _bots = new();
    private readonly string _tenantId;
    private readonly string _clientId;

    public GraphBotService()
    {
        _tenantId = Environment.GetEnvironmentVariable("AZURE_TENANT_ID") ?? "";
        _clientId = Environment.GetEnvironmentVariable("AZURE_CLIENT_ID") ?? "";
        var clientSecret = Environment.GetEnvironmentVariable("AZURE_CLIENT_SECRET") ?? "";

        var credential = new ClientSecretCredential(_tenantId, _clientId, clientSecret);
        _graphClient = new GraphServiceClient(credential);
        
        Console.WriteLine($"[GraphBot] Initialized with Client ID: {_clientId.Substring(0, 8)}...");
    }

    public async Task<string> CreateBotAsync(BotRequest request)
    {
        var botId = Guid.NewGuid().ToString();
        
        var bot = new BotInstance
        {
            Id = botId,
            MeetingUrl = request.meeting_url,
            BotName = request.bot_name,
            Status = "joining_call",
            CreatedAt = DateTime.UtcNow
        };
        
        _bots[botId] = bot;
        
        Console.WriteLine($"[{botId}] Bot created, will join: {request.meeting_url}");
        
        // Start join process in background
        _ = Task.Run(async () => await JoinMeetingAsync(botId));
        
        return botId;
    }

    private async Task JoinMeetingAsync(string botId)
    {
        var bot = _bots[botId];
        
        try
        {
            Console.WriteLine($"[{botId}] Parsing meeting URL...");
            
            // Extract meeting ID from URL
            var uri = new Uri(bot.MeetingUrl);
            var meetingId = ExtractMeetingId(uri);
            
            if (string.IsNullOrEmpty(meetingId))
            {
                throw new Exception("Could not extract meeting ID from URL");
            }
            
            Console.WriteLine($"[{botId}] Meeting ID: {meetingId}");
            
            // For now, just simulate joining (actual Graph API call requires proper setup)
            bot.Status = "in_waiting_room";
            Console.WriteLine($"[{botId}] Status → in_waiting_room");
            
            await Task.Delay(5000);
            
            bot.Status = "in_call_recording";
            Console.WriteLine($"[{botId}] Status → in_call_recording");
            
            // TODO: Implement actual Graph API call:
            // await _graphClient.Communications.Calls
            //     .PostAsync(new Call { ... });
            
            Console.WriteLine($"[{botId}] ⚠️  Graph API join not implemented yet - simulation only");
            Console.WriteLine($"[{botId}] To complete: Add Communications API permissions and implement call join");
        }
        catch (Exception ex)
        {
            bot.Status = "fatal";
            Console.WriteLine($"[{botId}] Error: {ex.Message}");
        }
    }

    private string ExtractMeetingId(Uri uri)
    {
        // Extract from Teams meeting URLs
        // Format: https://teams.microsoft.com/meet/418778817299435?p=...
        var segments = uri.AbsolutePath.Split('/');
        return segments.LastOrDefault(s => !string.IsNullOrEmpty(s)) ?? "";
    }

    public BotInstance? GetBot(string id)
    {
        _bots.TryGetValue(id, out var bot);
        return bot;
    }
}

public class BotInstance
{
    public string Id { get; set; } = "";
    public string MeetingUrl { get; set; } = "";
    public string BotName { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public string? RecordingFile { get; set; }
    public string? TranscriptFile { get; set; }
}
