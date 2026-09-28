# FFmpeg Installation Guide

This project requires FFmpeg to convert WebM recordings to MP4 format.

## Windows Installation

### Option 1: Using Chocolatey (Recommended)
```bash
choco install ffmpeg
```

### Option 2: Manual Installation
1. Download FFmpeg from: https://www.gyan.dev/ffmpeg/builds/
2. Extract the zip file
3. Add the `bin` folder to your PATH environment variable
4. Verify installation: `ffmpeg -version`

### Option 3: Using Scoop
```bash
scoop install ffmpeg
```

## Linux Installation

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install ffmpeg
```

### Fedora
```bash
sudo dnf install ffmpeg
```

### Arch Linux
```bash
sudo pacman -S ffmpeg
```

## macOS Installation

### Using Homebrew
```bash
brew install ffmpeg
```

## Verify Installation

After installation, verify FFmpeg is working:
```bash
ffmpeg -version
```

You should see version information if FFmpeg is correctly installed.

## Troubleshooting

If you get "ffmpeg not found" errors:
1. Make sure FFmpeg is in your system PATH
2. Restart your terminal/command prompt
3. On Windows, you may need to restart your computer after adding to PATH
