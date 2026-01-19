# Backend Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package файлы
COPY package*.json ./
COPY tsconfig.json ./

# Устанавливаем зависимости
RUN npm ci

# Копируем исходный код
COPY src ./src

# Собираем проект
RUN npm run build

# Production образ
FROM node:20-alpine

WORKDIR /app

# Копируем package файлы для production зависимостей
COPY package*.json ./

# Устанавливаем только production зависимости
RUN npm ci --only=production

# Копируем собранный код из builder
COPY --from=builder /app/dist ./dist

# Создаем директории для данных
RUN mkdir -p uploads/employee_photos logs

# Открываем порт
EXPOSE 5000

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=5000

# Запуск приложения
CMD ["node", "dist/index.js"]

