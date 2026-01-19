# Решение проблем при деплое

## Ошибка: "tsc: not found"

### Проблема
При выполнении `npm run build` в frontend получаете ошибку:
```
sh: 1: tsc: not found
```

### Решение

1. **Убедитесь, что вы находитесь в правильной директории:**
```bash
# Должны быть в корне проекта
cd ~/opsWORK  # или путь к вашему проекту
```

2. **Установите зависимости frontend:**
```bash
cd frontend
npm install
```

3. **Проверьте установку TypeScript:**
```bash
# Проверка локальной установки
./node_modules/.bin/tsc --version

# Или глобальная установка (не рекомендуется)
npm install -g typescript
```

4. **Попробуйте сборку снова:**
```bash
npm run build
```

### Альтернативное решение

Если проблема сохраняется, установите зависимости явно:

```bash
cd frontend
npm install --save-dev typescript
npm install --save-dev @types/react @types/react-dom
npm run build
```

## Ошибка: "cd: backend: No such file or directory"

### Проблема
Вы находитесь не в корне проекта.

### Решение

```bash
# Вернитесь в корень проекта
cd ~/opsWORK  # или путь к вашему проекту

# Проверьте структуру
ls -la

# Должны увидеть:
# frontend/
# backend/
# Analyz/
# package.json
```

## Полная установка с нуля

Если проблемы продолжаются, выполните полную переустановку:

```bash
# 1. Перейдите в корень проекта
cd ~/opsWORK

# 2. Удалите node_modules (если есть)
rm -rf node_modules frontend/node_modules backend/node_modules

# 3. Установите все зависимости
npm run install:all

# 4. Проверьте установку TypeScript
cd frontend
./node_modules/.bin/tsc --version

# 5. Соберите проект
npm run build
```

## Проверка структуры проекта

Убедитесь, что структура проекта правильная:

```
opsWORK/
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
├── Analyz/
├── package.json
└── ...
```

## Другие частые ошибки

### "Cannot find module"

```bash
# Удалите node_modules и переустановите
rm -rf node_modules package-lock.json
npm install
```

### "Permission denied"

```bash
# Используйте sudo только если необходимо
# Лучше исправить права доступа
sudo chown -R $USER:$USER ~/opsWORK
```

### "Out of memory"

```bash
# Увеличьте лимит памяти для Node.js
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```


