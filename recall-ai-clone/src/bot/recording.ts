import fs from 'fs';
import path from 'path';
import { Page } from 'playwright';
import { Logger } from '../lib/logger';
import ffmpeg from 'fluent-ffmpeg';

/**
 * Captures audio+video directly from WebRTC MediaStreamTracks by patching
 * RTCPeerConnection inside the page before Teams JS runs.
 *
 * Chunk delivery path:
 *   MediaRecorder.ondataavailable
 *     → Blob.arrayBuffer()          (native Promise, no FileReader race)
 *     → page.exposeFunction          (IPC directly into Node)
 *     → fs.WriteStream               (written to disk)
 *
 * Output: output/recordings/<botId>.webm  (VP9+Opus or VP8+Opus)
 */
export class RecordingProcedure {
  private logger: Logger;
  private botId: string;
  private page: Page;
  private outputPath: string;
  private mp4OutputPath: string;
  private fileStream: fs.WriteStream | null = null;
  private bytesWritten = 0;

  constructor(args: { botId: string; page: Page }) {
    this.botId = args.botId;
    this.page = args.page;
    this.logger = new Logger({ botId: args.botId, source: 'recording' });

    const dir = path.resolve('output/recordings');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.outputPath = path.join(dir, `${args.botId}.webm`);
    this.mp4OutputPath = path.join(dir, `${args.botId}.mp4`);
  }

  /**
   * Must be called FIRST — opens the file and exposes the IPC function
   * before page.goto() so no chunks are missed.
   */
  public async prepare(): Promise<void> {
    // Open the main recording file
    this.fileStream = fs.createWriteStream(this.outputPath, { flags: 'w' });
    this.logger.info(`Recording file opened: ${this.outputPath}`);

    // Expose chunk receiver for composite recording (camera + screen share PiP)
    await this.page.exposeFunction(
      '__recorderChunk__',
      (bytes: number[]) => {
        if (!this.fileStream || bytes.length === 0) return;
        const buf = Buffer.from(bytes);
        this.fileStream.write(buf);
        this.bytesWritten += buf.byteLength;
      }
    );

    await this.page.exposeFunction('__recorderLog__', (msg: string) => {
      this.logger.info('PAGE: ' + msg);
    });
  }

