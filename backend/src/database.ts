import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import bcrypt from 'bcrypt';
import path from 'path';

const dbPath = path.join(__dirname, '../database.db');
const db = new sqlite3.Database(dbPath);

// Promisify database methods with proper typing
const dbRun = (sql: string, params?: any[]): Promise<sqlite3.RunResult> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params || [], function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (sql: string, params?: any[]): Promise<any> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbAll = (sql: string, params?: any[]): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params || [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

export interface User {
  id: number;
  username: string;
  password: string;
  role: 'admin' | 'operator' | 'manager';
  company_id: number | null;
}

export interface Company {
  id: number;
  name: string;
}

export interface HourlyData {
  id: number;
  company_id: number;
  operation_type: string;
  hour: string;
  value: number;
}

export interface Task {
  id: number;
  title: string;
  assigned_company_id: number;
  assigned_by_user_id: number;
  created_at: string;
  duration_minutes: number;
  status: 'pending' | 'completed' | 'expired';
  photo_url: string | null;
}

export interface TSDTransaction {
  id: number;
  issue_time: string;
  employee_login: string;
  employee_name: string | null;
  company: string | null;
  tsd_number: string;
  return_time: string | null;
  status: 'issued' | 'returned';
  operator_id: number | null;
}

const OPERATIONS = [
  'Комплектация',
  'Размиксовка',
  'Уборка Холод',
  'Уборка Сухой',
  'Пресс',
  'Уборка Паллет',
  'Отгрузка паллет',
  'Подвоз РК',
  'Замотка РК'
];

const COMPANIES = ['Мувинг', 'ЭСК', 'Градусы', '2колеса'];

export async function initDatabase() {
  // Create tables
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'manager')),
      company_id INTEGER,
      modules_config TEXT,
      FOREIGN KEY (company_id) REFERENCES companies(id)
    )
  `);
  
  // Добавляем колонку modules_config если её нет (для существующих БД)
  try {
    await dbRun(`ALTER TABLE users ADD COLUMN modules_config TEXT`);
  } catch (e: any) {
    // Колонка уже существует, игнорируем ошибку
    if (!e.message?.includes('duplicate column name')) {
      console.warn('Could not add modules_config column:', e.message);
    }
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS hourly_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      operation_type TEXT NOT NULL,
      hour TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (company_id) REFERENCES companies(id),
      UNIQUE(company_id, operation_type, hour)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      assigned_company_id INTEGER NOT NULL,
      assigned_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'expired')),
      photo_url TEXT,
      require_photo INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (assigned_company_id) REFERENCES companies(id),
      FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS company_employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      employees_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (company_id) REFERENCES companies(id),
      UNIQUE(company_id, date)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS tsd_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      employee_login TEXT NOT NULL,
      employee_name TEXT,
      company TEXT,
      tsd_number TEXT NOT NULL,
      return_time TEXT,
      status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued', 'returned')),
      operator_id INTEGER,
      FOREIGN KEY (operator_id) REFERENCES users(id)
    )
  `);

  // Миграция: добавление колонки is_active в таблицу companies, если её нет
  try {
    const companiesTableInfo = await dbAll('PRAGMA table_info(companies)') as any[];
    const hasIsActive = companiesTableInfo.some((col: any) => col.name === 'is_active');

    if (!hasIsActive) {
      await dbRun('ALTER TABLE companies ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
      console.log('Added is_active column to companies table');
    }
  } catch (error: any) {
    console.error('Error adding is_active column:', error.message);
  }

  // Миграция: добавление колонки require_photo в таблицу tasks, если её нет
  try {
    // Проверяем, существует ли колонка
    const tableInfo = await dbAll('PRAGMA table_info(tasks)') as any[];
    const hasRequirePhoto = tableInfo.some((col: any) => col.name === 'require_photo');
    
    if (!hasRequirePhoto) {
      await dbRun('ALTER TABLE tasks ADD COLUMN require_photo INTEGER NOT NULL DEFAULT 0');
      console.log('Added require_photo column to tasks table');
    }
  } catch (error: any) {
    console.error('Error adding require_photo column:', error.message);
  }

  // Insert companies
  for (const companyName of COMPANIES) {
    await dbRun(`INSERT OR IGNORE INTO companies (name) VALUES (?)`, [companyName]);
  }

  // Get company IDs
  const companies = await dbAll('SELECT id, name FROM companies') as Company[];
  const companyMap: Record<string, number> = {};
  companies.forEach(c => companyMap[c.name] = c.id);

  // Insert default users
  const users = [
    { username: 'admin', password: 'admin123', role: 'admin' as const, company_id: null },
    { username: 'operator', password: 'operator123', role: 'operator' as const, company_id: null },
    { username: 'manager_muving', password: 'muving123', role: 'manager' as const, company_id: companyMap['Мувинг'] },
    { username: 'manager_esk', password: 'esk123', role: 'manager' as const, company_id: companyMap['ЭСК'] },
    { username: 'manager_gradusy', password: 'gradusy123', role: 'manager' as const, company_id: companyMap['Градусы'] },
    { username: 'manager_2kolesa', password: '2kolesa123', role: 'manager' as const, company_id: companyMap['2колеса'] },
  ];

  for (const user of users) {
    const existing = await dbGet('SELECT id FROM users WHERE username = ?', [user.username]) as User | undefined;
    if (!existing) {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      await dbRun(
        'INSERT INTO users (username, password, role, company_id) VALUES (?, ?, ?, ?)',
        [user.username, hashedPassword, user.role, user.company_id]
      );
    }
  }

  console.log('Database initialized');
}

export { db, dbRun, dbGet, dbAll, OPERATIONS, COMPANIES };



