import express from 'express';
import http from 'http';

const router = express.Router();

// Health check для самого backend
router.get('/', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'backend',
    timestamp: new Date().toISOString()
  });
});

// Health check с проверкой зависимостей
router.get('/detailed', async (req, res) => {
  // Проверяем Analyz через внутренний адрес Docker сети
  const ANALYZ_SERVICE_URL = 'http://analyz:5050';
  const health: {
    status: string;
    service: string;
    timestamp: string;
    dependencies: {
      analyz: {
        status: string;
        url: string;
        error?: string;
      };
    };
  } = {
    status: 'healthy',
    service: 'backend',
    timestamp: new Date().toISOString(),
    dependencies: {
      analyz: {
        status: 'unknown',
        url: ANALYZ_SERVICE_URL
      }
    }
  };

  // Проверяем доступность Analyz используя встроенный http модуль
  try {
    const url = new URL(`${ANALYZ_SERVICE_URL}/health`);
    const response = await new Promise<{ status: number; data: any }>((resolve, reject) => {
      const request = http.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        timeout: 3000
      }, (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode || 500, data: JSON.parse(data) });
          } catch {
            resolve({ status: response.statusCode || 500, data: {} });
          }
        });
      });

      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });

      request.end();
    });

    health.dependencies.analyz.status = response.data?.status === 'healthy' ? 'healthy' : 'unhealthy';
  } catch (error: any) {
    health.dependencies.analyz.status = 'unavailable';
    health.dependencies.analyz.error = error.message || 'Connection failed';
    health.status = 'degraded'; // Backend работает, но зависимость недоступна
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;

