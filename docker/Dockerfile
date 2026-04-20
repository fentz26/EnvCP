FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS runtime

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY dist/ ./dist/
COPY scripts/ ./scripts/
COPY README.md LICENSE ./

RUN mkdir -p /data

ENV NODE_ENV=production
ENV ENCP_DATA_DIR=/data

EXPOSE 3456

CMD ["node", "dist/index.js"]
