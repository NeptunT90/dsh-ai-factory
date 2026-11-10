FROM node:24-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY dist ./dist
COPY scripts ./scripts

ENV SYNC_HOST=0.0.0.0
ENV SYNC_PORT=8787
ENV SYNC_DB_DIR=/data
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "dist/index.js"]
