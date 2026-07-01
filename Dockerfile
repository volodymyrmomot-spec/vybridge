FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY . .

ENV NODE_ENV=production

CMD ["node", "server.js"]
