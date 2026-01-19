import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';
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

const app = express();
const PORT = process.env.PORT || 5000;
const ANALYZ_SERVICE_URL = process.env.ANALYZ_SERVICE_URL || 'http://localhost:5050';
const ANALYZ_PROXY_TIMEOUT_MS = Number.parseInt(
  process.env.ANALYZ_PROXY_TIMEOUT_MS || '600000',
  10
); // 10 минут по умолчанию

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.use(
  '/integrations/analyz',
  createProxyMiddleware({
    target: ANALYZ_SERVICE_URL,
    changeOrigin: true,
    ws: true,
    // Для тяжелых операций (загрузка/анализ больших файлов) нужно больше времени, иначе получаем 504,
    // даже если Flask успел всё обработать и записать результаты.
    proxyTimeout: ANALYZ_PROXY_TIMEOUT_MS,
    timeout: ANALYZ_PROXY_TIMEOUT_MS,
    pathRewrite: (pathStr: string) => {
      const rewritten = pathStr.replace(/^\/integrations\/analyz/, '');
      return rewritten === '' ? '/' : rewritten;
    }
  })
);

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

// Initialize database and start server
initDatabase().then(() => {
  const HOST = process.env.HOST || '0.0.0.0'; // Слушать на всех интерфейсах
  const portNumber = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
  app.listen(portNumber, HOST, () => {
    console.log(`Server running on http://${HOST}:${portNumber}`);
    console.log(`Server also accessible at http://localhost:${portNumber}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});



