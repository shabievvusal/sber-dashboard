import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
// Прокси middleware больше не нужен - frontend обращается напрямую к Analyz через nginx
import { initDatabase } from './database';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import companiesRoutes from './routes/companies';
import hourlyDataRoutes from './routes/hourlyData';
import tasksRoutes from './routes/tasks';
import uploadRoutes from './routes/upload';
import companyOperationsRoutes from './routes/companyOperations';
import companyEmployeesRoutes from './routes/companyEmployees';
import employeesMappingRoutes from './routes/employeesMapping';
import tsdRoutes from './routes/tsd';
import serviceNoteRoutes from './routes/serviceNote';
import productsRoutes from './routes/products';
import healthRoutes from './routes/health';

const app = express();
const PORT = process.env.PORT || 5000;
// ANALYZ_SERVICE_URL больше не нужен - frontend обращается напрямую через nginx

// Middleware
// CORS: разрешаем запросы с localhost и с внешнего IP
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',')
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: function (origin, callback) {
    // Разрешаем запросы без origin (например, Postman) или из разрешенных источников
    if (!origin || allowedOrigins.some(allowed => origin.startsWith(allowed.replace(':3000', '')))) {
      callback(null, true);
    } else {
      // В продакшене можно быть строже, но для разработки разрешаем все
      callback(null, true);
    }
  },
  credentials: true
}));
// Увеличиваем лимит размера тела запроса для проксирования больших файлов в Analyz
// По умолчанию Express имеет лимит 100kb, увеличиваем до 100MB
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use(session({
  secret: 'ops-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Прокси для Analyz сервиса УДАЛЕН - теперь frontend обращается напрямую через nginx
// Это упрощает архитектуру и убирает двойное проксирование

// Health check (до других маршрутов для быстрой проверки)
app.use('/health', healthRoutes);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/hourly-data', hourlyDataRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/company-operations', companyOperationsRoutes);
app.use('/api/company-employees', companyEmployeesRoutes);
app.use('/api/employees-mapping', employeesMappingRoutes);
app.use('/api/tsd', tsdRoutes);
app.use('/api/service-note', serviceNoteRoutes);
app.use('/api/products', productsRoutes);

// Error handling middleware (должен быть после всех маршрутов)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return res.status(502).json({ error: 'Bad Gateway', message: 'Service unavailable' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Graceful shutdown
let server: any = null;

const gracefulShutdown = (signal: string) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  if (server) {
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
    
    // Принудительное завершение через 10 секунд
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Initialize database and start server
initDatabase().then(() => {
  const HOST = process.env.HOST || '0.0.0.0'; // Слушать на всех интерфейсах
  const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
  server = app.listen(portNumber, HOST, () => {
    console.log(`Server running on http://${HOST}:${portNumber}`);
    console.log(`Server also accessible at http://localhost:${portNumber}`);
    console.log(`Health check available at http://${HOST}:${portNumber}/health`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});



