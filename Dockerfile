FROM node:20-alpine

WORKDIR /app

# Copy package files and install all dependencies for running TS scripts
COPY package*.json ./
RUN npm install

# Copy built application output and source files
COPY .output ./.output
COPY server ./server
COPY public ./public

# Environment variables (PORT is overridden by docker-compose from .env)
ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE ${PORT:-54432}

# Auto-initialize & seed MySQL database then start production server
CMD sh -c "npx tsx server/db/init.ts && npx tsx server/db/seed.ts && node .output/server/index.mjs"