  /**
   * Inject the RTCPeerConnection patch.
   * Must be called after prepare() and before page.goto().
   */
  public async injectInterceptor(): Promise<void> {
    this.logger.info('Injecting WebRTC stream interceptor...');

    await this.page.addInitScript(() => {
      let mainRecorder: MediaRecorder | null = null;
      let mainCanvas: HTMLCanvasElement | null = null;
      let mainAnimationFrame: number | null = null;
      let isRecording = false;
      let audioContext: AudioContext | null = null;
      let audioSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
      let lastVideoCount = 0;
      let debounceTimer: number | null = null;

      function log(msg: string) {
        (window as any).__recorderLog__(msg);
      }

      function stopRecorder(recorder: MediaRecorder | null) {
        if (recorder && recorder.state !== 'inactive') {
          try { recorder.stop(); } catch {}
        }
        return null;
      }

      function startCanvasRecording() {
        // Prevent multiple simultaneous starts
        if (isRecording) {
          log('Already recording, skipping restart');
          return;
        }

        // ─── Find ALL video elements (including hidden ones) ────────────────
        // IMPORTANT: Don't filter by visibility - Teams hides camera when screen sharing
        const allVideoElements = Array.from(document.querySelectorAll('video'));
        log(`Total video elements in DOM: ${allVideoElements.length}`);
        
        // Check if there are unready videos (might be screen share loading)
        const unreadyVideos = allVideoElements.filter(v => v.videoWidth === 0 || v.videoHeight === 0 || v.readyState < 2);
        
        if (unreadyVideos.length > 0 && allVideoElements.length > 1) {
          // Multiple videos exist but some aren't ready yet - likely screen share loading
          log(`Waiting for ${unreadyVideos.length} video(s) to load (likely screen share)...`);
          isRecording = false;
          setTimeout(startCanvasRecording, 500); // Retry in 500ms (reduced from 1s)
          return;
        }
        
        const allVideos = allVideoElements.filter(v => {
          const isValid = v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2;
          if (!isValid) {
            log(`Filtered out video: ${v.videoWidth}x${v.videoHeight}, readyState=${v.readyState}`);
          }
          return isValid;
        });

        if (allVideos.length === 0) {
          log('No video elements found yet, will retry...');
          isRecording = false;
          setTimeout(startCanvasRecording, 2000);
          return;
        }

        log(`Found ${allVideos.length} video elements (including hidden)`);

        // ─── Identify screen share vs camera videos ─────────────────────────
        // IMPORTANT: Ignore videos in the lobby/prejoin area (data-tid="prejoin-local-video-renderer")
        // Only consider videos in the actual meeting stage
        
        const lobbyVideos = allVideos.filter(v => {
          const closest = v.closest('[data-tid*="prejoin"], [data-tid*="lobby"], [class*="prejoin" i], [class*="lobby" i]');
          return closest !== null;
        });
        
        const meetingVideos = allVideos.filter(v => !lobbyVideos.includes(v));
        
        if (meetingVideos.length === 0 && lobbyVideos.length > 0) {
          log(`Only lobby videos found (${lobbyVideos.length}), waiting for meeting to start...`);
          isRecording = false;
          setTimeout(startCanvasRecording, 2000);
          return;
        }

        // Screen share detection:
        // 1. Videos with parent-tid="calling-stream" are the main screen share
        // 2. Other large videos (>= 1280x720) without screen attributes are camera feeds
        // 3. Small videos (< 640x360) are always cameras
        const screenVideos = meetingVideos.filter(v => {
          const parentTid = v.closest('[data-tid]')?.getAttribute('data-tid') || '';
          const hasScreenAttribute = 
            parentTid.includes('screen') ||
            v.closest('[class*="ScreenShare" i]') !== null ||
            v.closest('[aria-label*="screen" i]') !== null;
          
          // Explicit screen share markers (calling-stream is the main screen)
          const isExplicitScreen = parentTid === 'calling-stream' || hasScreenAttribute;
          
          // Only treat as screen if explicitly marked OR very large (>= 1920x1080)
          const isVeryLarge = v.videoWidth >= 1920 && v.videoHeight >= 1080;
          
          return isExplicitScreen || isVeryLarge;
        });

        const cameraVideos = meetingVideos.filter(v => !screenVideos.includes(v));

        // Pick the primary camera video (usually the largest or first in gallery)
        const primaryCamera = cameraVideos.sort((a, b) => 
          (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight)
        )[0];

        // Pick the primary screen (prefer calling-stream, then largest)
        const primaryScreen = screenVideos.sort((a, b) => {
          const aTid = a.closest('[data-tid]')?.getAttribute('data-tid') || '';
          const bTid = b.closest('[data-tid]')?.getAttribute('data-tid') || '';
          // Prioritize calling-stream
          if (aTid === 'calling-stream' && bTid !== 'calling-stream') return -1;
          if (bTid === 'calling-stream' && aTid !== 'calling-stream') return 1;
          // Otherwise sort by size
          return (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight);
        })[0];

        log(`Detected: cameras=${cameraVideos.length} (${cameraVideos.map(v => v.videoWidth + 'x' + v.videoHeight).join(', ')}), screens=${screenVideos.length} (${screenVideos.map(v => v.videoWidth + 'x' + v.videoHeight).join(', ')})`);

        // Debugging: Log video element attributes for analysis
        meetingVideos.forEach((v, i) => {
          const parent = v.closest('[data-tid], [class]');
          const parentTid = parent?.getAttribute('data-tid') || 'none';
          const parentClass = parent?.getAttribute('class') || 'none';
          const isScreen = screenVideos.includes(v);
          const isCamera = cameraVideos.includes(v);
          log(`Video ${i}: ${v.videoWidth}x${v.videoHeight}, readyState=${v.readyState}, paused=${v.paused}, muted=${v.muted}, parent-tid="${parentTid.slice(0, 50)}", parent-class="${parentClass.slice(0, 50)}", classified=${isScreen ? 'SCREEN' : (isCamera ? 'CAMERA' : 'UNKNOWN')}`);
        });

        // ─── Main recorder: Composite canvas (screen + camera PiP) ─────────
        // If there's a screen share, composite screen + camera. Otherwise just camera.
        const hasScreen = primaryScreen !== undefined;
        const hasCam = primaryCamera !== undefined;
        const baseVideo = hasScreen ? primaryScreen : primaryCamera;
        
        if (baseVideo) {
          log(`Canvas: ${baseVideo.videoWidth}x${baseVideo.videoHeight}, base=${hasScreen ? 'screen' : 'camera'}, hasCam=${hasCam}, hasScreen=${hasScreen}`);
          // Stop existing recorder and animation frame
          mainRecorder = stopRecorder(mainRecorder);
          if (mainAnimationFrame) cancelAnimationFrame(mainAnimationFrame);
          
          // Create canvas matching the base video (screen if available, else camera)
          if (!mainCanvas) {
            mainCanvas = document.createElement('canvas');
          }
          mainCanvas.width = baseVideo.videoWidth;
          mainCanvas.height = baseVideo.videoHeight;
          
          const ctx = mainCanvas.getContext('2d')!;
          
          log(`Main canvas created: ${mainCanvas.width}x${mainCanvas.height} (screen=${hasScreen})`);

          // Store reference to camera for PiP (must be outside drawMainFrame closure)
          let pipCamera: HTMLVideoElement | null = hasScreen && primaryCamera ? primaryCamera : null;
          
          // Draw video frames to canvas continuously with PiP if both exist
          function drawMainFrame() {
            if (!mainCanvas || !baseVideo) return;
            
            // Draw the base (screen share or camera)
            ctx.drawImage(baseVideo, 0, 0, mainCanvas.width, mainCanvas.height);
            
            // If we have both screen and camera, draw camera as PiP in bottom-right
            if (pipCamera && pipCamera.readyState >= 2 && pipCamera.videoWidth > 0) {
              const pipWidth = Math.floor(mainCanvas.width * 0.25); // 25% of screen width
              const pipHeight = Math.floor((pipCamera.videoHeight / pipCamera.videoWidth) * pipWidth);
              const pipX = mainCanvas.width - pipWidth - 20; // 20px margin from right
              const pipY = mainCanvas.height - pipHeight - 20; // 20px margin from bottom
              
              // Draw semi-transparent shadow behind PiP
              ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
              ctx.fillRect(pipX - 4, pipY - 4, pipWidth + 8, pipHeight + 8);
              
              // Draw white border around PiP
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 4;
              ctx.strokeRect(pipX - 2, pipY - 2, pipWidth + 4, pipHeight + 4);
              
              // Draw camera feed
              try {
                ctx.drawImage(pipCamera, pipX, pipY, pipWidth, pipHeight);
              } catch (e) {
                log(`PiP draw error: ${e}`);
              }
            }
            
            mainAnimationFrame = requestAnimationFrame(drawMainFrame);
          }
          drawMainFrame();
          
          if (pipCamera) {
            log(`PiP enabled: camera ${pipCamera.videoWidth}x${pipCamera.videoHeight} overlaid on screen`);
          }

          // Capture stream from canvas at 30fps
          const canvasStream = mainCanvas.captureStream(30);
          
          // Add audio - create AudioContext once, reuse audio sources
          if (!audioContext) {
            audioContext = new AudioContext();
          }
          
          const destination = audioContext.createMediaStreamDestination();
          
          // Capture audio from ALL video elements with audio tracks
          [...cameraVideos, ...screenVideos].forEach(v => {
            if (!v.srcObject) return;
            
            try {
              let source = audioSources.get(v);
              if (!source) {
                source = audioContext!.createMediaElementSource(v);
                audioSources.set(v, source);
                log(`Created audio source for video element`);
              }
              source.connect(destination);
            } catch (err) {
              // Already connected or error - just skip
              log(`Audio source reuse: ${String(err).slice(0, 50)}`);
            }
          });

          const audioTrack = destination.stream.getAudioTracks()[0];
          if (audioTrack) {
            canvasStream.addTrack(audioTrack);
            log('Audio track added to canvas stream');
          }

          const mimeType = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
          ].find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

          log(`Starting MAIN canvas recorder`);

          try {
            mainRecorder = new MediaRecorder(canvasStream, {
              mimeType,
              videoBitsPerSecond: 2_500_000,
              audioBitsPerSecond: 128_000,
            });

            mainRecorder.ondataavailable = async (e: BlobEvent) => {
              if (!e.data || e.data.size === 0) return;
              try {
                const ab = await e.data.arrayBuffer();
                const bytes = Array.from(new Uint8Array(ab));
                (window as any).__recorderChunk__(bytes);
                log(`MAIN chunk: ${bytes.length} bytes`);
              } catch (err) {
                log(`MAIN chunk error: ${String(err)}`);
              }
            };

            mainRecorder.onerror = (e: Event) => {
              log(`MAIN recorder error: ${(e as any).error?.message ?? String(e)}`);
            };

            mainRecorder.onstart = () => {
              log('MAIN canvas recorder started (composite view)');
              isRecording = true;
            };
            mainRecorder.start(1000);
          } catch (err) {
            log(`Failed to create MAIN recorder: ${String(err)}`);
            isRecording = false;
          }
        } else {
          log('No valid video source found');
          isRecording = false;
        }
      }

      // Expose restart function for orchestrator
      (window as any).__restartRecorder__ = () => {
        log('__restartRecorder__ called - starting canvas capture');
        isRecording = false; // Allow restart from orchestrator
        startCanvasRecording();
      };

      // Monitor DOM for video element changes with debouncing
      const observer = new MutationObserver(() => {
        // Debounce - only trigger after changes stop for 300ms (reduced for faster response)
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
          const currentVideos = document.querySelectorAll('video').length;
          if (currentVideos !== lastVideoCount) {
            log(`Video count changed: ${lastVideoCount} → ${currentVideos}`);
            lastVideoCount = currentVideos;
            isRecording = false;
            startCanvasRecording();
          }
        }, 300);
      });

