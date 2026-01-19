# Frontend Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package файлы
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.node.json ./
COPY vite.config.ts ./
COPY tailwind.config.js ./
COPY postcss.config.js ./

# Устанавливаем зависимости
RUN npm ci

# Копируем исходный код
COPY public ./public
COPY src ./src
COPY index.html ./

# Собираем проект
RUN npm run build

# Production образ с nginx
FROM nginx:alpine

# Копируем собранные файлы
COPY --from=builder /app/dist /usr/share/nginx/html

# Копируем конфигурацию nginx (если нужна)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Открываем порт
EXPOSE 80

# Запуск nginx
CMD ["nginx", "-g", "daemon off;"]

