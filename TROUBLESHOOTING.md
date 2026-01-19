# Устранение неполадок

## Генератор штрихкодов не работает (503 Service Unavailable)

### Диагностика:

```bash
# 1. Проверьте логи Analyz на ошибки базы данных
docker compose logs analyz | grep -i "barcode\|database\|error" | tail -30

# 2. Проверьте, что база данных barcode создана
docker compose exec analyz ls -la /app/data/database.sqlite3

# 3. Проверьте доступность маршрута /barcode напрямую
docker compose exec backend curl http://analyz:5050/barcode

# 4. Проверьте через прокси
docker compose exec backend curl http://localhost:5000/integrations/analyz/barcode

# 5. Проверьте переменные окружения
docker compose exec analyz env | grep DB_PATH
```

### Решение:

Если база данных не создается:
```bash
# Создайте базу данных вручную
docker compose exec analyz python3 -c "
import sqlite3
import os
db_path = '/app/data/database.sqlite3'
os.makedirs(os.path.dirname(db_path), exist_ok=True)
conn = sqlite3.connect(db_path)
conn.execute('CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, group_code TEXT NOT NULL, product_name TEXT, barcode TEXT NOT NULL UNIQUE, quantity INTEGER NOT NULL)')
conn.commit()
conn.close()
print('Database created successfully')
"
```

## React таблица (ShowStats) не работает

### Диагностика:

```bash
# 1. Проверьте логи Analyz на ошибки employee_stats_today
docker compose logs analyz | grep -i "employee_stats\|error" | tail -30

# 2. Проверьте доступность маршрута напрямую
docker compose exec backend curl http://analyz:5050/employee_stats_today

# 3. Проверьте через прокси
docker compose exec backend curl http://localhost:5000/integrations/analyz/employee_stats_today

# 4. Проверьте, есть ли данные за сегодня
docker compose exec analyz ls -la /app/data_days/
```

### Решение:

Если нет данных:
1. Загрузите файл через интерфейс загрузки отчетов
2. Дождитесь завершения обработки
3. Обновите страницу

Если есть ошибка с employees.csv:
```bash
# Удалите директорию employees.csv, если она существует
docker compose exec analyz rm -rf /app/analyz-data/employees.csv
```

## Общие проблемы

### Проверка проксирования:

```bash
# Проверьте логи backend на запросы к Analyz
docker compose logs backend | grep -i "\[Proxy\]" | tail -20

# Проверьте, что контейнеры могут общаться
docker compose exec backend ping -c 2 analyz
```

### Перезапуск сервисов:

```bash
# Полный перезапуск
docker compose down
docker compose up -d --build

# Перезапуск конкретного сервиса
docker compose restart analyz
docker compose restart backend
docker compose restart frontend
```