      // Wait for DOM to be ready before observing
      if (document.body) {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
        log('DOM observer active - will detect new video elements');
      } else {
        window.addEventListener('DOMContentLoaded', () => {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
          });
          log('DOM observer active - will detect new video elements');
        });
      }
    });

    this.logger.info('WebRTC interceptor injected');
  }

  public stop(): Promise<string> {
    return new Promise((resolve, reject) => {
      // Give 4s for any in-flight arrayBuffer() Promises inside the page to finish
      setTimeout(() => {
        if (!this.fileStream) {
          return this.bytesWritten > 0
            ? resolve(this.outputPath)
            : reject(new Error('No recording file'));
        }

        this.fileStream.end(() => {
          this.logger.info(
            `Recording saved: ${this.outputPath} (${(this.bytesWritten / 1024 / 1024).toFixed(2)} MB)`
          );
          
          if (this.bytesWritten === 0) {
            reject(new Error('Recording file is empty — no WebRTC chunks received'));
            return;
          }

          // Convert WebM to MP4 for better compatibility
          this.logger.info('Converting WebM to MP4...');
          
          ffmpeg(this.outputPath)
            .outputOptions([
              '-c:v libx264',        // H.264 video codec
              '-preset fast',        // Encoding speed/quality tradeoff
              '-crf 23',            // Constant Rate Factor (quality: 0-51, lower=better)
              '-c:a aac',           // AAC audio codec
              '-b:a 128k',          // Audio bitrate
              '-movflags +faststart' // Enable streaming/progressive download
            ])
            .output(this.mp4OutputPath)
            .on('start', (cmd: string) => {
              this.logger.info(`FFmpeg command: ${cmd}`);
            })
            .on('progress', (progress: { percent?: number }) => {
              if (progress.percent) {
                this.logger.info(`Conversion progress: ${progress.percent.toFixed(1)}%`);
              }
            })
            .on('end', () => {
              const mp4Size = fs.statSync(this.mp4OutputPath).size;
              this.logger.info(
                `MP4 conversion complete: ${this.mp4OutputPath} (${(mp4Size / 1024 / 1024).toFixed(2)} MB)`
              );
              
              // Delete the WebM file to save space
              try {
                fs.unlinkSync(this.outputPath);
                this.logger.info('Original WebM file deleted');
              } catch (err) {
                this.logger.warn('Failed to delete WebM file', err);
              }
              
              resolve(this.mp4OutputPath);
            })
            .on('error', (err: Error) => {
              this.logger.error('FFmpeg conversion failed', err);
              // Return WebM file as fallback
              resolve(this.outputPath);
            })
            .run();
        });
      }, 4000);
    });
  }

  public getOutputPath(): string { return this.outputPath; }
  public getBytesWritten(): number { return this.bytesWritten; }
}
