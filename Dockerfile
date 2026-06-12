FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY assets/ ./assets/

EXPOSE 3000

CMD ["node", "src/index.js"]
