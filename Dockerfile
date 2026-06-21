# Railway Howard — OpenClaw Gateway (no wrapper, direct access)
FROM node:24-slim

# Install OpenClaw (pinned version) + curl + jq for ZINN service calls
RUN apt-get update -qq && apt-get install -y -qq curl jq && rm -rf /var/lib/apt/lists/*
RUN npm install -g openclaw@2026.5.20

# Create directories
RUN mkdir -p /data/.openclaw /seed-workspace /seed-config

# Copy config file
COPY openclaw.json /seed-config/openclaw.json

# Copy workspace seed files
COPY workspace/ /seed-workspace/

# Copy parse-lead AI server
COPY parse-lead-server.js /parse-lead-server.js

# Bootstrap, auto-approve, backup, and workspace sync scripts
COPY bootstrap.sh /bootstrap.sh
COPY auto-approve.sh /auto-approve.sh
COPY dropbox_backup.sh /dropbox_backup.sh
COPY workspace_sync.sh /workspace_sync.sh
RUN chmod +x /bootstrap.sh /auto-approve.sh /dropbox_backup.sh /workspace_sync.sh

EXPOSE 8080

CMD ["/bootstrap.sh"]
