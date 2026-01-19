import axios from 'axios';

export interface AnalyzHealthStatus {
  isHealthy: boolean;
  lastCheck: Date | null;
  error: string | null;
}

class AnalyzHealthMonitor {
  private status: AnalyzHealthStatus = {
    isHealthy: false,
    lastCheck: null,
    error: null
  };

  private checkInterval: number | null = null;
  private listeners: Array<(status: AnalyzHealthStatus) => void> = [];

  // Проверка состояния Analyz
  async checkHealth(): Promise<AnalyzHealthStatus> {
    try {
      const response = await axios.get('/integrations/analyz/health', {
        timeout: 5000
      });

      this.status = {
        isHealthy: response.data?.status === 'healthy',
        lastCheck: new Date(),
        error: response.data?.status !== 'healthy' ? 'Service is degraded' : null
      };
    } catch (error: any) {
      this.status = {
        isHealthy: false,
        lastCheck: new Date(),
        error: error.response?.data?.message || error.message || 'Service unavailable'
      };
    }

    // Уведомляем всех слушателей
    this.notifyListeners();
    return this.status;
  }

  // Начать мониторинг
  startMonitoring(intervalMs: number = 30000) {
    if (this.checkInterval) {
      this.stopMonitoring();
    }

    // Первая проверка сразу
    this.checkHealth();

    // Затем проверяем периодически
    this.checkInterval = window.setInterval(() => {
      this.checkHealth();
    }, intervalMs);
  }

  // Остановить мониторинг
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // Подписаться на изменения статуса
  subscribe(listener: (status: AnalyzHealthStatus) => void) {
    this.listeners.push(listener);
    // Сразу вызываем с текущим статусом
    listener(this.status);
  }

  // Отписаться от изменений
  unsubscribe(listener: (status: AnalyzHealthStatus) => void) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  // Уведомить всех слушателей
  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.status));
  }

  // Получить текущий статус
  getStatus(): AnalyzHealthStatus {
    return { ...this.status };
  }
}

// Singleton экземпляр
export const analyzHealthMonitor = new AnalyzHealthMonitor();

