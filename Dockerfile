# Railway Howard — OpenClaw Gateway (no wrapper, direct access)
FROM node:24-slim

# Install OpenClaw (latest version)
RUN npm install -g openclaw

# Create directories
RUN mkdir -p /data/.openclaw /seed-workspace

# Copy config file (seeds the state dir on first run via bootstrap)
COPY openclaw.json /seed-config/openclaw.json

# Copy workspace seed files (personality, memory, identity)
# These go to /seed-workspace/ so they aren't hidden by the Railway volume at /data
COPY workspace/ /seed-workspace/

# Bootstrap script — seeds volume on first run, then starts gateway
COPY bootstrap.sh /bootstrap.sh
RUN chmod +x /bootstrap.sh

# Railway's HTTP proxy connects here
EXPOSE 8080

CMD ["/bootstrap.sh"]
