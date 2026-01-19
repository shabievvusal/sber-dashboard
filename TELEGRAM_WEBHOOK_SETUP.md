# Настройка Telegram Webhook для команды /pull

## Описание

После настройки бот будет обрабатывать команду `/pull` и отправлять скриншоты таблиц простоев сотрудников более 10 минут по компаниям.

## Требования

Убедитесь, что установлена библиотека Pillow для генерации скриншотов:

```bash
pip install Pillow==10.4.0
```

Или установите все зависимости из `requirements.txt`:

```bash
cd Analyz
pip install -r requirements.txt
```

## Шаги настройки

### 1. Получите URL вашего сервера

Убедитесь, что ваш сервер доступен из интернета. Например:
- `https://your-server.com` (если используете HTTPS)
- `http://your-server.com:5050` (если используете HTTP)

### 2. Настройте webhook для Telegram бота

Выполните запрос к API Telegram для установки webhook:

```bash
curl -X POST "https://api.telegram.org/bot8467241470:AAHgY7NHZM9MDLu7we1xqqISOIxAH6jINGU/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-server.com:5050/integrations/analyz/telegram_webhook"}'
```

Или через браузер:
```
https://api.telegram.org/bot8467241470:AAHgY7NHZM9MDLu7we1xqqISOIxAH6jINGU/setWebhook?url=https://your-server.com:5050/integrations/analyz/telegram_webhook
```

### 3. Проверьте настройку webhook

```bash
curl "https://api.telegram.org/bot8467241470:AAHgY7NHZM9MDLu7we1xqqISOIxAH6jINGU/getWebhookInfo"
```

### 4. Удаление webhook (если нужно)

```bash
curl -X POST "https://api.telegram.org/bot8467241470:AAHgY7NHZM9MDLu7we1xqqISOIxAH6jINGU/deleteWebhook"
```

## Использование

После настройки webhook отправьте команду `/pull` в чат с ботом. Бот:

1. Найдет последнюю доступную дату с данными
2. Получит все простои сотрудников более 10 минут
3. Сгруппирует их по компаниям
4. Отправит CSV файлы с простоями для каждой компании

## Формат ответа

Для каждой компании бот отправит скриншот таблицы со следующими колонками:
- **Сотрудник** - имя сотрудника
- **С** - время начала простоя
- **До** - время окончания простоя  
- **Длительность** - длительность простоя (часы, минуты, секунды)

Скриншот содержит до 30 простоев. Если простоев больше, внизу будет указано количество оставшихся.

## Важные замечания

1. **HTTPS**: Telegram требует HTTPS для webhook. Если у вас нет SSL сертификата, используйте reverse proxy (nginx) с SSL.

2. **Порт**: Убедитесь, что порт 5050 (или другой, на котором работает Analyz) доступен из интернета.

3. **Firewall**: Откройте необходимые порты в firewall.

4. **Логирование**: Проверяйте логи `Analyz/logs/analyz.log` для отладки.

## Пример настройки через nginx (reverse proxy)

```nginx
server {
    listen 443 ssl;
    server_name your-server.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /integrations/analyz/ {
        proxy_pass http://localhost:5050/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Отладка

Если команда `/pull` не работает:

1. Проверьте логи: `tail -f Analyz/logs/analyz.log`
2. Проверьте webhook: `curl "https://api.telegram.org/bot8467241470:AAHgY7NHZM9MDLu7we1xqqISOIxAH6jINGU/getWebhookInfo"`
3. Проверьте доступность endpoint: `curl -X POST "https://your-server.com:5050/integrations/analyz/telegram_webhook" -H "Content-Type: application/json" -d '{"message":{"text":"/pull","chat":{"id":"544569923"}}}'`

