FROM node:20-alpine

WORKDIR /app

# Chromium for the slot-preview screenshot capture (lib/slot-preview.js).
# Puppeteer's own bundled Chromium is a glibc build and does not run on
# Alpine's musl libc — Alpine's own apk chromium package is required
# instead. puppeteer-core (not puppeteer) is used so npm install never
# attempts to download the incompatible bundled binary in the first place.
RUN apk add --no-cache chromium nss freetype freetype-dev harfbuzz ca-certificates ttf-freefont

COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY . .

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

CMD ["node", "server.js"]
