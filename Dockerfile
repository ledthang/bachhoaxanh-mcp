FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
ENV BHX_RUNTIME_DIR=/runtime
USER pwuser
ENTRYPOINT ["node", "src/server.mjs"]
