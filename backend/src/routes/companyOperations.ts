import express from 'express';
import { dbGet, dbAll, dbRun } from '../database';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get operations for a company
router.get('/:companyId', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const companyId = parseInt(req.params.companyId);
    
    // Check if manager can access this company
    if (req.user?.role === 'manager' && req.user.company_id !== companyId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const operations = await dbAll(`
      SELECT DISTINCT operation_type 
      FROM hourly_data 
      WHERE company_id = ?
      ORDER BY operation_type
    `, [companyId]) as Array<{ operation_type: string }>;
    
    res.json(operations.map((op) => op.operation_type));
  } catch (error) {
    console.error('Error fetching company operations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add operation to company
router.post('/:companyId', requireAuth, requireRole('admin', 'operator'), async (req: AuthRequest, res: express.Response) => {
  try {
    const { companyId } = req.params;
    const { operation_type } = req.body;

    if (!operation_type) {
      return res.status(400).json({ error: 'Operation type required' });
    }

    // Create entry for current hour for all hours today
    const today = new Date().toISOString().split('T')[0];
    const hours = Array.from({ length: 12 }, (_, i) => 10 + i);
    
    for (const hour of hours) {
      const hourStr = `${today} ${hour.toString().padStart(2, '0')}:00:00`;
      await dbRun(`
        INSERT OR IGNORE INTO hourly_data (company_id, operation_type, hour, value)
        VALUES (?, ?, ?, 0)
      `, [companyId, operation_type, hourStr]);
    }

    res.json({ message: 'Operation added successfully' });
  } catch (error) {
    console.error('Error adding operation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete operation from company
router.delete('/:companyId/:operationType', requireAuth, requireRole('admin', 'operator'), async (req: AuthRequest, res: express.Response) => {
  try {
    const { companyId, operationType } = req.params;

    await dbRun(`
      DELETE FROM hourly_data 
      WHERE company_id = ? AND operation_type = ?
    `, [companyId, decodeURIComponent(operationType)]);

    res.json({ message: 'Operation deleted successfully' });
  } catch (error) {
    console.error('Error deleting operation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

