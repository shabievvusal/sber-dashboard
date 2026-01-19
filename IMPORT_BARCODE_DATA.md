# Импорт данных штрихкодов из data.xlsx

## Проблема
Из-за кириллицы в пути Windows ("рабочий стол") SQLite не может открыть базу данных локально.

## Решение 1: Импорт через Docker (рекомендуется)

```bash
# 1. Убедитесь, что контейнер analyz запущен
docker compose ps

# 2. Скопируйте data.xlsx в контейнер (если его там нет)
docker compose cp Analyz/data.xlsx analyz:/app/data.xlsx

# 3. Запустите импорт
docker compose exec analyz python3 import_data.py
```

## Решение 2: Импорт вручную через Python в контейнере

```bash
# Войти в контейнер
docker compose exec analyz bash

# Внутри контейнера:
cd /app
python3 import_data.py
```

## Решение 3: Использовать переменную окружения EXCEL_PATH

```bash
# Если файл находится в другом месте
docker compose exec analyz bash -c "EXCEL_PATH=/app/data.xlsx python3 import_data.py"
```

## Проверка результата

После импорта проверьте количество записей:

```bash
docker compose exec analyz sqlite3 /app/data/database.sqlite3 "SELECT COUNT(*) FROM products;"
```

## Формат Excel файла (data.xlsx)

Файл должен содержать 4 колонки:
- **A**: `group_code` - код группы товара
- **B**: `product_name` - название товара (опционально)
- **C**: `barcode` - штрихкод
- **D**: `quantity` - количество

## Автоматический импорт при запуске

Если нужно автоматизировать импорт, можно добавить в Dockerfile или docker-compose.yml команду запуска импорта при старте контейнера.

