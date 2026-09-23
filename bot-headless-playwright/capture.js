const { spawn } = require('child_process');
const os = require('os');

function startCapture() {
    console.log('Starting FFmpeg capture pipeline...');

    const isLinux = os.platform() === 'linux';

    // The exact crop dimensions depend on the Teams web layout.
    // For this scaffolding, we demonstrate splitting the screen horizontally.
    const speakerCrop = 'crop=960:540:0:0';
    const screenCrop = 'crop=960:540:0:540';

    const ffmpegCmd = 'ffmpeg';
    
    // Dynamic inputs based on OS
    const videoInput = isLinux 
        ? ['-f', 'x11grab', '-framerate', '30', '-i', ':99.0'] 
        : ['-f', 'gdigrab', '-framerate', '30', '-i', 'desktop'];
        
    // Audio input: Only capture system audio cleanly in Linux/Docker with PulseAudio
    const audioInput = isLinux
        ? ['-f', 'pulse', '-i', 'default']
        : []; 

    const args = [
        '-y', // Overwrite output files
        ...videoInput,
        ...audioInput,
        
        '-filter_complex', `[0:v]split=2[v1][v2];[v1]${speakerCrop}[speaker];[v2]${screenCrop}[shared]`,

        // Output 1: Speaker Video
        '-map', '[speaker]',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-movflags', 'frag_keyframe+empty_moov',
        'speaker_video.mp4',

        // Output 2: Shared Screen
        '-map', '[shared]',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-movflags', 'frag_keyframe+empty_moov',
        'shared_screen.mp4'
    ];
    
    // If we have audio input (Linux), map it to the video files
    if (isLinux) {
        // Map audio to both output files
        args.splice(args.indexOf('speaker_video.mp4'), 0, '-map', '1:a', '-c:a', 'aac');
        args.splice(args.indexOf('shared_screen.mp4'), 0, '-map', '1:a', '-c:a', 'aac');
    }

    const ffmpegProcess = spawn(ffmpegCmd, args);

    ffmpegProcess.stdout.on('data', (data) => {
        // console.log(`ffmpeg stdout: ${data}`);
    });

    ffmpegProcess.stderr.on('data', (data) => {
        console.log(`ffmpeg: ${data}`);
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`ffmpeg process exited with code ${code}`);
    });

    return ffmpegProcess;
}

module.exports = {
    startCapture
};
