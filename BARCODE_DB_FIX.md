# Исправление проблем с базой данных штрихкодов

## Проблемы

1. **"Не удалось найти IP-адрес сервера analyz"** - DNS проблема в Docker сети
2. **База данных со штрихкодами недоступна** - база не создается или недоступна

## Решение

### 1. Проблема с DNS (IP-адрес сервера analyz)

Проверьте, что все контейнеры в одной сети:

```bash
# Проверка сети
docker network inspect sber-dashboard_ops-network

# Проверка, что контейнеры видят друг друга
docker compose exec frontend ping -c 2 analyz
docker compose exec backend ping -c 2 analyz
```

### 2. Проблема с базой данных штрихкодов

База данных для штрихкодов должна быть в `/app/data/database.sqlite3` внутри контейнера.

**Проверка:**

```bash
# Проверка существования базы
docker compose exec analyz ls -la /app/data/

# Проверка таблицы products
docker compose exec analyz sqlite3 /app/data/database.sqlite3 "SELECT name FROM sqlite_master WHERE type='table' AND name='products';"

# Проверка количества записей
docker compose exec analyz sqlite3 /app/data/database.sqlite3 "SELECT COUNT(*) FROM products;"
```

**Создание базы вручную (если нужно):**

```bash
docker compose exec analyz python3 -c "
import sqlite3
import os
db_path = '/app/data/database.sqlite3'
os.makedirs(os.path.dirname(db_path), exist_ok=True)
conn = sqlite3.connect(db_path)
conn.execute('''
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_code TEXT NOT NULL,
        product_name TEXT,
        barcode TEXT NOT NULL UNIQUE,
        quantity INTEGER NOT NULL
    )
''')
conn.execute('CREATE INDEX IF NOT EXISTS idx_products_group_code ON products(group_code)')
conn.execute('CREATE INDEX IF NOT EXISTS idx_products_group_qty ON products(group_code, quantity)')
conn.commit()
conn.close()
print('Database created successfully')
"
```

**Проверка прав доступа:**

```bash
# Проверка прав на директорию
docker compose exec analyz ls -ld /app/data

# Проверка прав на файл базы
docker compose exec analyz ls -l /app/data/database.sqlite3
```

### 3. Проверка логов

```bash
# Логи Analyz
docker compose logs analyz | grep -i "barcode\|database\|error"

# Проверка ошибок при запуске
docker compose logs analyz | grep -i "ERROR\|WARNING"
```

### 4. Перезапуск с проверкой

```bash
# Остановка
docker compose down

# Запуск с выводом логов
docker compose up -d analyz
docker compose logs -f analyz
```

## Важно

База данных для штрихкодов (`products`) - это **отдельная** таблица в той же базе данных, что и основная база Analyz (`/app/data/database.sqlite3`).

Если база пустая, нужно добавить данные через:
- API endpoint (если есть)
- Или напрямую через SQL

