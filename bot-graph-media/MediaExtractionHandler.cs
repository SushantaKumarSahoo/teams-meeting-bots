using Microsoft.Graph.Communications.Calling.Media;
using Microsoft.Graph.Communications.Common.Telemetry;
using Microsoft.Skype.Bots.Media;
using System.IO;

namespace bot_graph_media
{
    public class MediaExtractionHandler
    {
        private readonly IGraphLogger _logger;
        private readonly FileStream _audioStream;
        private readonly FileStream _speakerVideoStream;
        private readonly FileStream _vbssVideoStream;

        public MediaExtractionHandler(IGraphLogger logger)
        {
            _logger = logger;

            // Open files for raw byte streams
            _audioStream = new FileStream("raw_audio.pcm", FileMode.Create, FileAccess.Write);
            _speakerVideoStream = new FileStream("raw_speaker_video.nv12", FileMode.Create, FileAccess.Write);
            _vbssVideoStream = new FileStream("raw_vbss_video.nv12", FileMode.Create, FileAccess.Write);
        }

        public void AttachMediaSockets(ILocalMediaSession mediaSession)
        {
            // Subscribe to Audio
            var audioSocket = mediaSession.AudioSocket;
            if (audioSocket != null)
            {
                audioSocket.AudioMediaReceived += OnAudioMediaReceived;
            }

            // Subscribe to Video (Speaker and VBSS)
            foreach (var videoSocket in mediaSession.VideoSockets)
            {
                if (videoSocket.MediaStreamType == MediaStreamType.Video)
                {
                    videoSocket.VideoMediaReceived += OnSpeakerVideoReceived;
                }
                else if (videoSocket.MediaStreamType == MediaStreamType.VideoBasedScreenSharing)
                {
                    videoSocket.VideoMediaReceived += OnVbssVideoReceived;
                }
            }
        }

        private void OnAudioMediaReceived(object sender, AudioMediaReceivedEventArgs e)
        {
            try
            {
                var buffer = e.Buffer.Data;
                var length = (int)e.Buffer.Length;
                
                // Write unmixed main audio stream
                if (buffer != IntPtr.Zero && length > 0)
                {
                    byte[] managedBuffer = new byte[length];
                    System.Runtime.InteropServices.Marshal.Copy(buffer, managedBuffer, 0, length);
                    _audioStream.Write(managedBuffer, 0, length);
                }
                e.Buffer.Dispose();
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Error processing audio media");
            }
        }

        private void OnSpeakerVideoReceived(object sender, VideoMediaReceivedEventArgs e)
        {
            try
            {
                var buffer = e.Buffer.Data;
                var length = (int)e.Buffer.Length;

                // Write primary video socket (speaker)
                if (buffer != IntPtr.Zero && length > 0)
                {
                    byte[] managedBuffer = new byte[length];
                    System.Runtime.InteropServices.Marshal.Copy(buffer, managedBuffer, 0, length);
                    _speakerVideoStream.Write(managedBuffer, 0, length);
                }
                e.Buffer.Dispose();
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Error processing speaker video media");
            }
        }

        private void OnVbssVideoReceived(object sender, VideoMediaReceivedEventArgs e)
        {
            try
            {
                var buffer = e.Buffer.Data;
                var length = (int)e.Buffer.Length;

                // Write VBSS socket (screen sharing)
                if (buffer != IntPtr.Zero && length > 0)
                {
                    byte[] managedBuffer = new byte[length];
                    System.Runtime.InteropServices.Marshal.Copy(buffer, managedBuffer, 0, length);
                    _vbssVideoStream.Write(managedBuffer, 0, length);
                }
                e.Buffer.Dispose();
            }
            catch (Exception ex)
            {
                _logger.Error(ex, "Error processing VBSS video media");
            }
        }

        public void Dispose()
        {
            _audioStream?.Dispose();
            _speakerVideoStream?.Dispose();
            _vbssVideoStream?.Dispose();
        }
    }
}
