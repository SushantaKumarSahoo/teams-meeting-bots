using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using DotNetEnv;

namespace bot_graph_media;

public class Program
{
    public static void Main(string[] args)
    {
        // Load .env file
        Env.Load();
        
        var builder = WebApplication.CreateBuilder(args);
        
        // Add services
        builder.Services.AddControllers();
        builder.Services.AddEndpointsApiExplorer();
        builder.Services.AddSingleton<GraphBotService>();
        builder.Services.AddHostedService<BotBackgroundService>();
        
        var app = builder.Build();
        
        app.MapControllers();
        
        // Health check
        app.MapGet("/health", () => new { status = "healthy", service = "Teams Graph Bot" });
        
        // API endpoints
        app.MapPost("/api/v1/bot", async (BotRequest request, GraphBotService botService) =>
        {
            var botId = await botService.CreateBotAsync(request);
            return Results.Ok(new { id = botId, status = "created" });
        });
        
        app.MapGet("/api/v1/bot/{id}", (string id, GraphBotService botService) =>
        {
            var bot = botService.GetBot(id);
            return bot != null ? Results.Ok(bot) : Results.NotFound();
        });
        
        Console.WriteLine("=================================================");
        Console.WriteLine("Teams Graph Bot API");
        Console.WriteLine("=================================================");
        Console.WriteLine($"Listening on: http://localhost:5000");
        Console.WriteLine($"Health: http://localhost:5000/health");
        Console.WriteLine("=================================================");
        Console.WriteLine("Endpoints:");
        Console.WriteLine("  POST   http://localhost:5000/api/v1/bot");
        Console.WriteLine("  GET    http://localhost:5000/api/v1/bot/:id");
        Console.WriteLine("=================================================\n");
        
        app.Run("http://localhost:5000");
    }
}

public class BotRequest
{
    public string meeting_url { get; set; } = string.Empty;
    public string bot_name { get; set; } = "Recording Bot";
}
