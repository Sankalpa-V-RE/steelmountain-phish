FROM node:20-slim

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Install package dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Install ONLY Chromium and its minimal OS dependencies
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Copy app source
COPY . .

CMD ["npm", "start"]