# ── Build stage ──────────────────────────────────────────
FROM node:24-slim AS builder

WORKDIR /app

# Install dependencies first for layer caching
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json vite.config.ts vitest.config.ts ./
COPY src/ src/
COPY ui/ ui/

RUN npm run build

# ── Production stage ─────────────────────────────────────
FROM node:24-slim AS production

# Run as non-root
RUN groupadd -r echodeck && useradd -r -g echodeck -m echodeck

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy built output
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/dist-ui/ dist-ui/

# Data directory — mount a volume here for persistence
# Example: docker run -v ./data:/app/data echodeck
RUN mkdir -p /app/data && chown echodeck:echodeck /app/data
ENV DATA_FILE=/app/data/echodeck.json

# Switch to non-root user
USER echodeck

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
