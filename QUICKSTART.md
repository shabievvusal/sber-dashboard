# 🚀 Быстрый старт

## Docker (Рекомендуется)

### 1. Клонируйте репозиторий
```bash
git clone <repository-url>
cd vusal2
```

### 2. Настройте переменные окружения
```bash
cp .env.example .env
# Отредактируйте .env файл при необходимости
# Особенно важно проверить порты, если они заняты:
# FRONTEND_PORT=3000
# BACKEND_PORT=5000
# ANALYZ_PORT=5050
```

### 3. Запустите приложение
```bash
# Production
docker-compose up -d

# Или Development (с hot reload)
docker-compose -f docker-compose.dev.yml up
```

### 4. Откройте в браузере
- Frontend: http://localhost:${FRONTEND_PORT:-3000}
- Backend API: http://localhost:${BACKEND_PORT:-5000}
- Analyz: http://localhost:${ANALYZ_PORT:-5050}

**Примечание:** Порты можно изменить в файле `.env`, если они заняты.

### 5. Войдите в систему
- **Администратор**: `admin` / `admin123`
- **Оператор**: `operator` / `operator123`

## Локальная установка (без Docker)

### 1. Установите зависимости
```bash
# Node.js зависимости
npm install
cd frontend && npm install && cd ..
cd backend && npm install && cd ..

# Python зависимости
cd Analyz
pip install -r requirements.txt
cd ..
```

### 2. Запустите приложение
```bash
# Backend (терминал 1)
cd backend
npm run dev

# Frontend (терминал 2)
cd frontend
npm run dev

# Analyz (терминал 3)
cd Analyz
python app.py
```

## Полезные команды

### Docker
```bash
# Просмотр логов
docker-compose logs -f

# Остановка
docker-compose down

# Перезапуск
docker-compose restart

# Использование Makefile (Linux/Mac)
make help        # Список команд
make up          # Запуск
make logs        # Логи
make down        # Остановка
```

### Локально
```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev

# Analyz
cd Analyz && python app.py
```

## Структура проекта

```
vusal2/
├── frontend/        # React приложение
├── backend/         # Node.js API
├── Analyz/          # Flask сервис аналитики
├── docker-compose.yml
└── .env.example
```

## Документация

- [README.md](README.md) - Основная документация
- [DOCKER.md](DOCKER.md) - Подробная инструкция по Docker
- [INSTALL.md](INSTALL.md) - Детальная установка
- [DEPLOY.md](DEPLOY.md) - Деплой на сервер

