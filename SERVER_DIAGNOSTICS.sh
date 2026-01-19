#!/bin/bash
# Скрипт для диагностики проблем на сервере

echo "=== Диагностика системы ==="
echo ""

echo "1. Статус контейнеров:"
docker compose ps
echo ""

echo "2. Health Check Backend:"
curl -s http://localhost:5001/health/detailed | jq . || echo "Ошибка подключения к backend"
echo ""

echo "3. Health Check Analyz (через прокси):"
curl -s http://localhost:5001/integrations/analyz/health | jq . || echo "Ошибка подключения к Analyz через прокси"
echo ""

echo "4. Health Check Analyz (напрямую):"
curl -s http://localhost:5051/health | jq . || echo "Ошибка подключения к Analyz напрямую"
echo ""

echo "5. Список доступных дней:"
curl -s http://localhost:5001/integrations/analyz/days | jq . || echo "Ошибка получения списка дней"
echo ""

echo "6. Employee Stats Today:"
curl -s http://localhost:5001/integrations/analyz/employee_stats_today | jq '.date, .employees | length' || echo "Ошибка получения статистики"
echo ""

echo "7. Последние логи Backend (ошибки):"
docker compose logs backend --tail=20 | grep -i "error\|proxy\|analyz" || echo "Нет ошибок в последних логах"
echo ""

echo "8. Последние логи Analyz (ошибки):"
docker compose logs analyz --tail=20 | grep -i "error\|exception" || echo "Нет ошибок в последних логах"
echo ""

echo "=== Диагностика завершена ==="

