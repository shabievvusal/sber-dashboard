.PHONY: help build up down restart logs clean dev

help: ## Показать справку
	@echo "Доступные команды:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

build: ## Собрать Docker образы
	docker-compose build

up: ## Запустить все сервисы
	docker-compose up -d

down: ## Остановить все сервисы
	docker-compose down

restart: ## Перезапустить все сервисы
	docker-compose restart

logs: ## Показать логи всех сервисов
	docker-compose logs -f

logs-backend: ## Показать логи backend
	docker-compose logs -f backend

logs-frontend: ## Показать логи frontend
	docker-compose logs -f frontend

logs-analyz: ## Показать логи analyz
	docker-compose logs -f analyz

dev: ## Запустить в режиме разработки
	docker-compose -f docker-compose.dev.yml up

dev-down: ## Остановить dev режим
	docker-compose -f docker-compose.dev.yml down

clean: ## Очистить контейнеры и volumes
	docker-compose down -v
	docker system prune -f

rebuild: ## Пересобрать и перезапустить
	docker-compose build --no-cache
	docker-compose up -d

ps: ## Показать статус контейнеров
	docker-compose ps

shell-backend: ## Открыть shell в backend контейнере
	docker-compose exec backend sh

shell-frontend: ## Открыть shell в frontend контейнере
	docker-compose exec frontend sh

shell-analyz: ## Открыть shell в analyz контейнере
	docker-compose exec analyz bash

