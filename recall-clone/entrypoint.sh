#!/bin/bash
# Start a virtual audio sink using PulseAudio
pulseaudio -D --exit-idle-time=-1
pacmd load-module module-virtual-sink sink_name=v1

# Start the virtual display (monitor) using Xvfb on display port 99
Xvfb :99 -screen 0 1920x1080x24 -ac &
export DISPLAY=:99

# Give Xvfb and PulseAudio a second to initialize
sleep 2

# Run the node app
node index.js
