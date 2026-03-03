FROM node:20-alpine

WORKDIR /app

# Dépendances production uniquement
COPY package.json ./
RUN npm install --omit=dev

# Code serveur
COPY server.js ./

# Fichiers publics partagés (montés en volume en production, copiés pour image autonome)
COPY --chown=node:node ../shared/public ./public

ENV NODE_ENV=production \
    PORT=3001 \
    BIND_IP=0.0.0.0 \
    SERVER_MODE=docker

EXPOSE 3001

# Healthcheck : vérifie que l'API répond
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/dewicom-discovery || exit 1

USER node
CMD ["node", "server.js"]
