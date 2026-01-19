# Инструкция по деплою OPS на хостинг

## Подготовка к деплою

### 1. Сборка проекта

#### Сборка Frontend

```bash
cd frontend
npm run build
```

Собранные файлы будут в папке `frontend/dist/`

#### Сборка Backend

```bash
cd backend
npm run build
```

Скомпилированный код будет в папке `backend/dist/`

### 2. Проверка сборки

```bash
# Проверка Frontend
cd frontend
npm run preview

# Проверка Backend
cd backend
node dist/index.js
```

## Варианты деплоя

### Вариант 1: VPS/Сервер (Linux)

#### Требования

- Ubuntu 20.04+ / Debian 11+ / CentOS 8+
- Node.js 18+
- Python 3.8+
- Nginx (рекомендуется)
- PM2 для управления процессами (рекомендуется)

#### Установка зависимостей на сервере

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка Node.js (рекомендуется через NodeSource)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Альтернатива: установка через apt (может быть старая версия)
# sudo apt update
# sudo apt install -y nodejs npm

# Проверка установки
node --version  # Должно быть v18.x.x или выше
npm --version   # Должно быть 9.x.x или выше

# Установка Python
sudo apt-get install -y python3 python3-pip python3-venv

# Установка Nginx
sudo apt-get install -y nginx

# Установка PM2
sudo npm install -g pm2
```

#### Загрузка проекта

```bash
# Клонирование репозитория
git clone <repository-url>
cd opsWORK

# Автоматическая установка и запуск (рекомендуется)

# Python версия (кроссплатформенная)
python3 setup_and_deploy.py

# Или Bash версия
chmod +x setup_and_deploy.sh
sudo ./setup_and_deploy.sh
```

**Или ручная установка:**

```bash
# Установка зависимостей
npm run install:all

# Установка Python зависимостей
cd Analyz
pip3 install -r requirements.txt --user
cd ..
```

#### Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```env
NODE_ENV=production
BACKEND_PORT=5000
FRONTEND_PORT=3000
SESSION_SECRET=<сгенерируйте-случайную-строку>
DATABASE_PATH=/path/to/database.db
```

#### Сборка проекта

**Важно**: Перед сборкой убедитесь, что все зависимости установлены!

```bash
# Установка всех зависимостей (если еще не установлены)
npm run install:all

# Сборка Frontend
cd frontend
npm install  # Убедитесь, что зависимости установлены
npm run build
cd ..

# Сборка Backend
cd backend
npm install  # Убедитесь, что зависимости установлены
npm run build
cd ..
```

**Если получаете ошибку "tsc: not found":**
```bash
# Установите зависимости frontend
cd frontend
npm install
npm run build
```

См. также [DEPLOY_TROUBLESHOOTING.md](DEPLOY_TROUBLESHOOTING.md) для решения проблем.

#### Настройка PM2

Создайте файл `ecosystem.config.js` в корне проекта:

```javascript
module.exports = {
  apps: [
    {
      name: 'ops-backend',
      script: './backend/dist/index.js',
      cwd: './backend',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'ops-analyz',
      script: 'python3',
      args: 'app.py',
      cwd: './Analyz',
      interpreter: 'python3',
      env: {
        FLASK_ENV: 'production',
        PORT: 5001
      },
      error_file: './logs/analyz-error.log',
      out_file: './logs/analyz-out.log'
    }
  ]
};
```

Запуск с PM2:

```bash
# Установка PM2
npm install -g pm2

# Запуск приложений
pm2 start ecosystem.config.js

# Сохранение конфигурации для автозапуска
pm2 save
pm2 startup
```

#### Настройка Nginx

Создайте файл `/etc/nginx/sites-available/ops`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        root /path/to/opsWORK/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Analyz proxy
    location /integrations/analyz {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Статические файлы
    location /static {
        alias /path/to/opsWORK/frontend/dist;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Активация конфигурации:

```bash
sudo ln -s /etc/nginx/sites-available/ops /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### Настройка SSL (Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### Вариант 2: Docker (рекомендуется для продакшена)

#### Создание Dockerfile для Backend

Создайте файл `backend/Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Копирование package файлов
COPY package*.json ./
COPY tsconfig.json ./

# Установка зависимостей
RUN npm ci --only=production

# Копирование исходного кода
COPY src ./src

# Сборка
RUN npm run build

# Запуск
CMD ["node", "dist/index.js"]
```

#### Создание Dockerfile для Frontend

Создайте файл `frontend/Dockerfile`:

```dockerfile
FROM node:18-alpine as build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

#### Создание docker-compose.yml

```yaml
version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
      - DATABASE_PATH=/app/data/database.db
    volumes:
      - ./backend/data:/app/data
      - ./backend/uploads:/app/uploads
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

  analyz:
    build: ./Analyz
    ports:
      - "5001:5001"
    volumes:
      - ./Analyz/data_days:/app/data_days
    restart: unless-stopped
```

Запуск:

```bash
docker-compose up -d
```

### Вариант 3: Облачные платформы

#### Heroku

```bash
# Установка Heroku CLI
# https://devcenter.heroku.com/articles/heroku-cli

# Логин
heroku login

# Создание приложений
heroku create ops-backend
heroku create ops-frontend

# Настройка переменных окружения
heroku config:set NODE_ENV=production -a ops-backend
heroku config:set SESSION_SECRET=<secret> -a ops-backend

# Деплой
git push heroku main
```

#### Railway

1. Подключите репозиторий на Railway
2. Настройте переменные окружения
3. Railway автоматически определит и соберет проект

#### Vercel (только Frontend)

```bash
npm install -g vercel
cd frontend
vercel
```

## Рекомендации по безопасности

1. **Измените пароли по умолчанию** после первого входа
2. **Используйте HTTPS** в продакшене
3. **Настройте файрвол**:
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```
4. **Регулярно обновляйте зависимости**:
   ```bash
   npm audit fix
   ```
5. **Настройте резервное копирование базы данных**
6. **Используйте переменные окружения** для секретов

## Мониторинг и логи

### PM2 мониторинг

```bash
# Просмотр статуса
pm2 status

# Просмотр логов
pm2 logs

# Мониторинг ресурсов
pm2 monit
```

### Nginx логи

```bash
# Access лог
sudo tail -f /var/log/nginx/access.log

# Error лог
sudo tail -f /var/log/nginx/error.log
```

## Обновление приложения

```bash
# Остановка приложений
pm2 stop all

# Обновление кода
git pull origin main

# Установка новых зависимостей
npm run install:all

# Пересборка
cd frontend && npm run build && cd ..
cd backend && npm run build && cd ..

# Перезапуск
pm2 restart all
```

## Резервное копирование

### База данных

```bash
# Создание бэкапа
cp backend/database.db backups/database-$(date +%Y%m%d).db

# Автоматический бэкап (cron)
0 2 * * * cp /path/to/backend/database.db /path/to/backups/database-$(date +\%Y\%m\%d).db
```

### Загруженные файлы

```bash
tar -czf backups/uploads-$(date +%Y%m%d).tar.gz backend/uploads/
```

## Поддержка

При возникновении проблем проверьте:

1. Логи приложений (`pm2 logs`)
2. Логи Nginx (`/var/log/nginx/error.log`)
3. Статус процессов (`pm2 status`)
4. Порты (`netstat -tulpn | grep :5000`)

