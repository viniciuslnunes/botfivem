# Uma imagem por versão do bot; a torcida é escolhida em tempo de execução
# (TENANT + TENANTS_DIR), então a mesma imagem serve a todas.
#
#   docker build -t botfivem .
#   docker run --env-file .env -e TENANT=mancha-verde -e TENANTS_DIR=/tenants \
#     -v /caminho/dos/tenants:/tenants:ro -p 8080:8080 botfivem
#
# NÃO VERIFICADO: escrito sem daemon do Docker disponível na máquina de
# desenvolvimento. Rode `docker build` e `docker run … node tools/carregar-tudo.js`
# uma vez antes de confiar (confere as bibliotecas do canvas na imagem).
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HEALTH_PORT=8080 \
    LOG_FORMATO=json

WORKDIR /app

# node-canvas (carteirinha e gráficos): o binário pré-compilado precisa destas
# bibliotecas de sistema em tempo de execução.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Processo sem root
USER node

EXPOSE 8080
# 200 = banco respondendo e Discord conectado; 503 = degradado (o orquestrador reinicia)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.HEALTH_PORT+'/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
