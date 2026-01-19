import express from 'express';
import axios from 'axios';

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
  const ANALYZ_SERVICE_URL = process.env.ANALYZ_SERVICE_URL || 'http://localhost:5050';
  const health = {
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

  // Проверяем доступность Analyz
  try {
    const response = await axios.get(`${ANALYZ_SERVICE_URL}/health`, {
      timeout: 3000
    });
    health.dependencies.analyz.status = response.data?.status === 'healthy' ? 'healthy' : 'unhealthy';
  } catch (error: any) {
    health.dependencies.analyz.status = 'unavailable';
    health.dependencies.analyz.error = error.message;
    health.status = 'degraded'; // Backend работает, но зависимость недоступна
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;

