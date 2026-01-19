import express from 'express';
import { dbGet, dbAll, dbRun, OPERATIONS, COMPANIES } from '../database';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get hourly data for a specific hour
router.get('/:hour', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { hour } = req.params;
    const { company_id } = req.query;

    let query = `
      SELECT hd.*, c.name as company_name
      FROM hourly_data hd
      JOIN companies c ON hd.company_id = c.id
      WHERE hd.hour = ?
    `;
    const params: any[] = [hour];

    if (company_id && req.user?.role === 'manager') {
      query += ' AND hd.company_id = ?';
      params.push(company_id);
    }

    const data = await dbAll(query, params) as any[];
    res.json(data);
  } catch (error) {
    console.error('Error fetching hourly data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get summary data for a specific hour (for summary table)
router.get('/summary/:hour', requireAuth, requireRole('admin', 'operator'), async (req: AuthRequest, res) => {
  try {
    const { hour } = req.params;
    const data = await dbAll(`
      SELECT hd.*, c.name as company_name
      FROM hourly_data hd
      JOIN companies c ON hd.company_id = c.id
      WHERE hd.hour = ?
    `, [hour]) as Array<{ operation_type: string; company_name: string; value: number }>;

    // Get all companies from database (not just from constant)
    const allCompanies = await dbAll('SELECT name FROM companies ORDER BY name') as Array<{ name: string }>;
    const companyNames = allCompanies.map(c => c.name);

    // Get all unique operations from data
    const operationsSet = new Set<string>();
    data.forEach((row) => {
      operationsSet.add(row.operation_type);
    });
    const operations = Array.from(operationsSet);

    // Transform data into summary format
    const summary: Record<string, Record<string, number>> = {};
    
    operations.forEach(op => {
      summary[op] = {};
      // Use all companies from database, not just constant
      companyNames.forEach(company => {
        summary[op][company] = 0;
      });
      summary[op]['Итого'] = 0;
    });

    data.forEach((row) => {
      const op = row.operation_type;
      const company = row.company_name;
      const value = row.value || 0;
      
      if (summary[op] && summary[op][company] !== undefined) {
        summary[op][company] = value;
        summary[op]['Итого'] += value;
      }
    });

    res.json(summary);
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create or update hourly data
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { company_id, operation_type, hour, value } = req.body;

    if (req.user?.role === 'manager' && req.user.company_id !== company_id) {
      return res.status(403).json({ error: 'Forbidden: Cannot edit other company data' });
    }

    await dbRun(`
      INSERT INTO hourly_data (company_id, operation_type, hour, value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(company_id, operation_type, hour)
      DO UPDATE SET value = excluded.value
    `, [company_id, operation_type, hour, value || 0]);

    res.json({ message: 'Data saved successfully' });
  } catch (error) {
    console.error('Error saving hourly data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk update hourly data (for admin inline editing)
router.put('/bulk', requireAuth, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const { updates } = req.body; // Array of { company_id, operation_type, hour, value }

    for (const update of updates) {
      await dbRun(`
        INSERT INTO hourly_data (company_id, operation_type, hour, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(company_id, operation_type, hour)
        DO UPDATE SET value = excluded.value
      `, [update.company_id, update.operation_type, update.hour, update.value || 0]);
    }

    res.json({ message: 'Data updated successfully' });
  } catch (error) {
    console.error('Error updating hourly data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



