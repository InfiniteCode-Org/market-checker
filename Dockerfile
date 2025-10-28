FROM public.ecr.aws/docker/library/node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy built container service code
COPY dist/container ./dist/container
COPY dist/shared ./dist/shared

# Set environment to production
ENV NODE_ENV=production

# Run the price monitor service
CMD ["node", "dist/container/index.js"] 