# Устранение проблем на продакшене

## Проблема: Analyz не работает на Dashboard

### Симптомы
- Dashboard не загружает данные из Analyz
- React таблица (ShowStats) не работает
- Ошибки 404 или 503 при запросах к `/integrations/analyz/*`

### Диагностика

#### 1. Проверьте логи backend
```bash
docker compose logs backend | grep -i "proxy\|analyz\|error"
```

Ищите:
- `[Proxy Error]` - ошибки проксирования
- `ECONNREFUSED` - Analyz недоступен
- `ETIMEDOUT` - таймаут подключения

#### 2. Проверьте логи Analyz
```bash
docker compose logs analyz | grep -i "error\|exception\|404"
```

#### 3. Проверьте health checks
```bash
# Backend health check
curl http://localhost:5001/health/detailed

# Analyz health check (через прокси)
curl http://localhost:5001/integrations/analyz/health

# Analyz health check (напрямую)
curl http://localhost:5051/health
```

#### 4. Проверьте доступность endpoint
```bash
# Проверка employee_stats_today
curl http://localhost:5001/integrations/analyz/employee_stats_today

# Проверка списка дней
curl http://localhost:5001/integrations/analyz/days
```

### Решения

#### Решение 1: Analyz не запущен или недоступен

**Проверка:**
```bash
docker compose ps
# Должен показать все контейнеры как "Up" и "Healthy"
```

**Исправление:**
```bash
# Перезапустите Analyz
docker compose restart analyz

# Проверьте логи
docker compose logs analyz
```

#### Решение 2: Проблема с проксированием

**Проверка:**
```bash
# Проверьте, что backend может достучаться до Analyz
docker compose exec backend ping -c 2 analyz
```

**Исправление:**
Убедитесь, что в `docker-compose.yml`:
```yaml
backend:
  environment:
    - ANALYZ_SERVICE_URL=http://analyz:5050  # Внутренний адрес Docker сети
```

#### Решение 3: Проблема с nginx проксированием

**Проверка:**
```bash
# Проверьте конфигурацию nginx
docker compose exec frontend nginx -t

# Проверьте логи nginx
docker compose logs frontend | grep -i "error"
```

**Исправление:**
Убедитесь, что в `frontend/nginx.conf`:
```nginx
location /integrations {
    proxy_pass http://backend:5000;  # Внутренний адрес backend
    # ... остальные настройки
}
```

#### Решение 4: Нет данных за сегодня

**Симптом:** `employee_stats_today` возвращает 404 или `no_data`

**Причина:** Не загружен отчет за сегодняшний день

**Решение:**
1. Загрузите отчет за сегодня через интерфейс загрузки
2. Дождитесь завершения обработки
3. Обновите страницу ShowStats

#### Решение 5: Проблема с CORS

**Симптом:** Ошибки CORS в консоли браузера

**Исправление:**
Убедитесь, что в `backend/src/index.ts` правильно настроен CORS:
```typescript
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',')
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];
```

## Проблема: React таблица (ShowStats) не работает

### Симптомы
- Таблица не загружается
- Показывается ошибка "Ошибка загрузки"
- Бесконечная загрузка

### Диагностика

#### 1. Проверьте консоль браузера
Откройте DevTools (F12) → Console и ищите:
- Ошибки axios
- Ошибки 404, 503, 502
- CORS ошибки

#### 2. Проверьте Network tab
Откройте DevTools → Network и проверьте:
- Запрос к `/integrations/analyz/employee_stats_today`
- Статус ответа (200, 404, 503, etc.)
- Тело ответа

#### 3. Проверьте endpoint напрямую
```bash
curl http://localhost:5001/integrations/analyz/employee_stats_today
```

### Решения

#### Решение 1: Endpoint возвращает 404

**Причина:** Нет данных за сегодня

**Решение:**
1. Загрузите отчет за сегодня
2. Или используйте endpoint с конкретной датой:
   ```typescript
   // В ShowStats.tsx можно добавить выбор даты
   const res = await axios.get(`/integrations/analyz/employee_stats/${date}`);
   ```

#### Решение 2: Endpoint возвращает 503/502

**Причина:** Analyz недоступен

**Решение:**
1. Проверьте статус Analyz: `docker compose ps`
2. Перезапустите Analyz: `docker compose restart analyz`
3. Проверьте логи: `docker compose logs analyz`

#### Решение 3: Таймаут запроса

**Причина:** Обработка данных занимает слишком много времени

**Решение:**
Увеличьте таймауты в:
- `backend/src/index.ts`: `ANALYZ_PROXY_TIMEOUT_MS`
- `frontend/nginx.conf`: `proxy_read_timeout`

## Общие рекомендации

### 1. Проверка всех компонентов

```bash
# Статус всех контейнеров
docker compose ps

# Health checks
curl http://localhost:5001/health/detailed
curl http://localhost:5001/integrations/analyz/health

# Проверка основных endpoints
curl http://localhost:5001/integrations/analyz/days
curl http://localhost:5001/api/auth/me
```

### 2. Логи для диагностики

```bash
# Все логи
docker compose logs

# Логи конкретного сервиса
docker compose logs backend
docker compose logs analyz
docker compose logs frontend

# Логи в реальном времени
docker compose logs -f backend
```

### 3. Перезапуск сервисов

```bash
# Полный перезапуск
docker compose down
docker compose up -d

# Перезапуск конкретного сервиса
docker compose restart backend
docker compose restart analyz
docker compose restart frontend
```

### 4. Проверка конфигурации

Убедитесь, что:
- ✅ Все переменные окружения установлены в `.env`
- ✅ `ANALYZ_SERVICE_URL` в docker-compose указывает на внутренний адрес
- ✅ Порты не конфликтуют с другими сервисами
- ✅ Health checks проходят успешно

## Быстрая диагностика

Выполните эту команду для быстрой проверки:

```bash
echo "=== Container Status ===" && \
docker compose ps && \
echo -e "\n=== Backend Health ===" && \
curl -s http://localhost:5001/health/detailed | jq . && \
echo -e "\n=== Analyz Health ===" && \
curl -s http://localhost:5001/integrations/analyz/health | jq . && \
echo -e "\n=== Available Days ===" && \
curl -s http://localhost:5001/integrations/analyz/days | jq .
```

Если все работает, вы увидите:
- Все контейнеры "Up" и "Healthy"
- Health checks возвращают `"status": "healthy"`
- Список доступных дней

