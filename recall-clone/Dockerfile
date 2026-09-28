FROM mcr.microsoft.com/playwright:v1.44.0-focal

# Install the critical media tools: Xvfb, PulseAudio, and FFmpeg
RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /usr/src/app

# Copy package files and install
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Generate a fake video file for the virtual camera to fool Teams packet analysis
RUN ffmpeg -f lavfi -i color=c=blue:s=1280x720:r=30 -t 5 -pix_fmt yuv420p fake_video.y4m

# Make the entrypoint script executable
RUN chmod +x entrypoint.sh

# Start the environment (Xvfb + PulseAudio) before running the Node bot
ENTRYPOINT ["./entrypoint.sh"]
