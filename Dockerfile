# Stage 1: build native deps (better-sqlite3 requires compilation)
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: lean runtime image
FROM node:20-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src/ ./src/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
    && mkdir -p /app/data /app/uploads
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
