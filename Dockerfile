# Stage 1: build native deps (better-sqlite3 requires compilation)
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: lean runtime image
FROM node:20-alpine
ARG BUILD_DATE
ARG VERSION
RUN apk add --no-cache su-exec
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src/ ./src/
COPY icon.png ./icon.png
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh \
    && chmod +x /entrypoint.sh \
    && mkdir -p /app/data /app/uploads
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.title="Easy Uploader"
LABEL org.opencontainers.image.description="Self-hosted file and photo sharing app. Create password-protected share links for guests to upload files directly to your server."
LABEL org.opencontainers.image.url="https://github.com/DevlinDelFuego/Easy-Uploader"
LABEL org.opencontainers.image.source="https://github.com/DevlinDelFuego/Easy-Uploader"
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
