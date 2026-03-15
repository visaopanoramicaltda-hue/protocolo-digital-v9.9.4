# Estágio 1: Build da aplicação Angular
FROM node:22-alpine AS build
WORKDIR /app

# Instala dependências
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copia o código fonte e faz o build
COPY . .
RUN npm run build

# Estágio 2: Imagem de Produção
FROM node:22-alpine
WORKDIR /app

# Instala apenas dependências de produção
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copia o build do Angular e o servidor
COPY --from=build /app/dist ./dist
COPY server.js .

# Expõe a porta 8080 (Cloud Run)
EXPOSE 8080

# Inicia o servidor
CMD ["node", "server.js"]
