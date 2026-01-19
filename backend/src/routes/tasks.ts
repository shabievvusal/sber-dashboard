import express from 'express';
import { dbGet, dbAll, dbRun } from '../database';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Локальные обёртки с более свободной типизацией, чтобы удобно передавать параметры
const dbRunAny = dbRun as unknown as (sql: string, params?: any) => Promise<any>;
const dbGetAny = dbGet as unknown as (sql: string, params?: any) => Promise<any>;
const dbAllAny = dbAll as unknown as (sql: string, params?: any) => Promise<any>;

// Get tasks
router.get('/', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    let query = `
      SELECT t.*, c.name as company_name, u.username as assigned_by_username
      FROM tasks t
      JOIN companies c ON t.assigned_company_id = c.id
      JOIN users u ON t.assigned_by_user_id = u.id
    `;
    const params: any[] = [];

    if (req.user?.role === 'manager') {
      query += ' WHERE t.assigned_company_id = ?';
      params.push(req.user.company_id);
    }

    query += ' ORDER BY t.created_at DESC';

    const tasks = await dbAllAny(query, params);

    // Check for expired tasks
    const now = new Date();
    for (const task of tasks as any[]) {
      const createdAt = new Date(task.created_at);
      const expiresAt = new Date(createdAt.getTime() + task.duration_minutes * 60 * 1000);
      
      if (task.status === 'pending' && now > expiresAt) {
        await dbRunAny('UPDATE tasks SET status = ? WHERE id = ?', ['expired', task.id]);
        task.status = 'expired';
      }
    }

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create task
router.post('/', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { title, assigned_company_id, duration_minutes, require_photo } = req.body;

    if (!title || !assigned_company_id || !duration_minutes) {
      return res.status(400).json({ error: 'Title, company, and duration required' });
    }

    if (req.user?.role !== 'admin' && req.user?.role !== 'operator') {
      return res.status(403).json({ error: 'Only admin and operator can create tasks' });
    }

    const created_at = new Date().toISOString();
    await dbRunAny(
      'INSERT INTO tasks (title, assigned_company_id, assigned_by_user_id, created_at, duration_minutes, status, require_photo) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, assigned_company_id, req.user!.id, created_at, duration_minutes, 'pending', require_photo ? 1 : 0]
    );

    // Не пытаемся читать lastID из результата, чтобы избежать ошибок типизации/промисификации
    res.status(201).json({ message: 'Task created successfully' });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update task status
router.patch('/:id/status', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'completed', 'expired'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const task = await dbGetAny('SELECT * FROM tasks WHERE id = ?', [id]) as any;
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (req.user?.role === 'manager' && task.assigned_company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await dbRunAny('UPDATE tasks SET status = ? WHERE id = ?', [status, id]);
    res.json({ message: 'Task status updated' });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete task (admin only)
router.delete('/:id', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admin can delete tasks' });
    }

    const { id } = req.params;
    const task = await dbGetAny('SELECT * FROM tasks WHERE id = ?', [id]) as any;
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await dbRunAny('DELETE FROM tasks WHERE id = ?', [id]);
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update task photo
router.patch('/:id/photo', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { photo_url } = req.body;

    const task = await dbGetAny('SELECT * FROM tasks WHERE id = ?', [id]) as any;
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (req.user?.role === 'manager' && task.assigned_company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await dbRunAny('UPDATE tasks SET photo_url = ? WHERE id = ?', [photo_url, id]);
    res.json({ message: 'Task photo updated' });
  } catch (error) {
    console.error('Error updating task photo:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

