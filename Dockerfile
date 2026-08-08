FROM node:20-alpine

WORKDIR /app

# Zero runtime dependencies — just copy source.
COPY package*.json ./
COPY scraper.js server.js store.js export.js ./
COPY public ./public

RUN mkdir -p data/daily data/raw

EXPOSE 3000

CMD ["node", "server.js"]
