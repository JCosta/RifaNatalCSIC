FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV DB_PATH=/app/data/rifas.db
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
