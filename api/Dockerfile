# Lightweight Bun image (Debian slim)
FROM oven/bun:1.2.23-slim

WORKDIR /app

# Install deps first for better layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "start"]
