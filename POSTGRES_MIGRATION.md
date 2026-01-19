# Миграция базы данных штрихкодов на PostgreSQL

## Что было сделано

1. ✅ Добавлен PostgreSQL сервис в `docker-compose.yml`
2. ✅ Обновлен `requirements.txt` - добавлен `psycopg2-binary`
3. ✅ Переделан `db.py` для поддержки PostgreSQL и SQLite (fallback)
4. ✅ Обновлен `routes.py` - все SQL запросы работают с обеими БД
5. ✅ Обновлен `import_data.py` - поддержка импорта в PostgreSQL
6. ✅ Обновлен health check в `app.py` для проверки PostgreSQL

## Конфигурация

### Переменные окружения

В `docker-compose.yml` для сервиса `analyz`:
- `BARCODE_USE_POSTGRES=true` - включить использование PostgreSQL
- `POSTGRES_HOST=postgres` - хост PostgreSQL
- `POSTGRES_PORT=5432` - порт PostgreSQL
- `POSTGRES_USER` - пользователь (по умолчанию `ops_user`)
- `POSTGRES_PASSWORD` - пароль (по умолчанию `ops_password`)
- `POSTGRES_DB` - база данных (по умолчанию `ops_db`)

### PostgreSQL сервис

- **Имя контейнера**: `ops-postgres`
- **Образ**: `postgres:15-alpine`
- **Volume**: `postgres-data` (данные сохраняются)
- **Health check**: проверка готовности через `pg_isready`

## Запуск

### 1. Пересобрать и запустить

```bash
docker compose down
docker compose build analyz
docker compose up -d
```

### 2. Импорт данных из Excel

```bash
# Импорт в PostgreSQL
docker compose exec analyz python3 import_data.py
```

Или вручную:
```bash
docker compose exec analyz bash -c "cd /app/analyz-data && python3 import_data.py"
```

### 3. Проверка

```bash
# Проверка количества записей
docker compose exec postgres psql -U ops_user -d ops_db -c "SELECT COUNT(*) FROM products;"

# Проверка структуры таблицы
docker compose exec postgres psql -U ops_user -d ops_db -c "\d products"
```

## Откат на SQLite

Если нужно вернуться к SQLite:
1. Установить `BARCODE_USE_POSTGRES=false` или удалить переменную
2. Перезапустить контейнер `analyz`

## Преимущества PostgreSQL

1. ✅ Нет проблем с кодировкой путей (кириллица в Windows)
2. ✅ Лучшая производительность для больших объемов данных
3. ✅ Надежность и отказоустойчивость
4. ✅ Возможность масштабирования
5. ✅ Расширенные возможности (триггеры, функции, индексы)

## Структура таблицы

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    group_code TEXT NOT NULL,
    product_name TEXT,
    barcode TEXT NOT NULL UNIQUE,
    quantity INTEGER NOT NULL
);

CREATE INDEX idx_products_group_code ON products(group_code);
CREATE INDEX idx_products_group_qty ON products(group_code, quantity);
```

## Миграция данных из SQLite

Если нужно перенести данные из существующей SQLite базы:

```bash
# 1. Экспорт из SQLite
docker compose exec analyz sqlite3 /app/data/database.sqlite3 ".mode csv" ".output products.csv" "SELECT * FROM products;"

# 2. Импорт в PostgreSQL (через Python скрипт или напрямую)
docker compose exec postgres psql -U ops_user -d ops_db -c "\COPY products FROM '/path/to/products.csv' WITH CSV HEADER;"
```

Или используйте `import_data.py` с Excel файлом.

