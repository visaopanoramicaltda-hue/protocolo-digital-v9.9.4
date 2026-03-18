# ============================================================
# Estágio 1: Build Angular PWA
# ============================================================
FROM node:22-alpine AS build
WORKDIR /app

# Instala dependências com legacy-peer-deps para evitar conflitos
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copia código-fonte e compila
COPY . .
RUN npm run build -- --configuration=production

# ============================================================
# Estágio 2: Imagem de Produção leve
# ============================================================
FROM node:22-alpine
WORKDIR /app

# Apenas dependências de produção (sem Angular build tools)
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copia build do Angular e servidor
COPY --from=build /app/dist ./dist
COPY server.js .

# Cloud Run usa a variável PORT (padrão 8080)
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/ || exit 1

CMD ["node", "server.js"]
