using Microsoft.Extensions.Hosting;

namespace bot_graph_media;

public class BotBackgroundService : BackgroundService
{
    private readonly GraphBotService _botService;

    public BotBackgroundService(GraphBotService botService)
    {
        _botService = botService;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Console.WriteLine("[Background] Bot service ready");
        
        // Keep service running
        await Task.Delay(Timeout.Infinite, stoppingToken);
    }
}
