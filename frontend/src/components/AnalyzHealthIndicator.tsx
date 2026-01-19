import { useState, useEffect } from 'react';
import { analyzHealthMonitor, AnalyzHealthStatus } from '../services/analyzHealth';

export default function AnalyzHealthIndicator() {
  const [status, setStatus] = useState<AnalyzHealthStatus>(analyzHealthMonitor.getStatus());

  useEffect(() => {
    const handleStatusChange = (newStatus: AnalyzHealthStatus) => {
      setStatus(newStatus);
    };

    analyzHealthMonitor.subscribe(handleStatusChange);

    return () => {
      analyzHealthMonitor.unsubscribe(handleStatusChange);
    };
  }, []);

  if (status.isHealthy) {
    return null; // Не показываем индикатор, если все хорошо
  }

  return (
    <div className="fixed bottom-4 right-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded shadow-lg z-50 max-w-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-bold text-sm">⚠️ Analyz недоступен</p>
          <p className="text-xs mt-1">{status.error || 'Сервис временно недоступен'}</p>
          {status.lastCheck && (
            <p className="text-xs mt-1 text-gray-600">
              Последняя проверка: {new Date(status.lastCheck).toLocaleTimeString('ru-RU')}
            </p>
          )}
        </div>
        <button
          onClick={() => analyzHealthMonitor.checkHealth()}
          className="ml-4 text-yellow-700 hover:text-yellow-900 text-sm"
          title="Проверить снова"
        >
          ⟳
        </button>
      </div>
    </div>
  );
}

