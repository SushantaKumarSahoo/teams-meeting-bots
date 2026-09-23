FROM mcr.microsoft.com/playwright:v1.50.0-noble

# Install required packages for audio/video capture
RUN apt-get update && apt-get install -y \
    ffmpeg \
    xvfb \
    pulseaudio \
    dbus \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user (recommended for Playwright, but we'll use root/pwuser depending on image)
# The playwright image comes with 'pwuser'. Let's switch to it.
USER pwuser

WORKDIR /app

# Copy package.json and install dependencies
COPY --chown=pwuser:pwuser package*.json ./
RUN npm install

# Playwright needs root privileges to install missing system dependencies for Edge
USER root
RUN npx playwright install --with-deps msedge
USER pwuser

# Copy application files
COPY --chown=pwuser:pwuser index.js capture.js ./

# We need a script to start dbus, pulseaudio, xvfb, and then node
USER root
RUN echo '#!/bin/bash\n\
# Start DBus\n\
/etc/init.d/dbus start\n\
\n\
# Start PulseAudio with a null sink\n\
pulseaudio -D --exit-idle-time=-1\n\
pacmd load-module module-virtual-sink sink_name=v1\n\
pacmd set-default-sink v1\n\
pacmd set-default-source v1.monitor\n\
\n\
# Start Xvfb\n\
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &\n\
export DISPLAY=:99\n\
\n\
# Start the Node application\n\
node index.js\n\
' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

USER pwuser

# Ensure environment variables can be passed
ENV MEETING_URL=""

ENTRYPOINT ["/bin/bash", "/app/entrypoint.sh"]
