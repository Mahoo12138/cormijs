# Validation image only; no application source or host dependency tree is baked in.
FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ca-certificates git procps \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --global --ignore-scripts pnpm@10.6.3 \
 && mkdir -p /home/node/work \
 && chown node:node /home/node/work
# The Chinese example must render actual glyphs, not fallback boxes in screenshots.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*
ENV CI=true CORMI_BROWSER_EXECUTABLE=/usr/bin/chromium
USER node
WORKDIR /home/node/work
CMD ["sleep", "infinity"]
