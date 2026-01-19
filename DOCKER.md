# Docker Deployment Guide

## Быстрый старт

### Production режим

1. Скопируйте `.env.example` в `.env` и настройте переменные окружения:
```bash
cp .env.example .env
# Отредактируйте .env файл
```

2. Запустите все сервисы:
```bash
docker-compose up -d
```

3. Проверьте статус:
```bash
docker-compose ps
```

4. Просмотрите логи:
```bash
docker-compose logs -f
```

### Development режим

Для разработки с hot reload:
```bash
docker-compose -f docker-compose.dev.yml up
```

## Структура сервисов

- **Frontend** (порт по умолчанию 3000): React приложение, обслуживается через nginx
- **Backend** (порт по умолчанию 5000): Node.js/Express API сервер
- **Analyz** (порт по умолчанию 5050): Flask сервис для анализа данных

**Примечание:** Все порты настраиваются через переменные окружения в файле `.env`

## Переменные окружения

Создайте файл `.env` в корне проекта на основе `.env.example`:

```env
# Порты (измените, если они заняты)
FRONTEND_PORT=3000
BACKEND_PORT=5000
ANALYZ_PORT=5050

# Backend
SESSION_SECRET=your-secret-key-here
FRONTEND_URL=http://localhost:3000

# Analyz
FLASK_SECRET_KEY=your-secret-key-here
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
```

### Настройка портов

Если порты по умолчанию заняты, измените их в файле `.env`:

```env
# Например, если порт 3000 занят, используйте 3001
FRONTEND_PORT=3001
BACKEND_PORT=5001
ANALYZ_PORT=5051

# Важно: также обновите FRONTEND_URL и ANALYZ_SERVICE_URL
FRONTEND_URL=http://localhost:3001
ANALYZ_SERVICE_URL=http://localhost:5051
```

После изменения портов перезапустите контейнеры:
```bash
docker-compose down
docker-compose up -d
```

**Важно:** При изменении `FRONTEND_PORT` также обновите `FRONTEND_URL` в `.env` файле, чтобы backend знал правильный адрес frontend.

## Команды

### Запуск
```bash
# Production
docker-compose up -d

# Development
docker-compose -f docker-compose.dev.yml up
```

### Остановка
```bash
docker-compose down
```

### Пересборка
```bash
docker-compose build --no-cache
docker-compose up -d
```

### Просмотр логов
```bash
# Все сервисы
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f analyz
```

### Выполнение команд в контейнере
```bash
# Backend
docker-compose exec backend sh

# Frontend
docker-compose exec frontend sh

# Analyz
docker-compose exec analyz bash
```

## Volumes (данные)

Данные сохраняются в следующих директориях:
- `./backend/database.db` - база данных backend
- `./backend/uploads` - загруженные файлы
- `./Analyz/data_days` - данные аналитики
- `./Analyz/database.sqlite3` - база данных analyz
- `./backend/logs` и `./Analyz/logs` - логи

## Обновление

1. Остановите контейнеры:
```bash
docker-compose down
```

2. Обновите код (git pull)

3. Пересоберите и запустите:
```bash
docker-compose build
docker-compose up -d
```

## Troubleshooting

### Проблемы с портами
Если порты заняты, измените их в файле `.env`:
```env
FRONTEND_PORT=3001
BACKEND_PORT=5001
ANALYZ_PORT=5051
```

Затем перезапустите контейнеры:
```bash
docker-compose down
docker-compose up -d
```

### Проблемы с правами доступа
На Linux может потребоваться:
```bash
sudo chown -R $USER:$USER ./backend/database.db
sudo chown -R $USER:$USER ./Analyz/data_days
```

### Очистка
Удалить все контейнеры и volumes:
```bash
docker-compose down -v
docker system prune -a
```

