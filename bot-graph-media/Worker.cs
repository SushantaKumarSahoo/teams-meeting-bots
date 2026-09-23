using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Graph.Communications.Client;
using Microsoft.Graph.Communications.Common.Telemetry;
using Microsoft.Graph.Communications.Core.Serialization;
using Microsoft.Skype.Bots.Media;
using System.Security.Cryptography.X509Certificates;

namespace bot_graph_media
{
    public class Worker : BackgroundService
    {
        private readonly ILogger<Worker> _logger;
        private readonly IGraphLogger _graphLogger;
        public ICommunicationsClient Client { get; private set; }

        public Worker(ILogger<Worker> logger)
        {
            _logger = logger;
            _graphLogger = new GraphLogger(typeof(Worker).Assembly.GetName().Name);
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("Worker running at: {time}", DateTimeOffset.Now);

            // Scaffold configuration values (these would come from IConfiguration in a real app)
            string tenantId = "YOUR_TENANT_ID";
            string clientId = "YOUR_CLIENT_ID";
            string certPath = "certificate.pfx";
            string certPassword = "YOUR_CERT_PASSWORD";
            
            // Note: ngrok or similar required for a local media platform endpoint
            string localMediaEndpoint = "net.tcp://127.0.0.1:8445"; 
            string botEndpoint = "https://your-bot-endpoint.ngrok.io/api/calling";

            try
            {
                // Local X.509 certificate parsing
                var certificate = new X509Certificate2(certPath, certPassword, X509KeyStorageFlags.MachineKeySet);

                // Configure media platform
                var mediaPlatformSettings = new MediaPlatformSettings
                {
                    MediaPlatformInstanceSettings = new MediaPlatformInstanceSettings
                    {
                        CertificateThumbprint = certificate.Thumbprint,
                        InstanceInternalPort = 8445,
                        InstancePublicIPAddress = System.Net.IPAddress.Any,
                        InstancePublicPort = 8445,
                        ServiceFqdn = "your-bot-endpoint.ngrok.io" // Ensure this matches your public DNS
                    },
                    ApplicationId = clientId
                };

                MediaPlatform.Initialize(mediaPlatformSettings);

                // Initialize Communications Client
                var builder = new CommunicationsClientBuilder(
                    "bot_graph_media",
                    clientId,
                    _graphLogger);

                builder.SetAuthenticationProvider(new CertificateAuthenticationProvider(clientId, tenantId, certificate));
                
                builder.SetNotificationUrl(new Uri(botEndpoint));
                
                // Add media extension
                builder.SetMediaPlatformSettings(mediaPlatformSettings);

                Client = builder.Build();

                _logger.LogInformation("Communications client initialized and Media Platform started.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to initialize communications client or media platform.");
            }

            // Wait until cancelled
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
    }

    // Dummy authentication provider for scaffolding
    public class CertificateAuthenticationProvider : Microsoft.Graph.Communications.Client.Authentication.IRequestAuthenticationProvider
    {
        public CertificateAuthenticationProvider(string clientId, string tenantId, X509Certificate2 certificate) { }

        public Task AuthenticateOutboundRequestAsync(HttpRequestMessage request, string tenantId)
        {
            return Task.CompletedTask;
        }

        public Task<Microsoft.Graph.Communications.Client.Authentication.RequestValidationResult> ValidateInboundRequestAsync(HttpRequestMessage request)
        {
            return Task.FromResult(new Microsoft.Graph.Communications.Client.Authentication.RequestValidationResult { IsValid = true });
        }
    }
}
