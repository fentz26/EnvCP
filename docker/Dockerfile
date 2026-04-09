FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built files
COPY dist/ ./dist/
COPY scripts/ ./scripts/
COPY README.md LICENSE ./

# Create data directory
RUN mkdir -p /data

# Set environment
ENV NODE_ENV=production
ENV ENCP_DATA_DIR=/data

# Expose ports (REST API, MCP stdio doesn't need port)
EXPOSE 3456

# Default to MCP serve mode
CMD ["node", "dist/index.js"]
