FROM node:18-bullseye as build

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++ gcc libssl-dev

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy prisma schema
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY tsconfig.json ./
COPY src ./src/

# Build the application
RUN npm run build

# Production stage
FROM node:18-bullseye

WORKDIR /app

# Install required dependencies
RUN apt-get update && apt-get install -y openssl libssl1.1 python3 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy built app
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { timeout: 2000 }; const req = http.request('http://localhost:8080/health', options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

# Set environment variables
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/container/index.js"] 