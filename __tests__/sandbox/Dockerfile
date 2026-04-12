# EnvCP Sandbox Test Runner
# CIS Docker Benchmark hardened image for E2E testing
# See: https://www.cisecurity.org/benchmark/docker

# Stage 1: Build
FROM node:20-bookworm AS builder

WORKDIR /app
COPY . .

# Install dependencies and build
RUN npm ci --omit=dev && \
    npm run build && \
    npm prune --production

# Stage 2: Runtime (hardened)
FROM node:20-bookworm-slim AS runtime

# CIS 4.1: Create non-root user
RUN groupadd --gid 1000 envcp && \
    useradd --uid 1000 --gid envcp --shell /bin/bash --create-home envcp

# CIS 5.1: Install minimal dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# CIS 4.6: Remove setuid/setgid binaries
RUN find / -perm /6000 -type f -exec chmod a-s {} \; 2>/dev/null || true

WORKDIR /app

# Copy built application from builder
COPY --from=builder --chown=envcp:envcp /app/dist ./dist
COPY --from=builder --chown=envcp:envcp /app/node_modules ./node_modules
COPY --from=builder --chown=envcp:envcp /app/package.json ./
COPY --from=builder --chown=envcp:envcp /app/package-lock.json ./

# Install sandbox test dependencies
COPY --chown=envcp:envcp __tests__/sandbox/package.json ./sandbox/
RUN cd sandbox && npm ci --omit=dev

# CIS 4.2: Set proper permissions
RUN chmod -R 755 /app && \
    chmod 700 /home/envcp

# CIS 5.4: Set secure environment
ENV NODE_ENV=production \
    NPM_CONFIG_CACHE=/tmp/.npm-cache \
    HOME=/home/envcp

# Create tmp directory for sandbox vault (tmpfs will be mounted here)
RUN mkdir -p /tmp/envcp-sandbox && \
    chown envcp:envcp /tmp/envcp-sandbox && \
    chmod 700 /tmp/envcp-sandbox

# CIS 4.1: Switch to non-root user
USER envcp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Default entrypoint
ENTRYPOINT ["node", "--no-warnings", "/app/sandbox/sandbox-runner.js"]
CMD ["--help"]
