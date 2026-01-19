import express from 'express';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { dbGet, dbAll, dbRun } from '../database';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Локальные обёртки с более свободной типизацией
const dbRunAny = dbRun as unknown as (sql: string, params?: any) => Promise<any>;
const dbGetAny = dbGet as unknown as (sql: string, params?: any) => Promise<any>;
const dbAllAny = dbAll as unknown as (sql: string, params?: any) => Promise<any[]>;

// Функция определения кодировки (как в employeesMapping.ts)
function detectEncoding(buffer: Buffer): 'utf8' | 'cp1251' {
  try {
    const cp1251Text = iconv.decode(buffer, 'cp1251');
    // Проверяем наличие типичных кракозябр, которые появляются при неправильной кодировке
    if (cp1251Text.includes('пїЅ') || cp1251Text.includes('РїРѕ') || cp1251Text.includes('Ð')) {
      return 'utf8';
    }
    // Если текст выглядит нормально, используем cp1251
    return 'cp1251';
  } catch {
    return 'utf8';
  }
}

// Проверка штрих-кода (сотрудник или ТСД)
router.get('/check/:barcode', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { barcode } = req.params;

    // Проверяем, является ли это логином сотрудника из employees.csv
    const EMPLOYEES_CSV_PATH = path.resolve(__dirname, '../../../Analyz/employees.csv');
    if (fs.existsSync(EMPLOYEES_CSV_PATH)) {
      try {
        // Читаем файл как Buffer для определения кодировки
        const buffer = fs.readFileSync(EMPLOYEES_CSV_PATH);
        const encoding = detectEncoding(buffer);
        const csvContent = encoding === 'cp1251' 
          ? iconv.decode(buffer, 'cp1251')
          : buffer.toString('utf-8');
        
        const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
        
        for (const line of lines) {
          const parts = line.split(';');
          const code = parts[0]?.trim();
          const company = parts[1]?.trim();
          const name = parts[2]?.trim();
          
          // Сравниваем без учета регистра
          if (code && code.toLowerCase() === barcode.toLowerCase()) {
            return res.json({
              type: 'employee',
              login: code,
              name: name || code,
              company: company || null
            });
          }
        }
      } catch (error) {
        console.error('Error reading employees.csv:', error);
      }
    }

    // Если не найден в CSV, используем barcode как логин сотрудника

    // Проверяем, является ли это ТСД (ищем активную выдачу)
    const activeIssue = await dbGetAny(
      `SELECT * FROM tsd_transactions 
       WHERE tsd_number = ? AND status = 'issued' 
       ORDER BY issue_time DESC LIMIT 1`,
      [barcode]
    );

    if (activeIssue) {
      return res.json({
        type: 'tsd',
        tsd_number: activeIssue.tsd_number,
        status: 'issued',
        employee_login: activeIssue.employee_login,
        employee_name: activeIssue.employee_name,
        company: activeIssue.company,
        issue_time: activeIssue.issue_time
      });
    }

    // Если не найден ни сотрудник, ни активная выдача, считаем это новым ТСД
    return res.json({
      type: 'tsd',
      tsd_number: barcode,
      status: 'available'
    });
  } catch (error) {
    console.error('Error checking barcode:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Массовая выдача ТСД компании (для бригадиров)
router.post('/issue-bulk-company', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { company, tsd_numbers } = req.body;

    if (!company || !Array.isArray(tsd_numbers) || tsd_numbers.length === 0) {
      return res.status(400).json({ error: 'company и tsd_numbers (массив) обязательны' });
    }

    const results = [];
    const errors = [];

    for (const tsd_number of tsd_numbers) {
      if (!tsd_number || !tsd_number.trim()) continue;

      try {
        // Проверяем, не выдан ли уже этот ТСД
        const activeIssue = await dbGetAny(
          `SELECT * FROM tsd_transactions 
           WHERE tsd_number = ? AND status = 'issued' 
           ORDER BY issue_time DESC LIMIT 1`,
          [tsd_number.trim()]
        );

        if (activeIssue) {
          errors.push({
            tsd_number: tsd_number.trim(),
            error: 'ТСД уже выдан'
          });
          continue;
        }

        // Создаем запись о выдаче компании (без сотрудника)
        const result = await dbRunAny(
          `INSERT INTO tsd_transactions 
           (employee_login, employee_name, company, tsd_number, status, operator_id, issue_time)
           VALUES (?, ?, ?, ?, 'issued', ?, datetime('now', 'localtime'))`,
          ['BRIGADIER', null, company, tsd_number.trim(), req.user?.id || null]
        );

        const transaction = await dbGetAny(
          'SELECT * FROM tsd_transactions WHERE id = ?',
          [result.lastID]
        );

        results.push(transaction);
      } catch (err: any) {
        errors.push({
          tsd_number: tsd_number.trim(),
          error: err.message || 'Ошибка при выдаче'
        });
      }
    }

    res.json({
      success: true,
      issued: results,
      errors: errors,
      total_issued: results.length,
      total_errors: errors.length
    });
  } catch (error) {
    console.error('Error bulk issuing TSD to company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Выдача ТСД
router.post('/issue', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { employee_login, employee_name, company, tsd_number } = req.body;

    if (!employee_login || !tsd_number) {
      return res.status(400).json({ error: 'employee_login и tsd_number обязательны' });
    }

    // Проверяем, не выдан ли уже этот ТСД
    const activeIssue = await dbGetAny(
      `SELECT * FROM tsd_transactions 
       WHERE tsd_number = ? AND status = 'issued' 
       ORDER BY issue_time DESC LIMIT 1`,
      [tsd_number]
    );

    if (activeIssue) {
      return res.status(400).json({ 
        error: 'ТСД уже выдан',
        details: {
          employee: activeIssue.employee_name || activeIssue.employee_login,
          issue_time: activeIssue.issue_time
        }
      });
    }

    // Проверяем, сколько ТСД уже на руках у сотрудника (максимум 2)
    const employeeActiveIssues = await dbAllAny(
      `SELECT * FROM tsd_transactions 
       WHERE employee_login = ? AND status = 'issued'`,
      [employee_login]
    );

    if (employeeActiveIssues.length >= 2) {
      return res.status(400).json({ 
        error: 'У сотрудника уже на руках максимальное количество ТСД (2)',
        details: {
          current_count: employeeActiveIssues.length,
          max_allowed: 2
        }
      });
    }

    // Создаем запись о выдаче
    const result = await dbRunAny(
      `INSERT INTO tsd_transactions 
       (employee_login, employee_name, company, tsd_number, status, operator_id, issue_time)
       VALUES (?, ?, ?, ?, 'issued', ?, datetime('now', 'localtime'))`,
      [employee_login, employee_name || null, company || null, tsd_number, req.user?.id || null]
    );

    const transaction = await dbGetAny(
      'SELECT * FROM tsd_transactions WHERE id = ?',
      [result.lastID]
    );

    res.json({ success: true, transaction });
  } catch (error) {
    console.error('Error issuing TSD:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Массовый возврат ТСД компании
router.post('/return-bulk-company', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { company, tsd_numbers } = req.body;

    if (!company || !Array.isArray(tsd_numbers) || tsd_numbers.length === 0) {
      return res.status(400).json({ error: 'company и tsd_numbers (массив) обязательны' });
    }

    const results = [];
    const errors = [];

    for (const tsd_number of tsd_numbers) {
      if (!tsd_number || !tsd_number.trim()) continue;

      try {
        // Находим активную выдачу для этой компании
        const activeIssue = await dbGetAny(
          `SELECT * FROM tsd_transactions 
           WHERE tsd_number = ? AND company = ? AND status = 'issued' 
           ORDER BY issue_time DESC LIMIT 1`,
          [tsd_number.trim(), company]
        );

        if (!activeIssue) {
          errors.push({
            tsd_number: tsd_number.trim(),
            error: 'Активная выдача не найдена для этого ТСД'
          });
          continue;
        }

        // Обновляем запись
        await dbRunAny(
          `UPDATE tsd_transactions 
           SET return_time = datetime('now', 'localtime'), status = 'returned'
           WHERE id = ?`,
          [activeIssue.id]
        );

        const updatedTransaction = await dbGetAny(
          'SELECT * FROM tsd_transactions WHERE id = ?',
          [activeIssue.id]
        );

        results.push(updatedTransaction);
      } catch (err: any) {
        errors.push({
          tsd_number: tsd_number.trim(),
          error: err.message || 'Ошибка при возврате'
        });
      }
    }

    res.json({
      success: true,
      returned: results,
      errors: errors,
      total_returned: results.length,
      total_errors: errors.length
    });
  } catch (error) {
    console.error('Error bulk returning TSD from company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Возврат ТСД
router.post('/return', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { tsd_number } = req.body;

    if (!tsd_number) {
      return res.status(400).json({ error: 'tsd_number обязателен' });
    }

    // Находим активную выдачу
    const activeIssue = await dbGetAny(
      `SELECT * FROM tsd_transactions 
       WHERE tsd_number = ? AND status = 'issued' 
       ORDER BY issue_time DESC LIMIT 1`,
      [tsd_number]
    );

    if (!activeIssue) {
      return res.status(404).json({ error: 'Активная выдача не найдена для этого ТСД' });
    }

    // Обновляем запись
    await dbRunAny(
      `UPDATE tsd_transactions 
       SET return_time = datetime('now', 'localtime'), status = 'returned'
       WHERE id = ?`,
      [activeIssue.id]
    );

    const updatedTransaction = await dbGetAny(
      'SELECT * FROM tsd_transactions WHERE id = ?',
      [activeIssue.id]
    );

    res.json({ success: true, transaction: updatedTransaction });
  } catch (error) {
    console.error('Error returning TSD:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Получить активные выдачи
router.get('/active', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const activeIssues = await dbAllAny(
      `SELECT * FROM tsd_transactions 
       WHERE status = 'issued' 
       ORDER BY issue_time DESC`
    );

    res.json(activeIssues);
  } catch (error) {
    console.error('Error fetching active issues:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// История операций
router.get('/history', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { 
      startDate, 
      endDate, 
      status, 
      employee_login, 
      tsd_number,
      limit = 1000,
      offset = 0
    } = req.query;

    let query = 'SELECT * FROM tsd_transactions WHERE 1=1';
    const params: any[] = [];

    if (startDate) {
      query += ' AND date(issue_time) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND date(issue_time) <= ?';
      params.push(endDate);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (employee_login) {
      query += ' AND employee_login LIKE ?';
      params.push(`%${employee_login}%`);
    }

    if (tsd_number) {
      query += ' AND tsd_number LIKE ?';
      params.push(`%${tsd_number}%`);
    }

    query += ' ORDER BY issue_time DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit as string), parseInt(offset as string));

    const history = await dbAllAny(query, params);

    // Получаем общее количество для пагинации
    let countQuery = 'SELECT COUNT(*) as total FROM tsd_transactions WHERE 1=1';
    const countParams: any[] = [];

    if (startDate) {
      countQuery += ' AND date(issue_time) >= ?';
      countParams.push(startDate);
    }
    if (endDate) {
      countQuery += ' AND date(issue_time) <= ?';
      countParams.push(endDate);
    }
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    if (employee_login) {
      countQuery += ' AND employee_login LIKE ?';
      countParams.push(`%${employee_login}%`);
    }
    if (tsd_number) {
      countQuery += ' AND tsd_number LIKE ?';
      countParams.push(`%${tsd_number}%`);
    }

    const countResult = await dbGetAny(countQuery, countParams);

    res.json({
      history,
      total: countResult?.total || 0,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Удаление записи (только для админа)
router.delete('/:id', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    // Проверяем, что пользователь - админ
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ запрещен. Только администратор может удалять записи.' });
    }

    const { id } = req.params;
    
    // Проверяем существование записи
    const transaction = await dbGetAny('SELECT * FROM tsd_transactions WHERE id = ?', [id]);
    
    if (!transaction) {
      return res.status(404).json({ error: 'Запись не найдена' });
    }

    // Удаляем запись
    await dbRunAny('DELETE FROM tsd_transactions WHERE id = ?', [id]);

    res.json({ success: true, message: 'Запись удалена' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Получить статистику по компаниям
router.get('/stats', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { company } = req.query;
    
    let query = `
      SELECT 
        COALESCE(company, 'Без компании') as company,
        COUNT(CASE WHEN status = 'issued' THEN 1 END) as issued_count,
        COUNT(CASE WHEN status = 'returned' THEN 1 END) as returned_count,
        GROUP_CONCAT(CASE WHEN status = 'issued' THEN tsd_number END, ',') as issued_tsd_numbers,
        COUNT(CASE WHEN status = 'issued' AND employee_login = 'BRIGADIER' THEN 1 END) as company_issued_count
       FROM tsd_transactions
       WHERE company IS NOT NULL AND company != ''
    `;
    
    const params: any[] = [];
    
    // Если указана компания, фильтруем по ней
    if (company) {
      query += ' AND company = ?';
      params.push(company);
    }
    
    // Если менеджер, показываем только его компанию
    if (req.user?.role === 'manager' && req.user?.company_id) {
      const companyName = await dbGetAny('SELECT name FROM companies WHERE id = ?', [req.user.company_id]);
      if (companyName) {
        query += ' AND company = ?';
        params.push(companyName.name);
      }
    }
    
    query += ' GROUP BY company ORDER BY company';
    
    const stats = await dbAllAny(query, params);

    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Экспорт истории в CSV
router.get('/export', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { startDate, endDate, status } = req.query;

    let query = 'SELECT * FROM tsd_transactions WHERE 1=1';
    const params: any[] = [];

    if (startDate) {
      query += ' AND date(issue_time) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND date(issue_time) <= ?';
      params.push(endDate);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY issue_time DESC';

    const history = await dbAllAny(query, params);

    // Формируем CSV
    const headers = ['ID', 'Время выдачи', 'Логин сотрудника', 'ФИО', 'Компания', 'Номер ТСД', 'Время возврата', 'Статус'];
    const rows = history.map((t: any) => [
      t.id,
      t.issue_time,
      t.employee_login,
      t.employee_name || '',
      t.company || '',
      t.tsd_number,
      t.return_time || '',
      t.status === 'issued' ? 'На руках' : 'Возвращено'
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row: any[]) => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tsd_history_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send('\ufeff' + csv); // BOM для Excel
  } catch (error) {
    console.error('Error exporting history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

