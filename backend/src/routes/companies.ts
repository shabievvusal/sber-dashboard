import express from 'express';
import { dbAll, dbRun, dbGet } from '../database';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Локальные обёртки для удобной работы с promisify
const dbRunAny = dbRun as unknown as (sql: string, params?: any) => Promise<any>;
const dbAllAny = dbAll as unknown as (sql: string, params?: any) => Promise<any>;
const dbGetAny = dbGet as unknown as (sql: string, params?: any) => Promise<any>;

// Get all active companies
router.get('/', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    // Показываем только активные компании (is_active = 1 или NULL для совместимости)
    const companies = await dbAllAny(
      'SELECT id, name, is_active FROM companies WHERE is_active IS NULL OR is_active = 1 ORDER BY name'
    );
    res.json(companies);
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new company
router.post('/', requireAuth, requireRole('admin'), async (req: AuthRequest, res: express.Response) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Company name required' });
    }

    await dbRunAny('INSERT INTO companies (name, is_active) VALUES (?, 1)', [name.trim()]);

    // Находим только что созданную компанию по имени
    const created = await dbGetAny(
      'SELECT id, name, is_active FROM companies WHERE name = ? ORDER BY id DESC LIMIT 1',
      [name.trim()]
    );

    res.status(201).json(created);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Company with this name already exists' });
    }
    console.error('Error creating company:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle company active (hide/show instead of hard delete)
router.patch('/:id/active', requireAuth, requireRole('admin'), async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'number' && typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be boolean or 0/1' });
    }

    const activeValue = is_active ? 1 : 0;
    await dbRun('UPDATE companies SET is_active = ? WHERE id = ?', [activeValue, id]);

    res.json({ message: 'Company visibility updated' });
  } catch (error) {
    console.error('Error updating company visibility:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



