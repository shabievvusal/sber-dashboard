# Диагностика проблем с Analyz и базой данных штрихкодов

## Проблема 1: "Не удалось найти IP-адрес сервера analyz"

Это DNS проблема в Docker сети. Проверьте:

### 1. Проверка сети Docker

```bash
# Проверка существования сети
docker network ls | grep ops-network

# Детальная информация о сети
docker network inspect sber-dashboard_ops-network

# Проверка, что все контейнеры в сети
docker compose ps
```

### 2. Проверка DNS резолвинга

```bash
# Из контейнера frontend
docker compose exec frontend ping -c 2 analyz

# Из контейнера backend
docker compose exec backend ping -c 2 analyz

# Проверка из контейнера analyz
docker compose exec analyz hostname -i
```

### 3. Перезапуск сети

```bash
# Остановка всех контейнеров
docker compose down

# Удаление сети (если нужно)
docker network rm sber-dashboard_ops-network

# Запуск заново
docker compose up -d
```

### 4. Проверка конфигурации nginx

Убедитесь, что в `frontend/nginx.conf` используется правильное имя сервиса:

```nginx
proxy_pass http://analyz:5050;
```

Не используйте `localhost` или IP-адрес напрямую.

## Проблема 2: База данных со штрихкодами недоступна

### 1. Быстрая проверка

```bash
# Запустите скрипт диагностики
bash check_barcode_db.sh
```

### 2. Ручная проверка

```bash
# Проверка существования базы
docker compose exec analyz ls -la /app/data/

# Проверка таблицы products
docker compose exec analyz sqlite3 /app/data/database.sqlite3 "SELECT name FROM sqlite_master WHERE type='table' AND name='products';"

# Проверка количества записей
docker compose exec analyz sqlite3 /app/data/database.sqlite3 "SELECT COUNT(*) FROM products;"
```

### 3. Создание базы вручную (если нужно)

```bash
docker compose exec analyz python3 << 'EOF'
import sqlite3
import os

db_path = '/app/data/database.sqlite3'
os.makedirs(os.path.dirname(db_path), exist_ok=True)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Создание таблицы
cur.execute('''
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_code TEXT NOT NULL,
        product_name TEXT,
        barcode TEXT NOT NULL UNIQUE,
        quantity INTEGER NOT NULL
    )
''')

# Создание индексов
cur.execute('CREATE INDEX IF NOT EXISTS idx_products_group_code ON products(group_code)')
cur.execute('CREATE INDEX IF NOT EXISTS idx_products_group_qty ON products(group_code, quantity)')

conn.commit()
conn.close()

print('✅ База данных создана успешно')
EOF
```

### 4. Проверка прав доступа

```bash
# Проверка прав на директорию
docker compose exec analyz ls -ld /app/data

# Проверка прав на файл
docker compose exec analyz ls -l /app/data/database.sqlite3

# Если нет прав, исправьте:
docker compose exec analyz chmod 755 /app/data
docker compose exec analyz chmod 644 /app/data/database.sqlite3
```

### 5. Проверка логов

```bash
# Логи Analyz
docker compose logs analyz | grep -i "barcode\|database\|error"

# Последние 50 строк логов
docker compose logs --tail=50 analyz
```

### 6. Проверка health check

```bash
# Проверка health check Analyz
curl http://localhost:5050/health

# Или через nginx
curl http://localhost:3001/integrations/analyz/health
```

Должен вернуться JSON с информацией о состоянии базы данных:

```json
{
  "status": "healthy",
  "database": {
    "path": "/app/data/database.sqlite3",
    "exists": true,
    "accessible": true
  },
  "barcode_database": {
    "accessible": true,
    "error": null
  }
}
```

## Общие решения

### Перезапуск с очисткой

```bash
# Остановка
docker compose down

# Удаление volumes (ОСТОРОЖНО: удалит данные!)
# docker volume rm sber-dashboard_analyz-db

# Пересборка
docker compose build analyz

# Запуск
docker compose up -d

# Проверка логов
docker compose logs -f analyz
```

### Проверка переменных окружения

```bash
# В контейнере analyz
docker compose exec analyz printenv | grep -E "DB_PATH|ANALYZ"
```

Должно быть:
- `DB_PATH=/app/data/database.sqlite3`

## Если ничего не помогает

1. Проверьте, что volume `analyz-db` создан:
```bash
docker volume ls | grep analyz-db
```

2. Проверьте, что volume подключен:
```bash
docker compose exec analyz mount | grep /app/data
```

3. Попробуйте пересоздать volume:
```bash
docker compose down -v
docker compose up -d
```
