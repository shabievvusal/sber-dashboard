# Деплой на hiphosting

## Структура проекта
```
sssss/
├── app.py                 # Основное приложение Flask
├── wsgi.py               # WSGI точка входа
├── requirements.txt      # Зависимости Python
├── favicon.ico          # Иконка сайта
├── .gitignore           # Игнорируемые файлы
├── modules/             # Модули приложения
│   └── barcode_generator/
│       ├── __init__.py
│       └── routes.py
├── static/              # Статические файлы
│   ├── app.js
│   ├── main.css
│   └── styles.css
└── templates/           # HTML шаблоны
    ├── barcode/
    │   └── index.html
    ├── index.html
    └── results.html
```

## Функциональность
1. **Анализ данных** - загрузка и анализ CSV/XLSX файлов
2. **Генератор штрих-кодов** - создание и печать штрих-кодов
3. **Таймлайн простоев** - визуализация простоев сотрудников
4. **Результаты** - отображение статистики по сотрудникам

## Деплой
1. Загрузите все файлы на сервер
2. Установите зависимости: `pip install -r requirements.txt`
3. Запустите приложение: `python wsgi.py`

## Требования
- Python 3.8+
- Flask 3.0.3
- pandas 2.2.2
- openpyxl 3.1.2
- requests 2.31.0
