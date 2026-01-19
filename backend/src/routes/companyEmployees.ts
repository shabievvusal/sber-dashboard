import express from 'express';
import { dbGet, dbRun, dbAll } from '../database';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get employees count for company
router.get('/:companyId', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const today = new Date().toISOString().split('T')[0];
    
    const result = await dbGet(`
      SELECT employees_count 
      FROM company_employees 
      WHERE company_id = ? AND date = ?
    `, [companyId, today]) as { employees_count?: number } | undefined;

    res.json({ employees_count: result?.employees_count || 0 });
  } catch (error) {
    console.error('Error fetching employees count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set employees count for company
router.post('/:companyId', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const companyId = parseInt(req.params.companyId);
    const { employees_count } = req.body;
    const today = new Date().toISOString().split('T')[0];

    if (req.user?.role === 'manager' && req.user.company_id !== companyId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await dbRun(`
      INSERT INTO company_employees (company_id, date, employees_count)
      VALUES (?, ?, ?)
      ON CONFLICT(company_id, date)
      DO UPDATE SET employees_count = excluded.employees_count
    `, [companyId, today, employees_count || 0]);

    res.json({ message: 'Employees count saved' });
  } catch (error) {
    console.error('Error saving employees count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all companies employees count
router.get('/', requireAuth, requireRole('admin', 'operator'), async (req: AuthRequest, res: express.Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get all active companies and their employees count
    const companies = await dbAll(
      'SELECT id, name FROM companies WHERE is_active IS NULL OR is_active = 1'
    ) as Array<{ id: number; name: string }>;
    const employeesData = await dbAll(`
      SELECT ce.*, c.name as company_name
      FROM company_employees ce
      JOIN companies c ON ce.company_id = c.id
      WHERE ce.date = ?
    `, [today]) as Array<{ company_id: number; employees_count: number; company_name: string }>;

    const resultMap: Record<number, number> = {};
    employeesData.forEach((row: any) => {
      resultMap[row.company_id] = row.employees_count;
    });

    const result = companies.map((c) => ({
      company_id: c.id,
      company_name: c.name,
      employees_count: resultMap[c.id] || 0
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching employees counts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

