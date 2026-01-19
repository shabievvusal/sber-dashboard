#!/bin/bash
# Скрипт для проверки базы данных штрихкодов

echo "=== Проверка базы данных штрихкодов ==="
echo ""

# Проверка существования контейнера
if ! docker compose ps | grep -q "ops-analyz"; then
    echo "❌ Контейнер ops-analyz не запущен"
    exit 1
fi

echo "1. Проверка существования базы данных:"
docker compose exec analyz ls -la /app/data/ 2>/dev/null || echo "❌ Директория /app/data недоступна"

echo ""
echo "2. Проверка файла базы данных:"
if docker compose exec analyz test -f /app/data/database.sqlite3; then
    echo "✅ Файл базы данных существует"
    docker compose exec analyz ls -lh /app/data/database.sqlite3
else
    echo "❌ Файл базы данных не существует"
fi

echo ""
echo "3. Проверка таблицы products:"
docker compose exec analyz sqlite3 /app/data/database.sqlite3 "SELECT name FROM sqlite_master WHERE type='table' AND name='products';" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ Таблица products существует"
else
    echo "❌ Таблица products не существует или база недоступна"
fi

echo ""
echo "4. Количество записей в таблице products:"
docker compose exec analyz sqlite3 /app/data/database.sqlite3 "SELECT COUNT(*) FROM products;" 2>/dev/null || echo "❌ Не удалось получить количество записей"

echo ""
echo "5. Проверка переменной окружения DB_PATH:"
docker compose exec analyz printenv DB_PATH

echo ""
echo "6. Проверка прав доступа:"
docker compose exec analyz ls -ld /app/data
docker compose exec analyz test -w /app/data && echo "✅ Директория доступна для записи" || echo "❌ Директория недоступна для записи"

echo ""
echo "7. Логи инициализации базы данных:"
docker compose logs analyz | grep -i "barcode.*database\|database.*barcode\|products\|ERROR.*database" | tail -10

echo ""
echo "=== Проверка завершена ==="

