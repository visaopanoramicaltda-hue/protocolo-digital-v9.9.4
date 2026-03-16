# Estágio 1: Build da aplicação Angular
FROM node:22-alpine AS build
WORKDIR /app

# Instala dependências
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copia o código fonte e faz o build
COPY . .
RUN npm run build

# Estágio 2: Servir com Nginx Alpine
FROM nginx:alpine

# Remove a configuração padrão do Nginx
RUN rm /etc/nginx/conf.d/default.conf

# Copia a configuração customizada do Nginx (salva na raiz do projeto)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia os arquivos do build do Angular para o diretório do Nginx
# Angular 17+ com outputPath "./dist" gera os arquivos em dist/browser/
COPY --from=build /app/dist/browser /usr/share/nginx/html

# Cloud Run usa a porta 8080 por padrão
EXPOSE 8080

# Inicia o Nginx em modo foreground (obrigatório para containers)
CMD ["nginx", "-g", "daemon off;"]
