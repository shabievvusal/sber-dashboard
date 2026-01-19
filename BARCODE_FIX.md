# Исправление проблем с генератором штрихкодов

## Проблемы

1. **Запросы идут на прямой IP** (`http://141.105.69.3:5051`) вместо прокси
2. **База данных недоступна** - ошибки при поиске штрихкодов

## Исправления

### 1. Автоматическое определение базового пути

**Проблема**: JavaScript в iframe не знал базовый путь после проксирования nginx.

**Решение**:
- Добавлено явное определение базового пути в шаблоне через `base_path`
- Улучшена логика определения пути в `app.js`
- Если путь `/barcode` (без `/integrations/analyz`), автоматически используется `/integrations/analyz`

### 2. Улучшена обработка ошибок базы данных

**Проблема**: Ошибки базы данных не обрабатывались должным образом.

**Решение**:
- Добавлен try-catch для всех операций с БД
- Улучшены сообщения об ошибках
- Логирование ошибок в stderr

### 3. Настроен nginx для передачи префикса

**Решение**:
- Добавлен заголовок `X-Forwarded-Prefix` в nginx
- Flask использует этот заголовок для определения базового пути

## Как это работает

### Запросы через прокси:

1. **Frontend загружает iframe**: `/integrations/analyz/barcode?compact=1`
2. **Nginx проксирует**: `http://analyz:5050/barcode?compact=1`
3. **Flask получает запрос** с заголовком `X-Forwarded-Prefix: /integrations/analyz`
4. **Шаблон устанавливает**: `window.__ANALYZ_BASE_PATH = '/integrations/analyz'`
5. **JavaScript делает запросы**: `/integrations/analyz/barcode/api/search`
6. **Nginx проксирует**: `http://analyz:5050/barcode/api/search`

### Проверка базы данных:

База данных создается автоматически при первом запуске в:
- Docker: `/app/data/database.sqlite3`
- Локально: `Analyz/database.sqlite3`

## Диагностика

### Проверка базового пути

Откройте консоль браузера (F12) и проверьте:
```javascript
console.log(window.__ANALYZ_BASE_PATH);
// Должно быть: "/integrations/analyz"
```

### Проверка базы данных

```bash
# Проверка существования базы
docker compose exec analyz ls -la /app/data/database.sqlite3

# Проверка таблицы
docker compose exec analyz sqlite3 /app/data/database.sqlite3 "SELECT COUNT(*) FROM products;"

# Создание базы вручную (если нужно)
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

### Проверка запросов

В консоли браузера проверьте Network tab:
- ✅ Правильно: `/integrations/analyz/barcode/api/search?query=...`
- ❌ Неправильно: `http://141.105.69.3:5051/barcode/api/search?query=...`

## Что нужно сделать

1. **Пересобрать контейнеры**:
```bash
docker compose build analyz frontend
```

2. **Перезапустить**:
```bash
docker compose restart analyz frontend
```

3. **Проверить логи**:
```bash
docker compose logs analyz | grep -i "barcode\|database\|error"
```

4. **Проверить в браузере**:
- Откройте генератор штрихкодов
- Откройте консоль (F12)
- Проверьте, что запросы идут на `/integrations/analyz/barcode/api/search`
- Проверьте, что `window.__ANALYZ_BASE_PATH = '/integrations/analyz'`

## Если база данных пустая

База данных создается автоматически, но может быть пустой. Добавьте данные через:
- API endpoint (если есть)
- Или напрямую в базу данных

