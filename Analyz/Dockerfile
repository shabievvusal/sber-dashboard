# Analyz (Flask) Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Устанавливаем системные зависимости
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Копируем requirements
COPY requirements.txt ./

# Устанавливаем Python зависимости
RUN pip install --no-cache-dir -r requirements.txt

# Копируем исходный код
COPY . .

# Создаем необходимые директории
RUN mkdir -p data_days logs static templates modules/barcode_generator

# Открываем порт
EXPOSE 5050

# Переменные окружения
ENV PYTHONUNBUFFERED=1
ENV ANALYZ_PORT=5050
ENV ANALYZ_HOST=0.0.0.0
ENV FLASK_APP=app.py

# Запуск приложения
CMD ["python", "wsgi.py"]

