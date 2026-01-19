import express from 'express';
import bcrypt from 'bcrypt';
import { dbGet, dbAll, dbRun } from '../database';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all users (admin only)
router.get('/', requireAuth, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const users = await dbAll(`
      SELECT id, username, role, company_id, modules_config 
      FROM users
    `);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by ID
router.get('/:id', requireAuth, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const user = await dbGet(
      'SELECT id, username, role, company_id, modules_config FROM users WHERE id = ?',
      [req.params.id]
    ) as { id: number; username: string; role: string; company_id: number | null; modules_config: string | null } | undefined;
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get operator modules config (admin can get any operator's config, operator can get only their own)
router.get('/:id/modules', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = parseInt(req.params.id);
    const requestingUser = req.user;
    
    // Проверяем права доступа: админ может получить настройки любого оператора, оператор - только свои
    if (requestingUser?.role !== 'admin' && requestingUser?.id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const user = await dbGet(
      'SELECT id, username, role, modules_config FROM users WHERE id = ? AND role = ?',
      [userId, 'operator']
    ) as { id: number; username: string; role: string; modules_config: string | null } | undefined;
    
    if (!user) {
      return res.status(404).json({ error: 'Operator not found' });
    }
    
    const defaultModules = [
      { id: 'summary', visible: true },
      { id: 'analyz', visible: true },
      { id: 'reports', visible: true },
      { id: 'serviceNote', visible: true }
    ];
    
    let modules = user.modules_config 
      ? JSON.parse(user.modules_config) 
      : defaultModules;
    
    // Убеждаемся, что serviceNote есть в списке модулей (для старых конфигов)
    const hasServiceNote = modules.some((m: any) => m.id === 'serviceNote');
    if (!hasServiceNote) {
      modules.push({ id: 'serviceNote', visible: true });
    }
    
    res.json({ modules });
  } catch (error) {
    console.error('Error fetching operator modules:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update operator modules config
router.put('/:id/modules', requireAuth, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    let { modules } = req.body;
    const userId = parseInt(req.params.id);
    
    if (!Array.isArray(modules)) {
      return res.status(400).json({ error: 'modules must be an array' });
    }
    
    // Проверяем, что это оператор
    const user = await dbGet(
      'SELECT role FROM users WHERE id = ?',
      [userId]
    ) as { role: string } | undefined;
    
    if (!user || user.role !== 'operator') {
      return res.status(400).json({ error: 'User must be an operator' });
    }
    
    // Убеждаемся, что serviceNote есть в списке модулей
    const hasServiceNote = modules.some((m: any) => m.id === 'serviceNote');
    if (!hasServiceNote) {
      modules.push({ id: 'serviceNote', visible: true });
    }
    
    await dbRun(
      'UPDATE users SET modules_config = ? WHERE id = ?',
      [JSON.stringify(modules), userId]
    );
    
    res.json({ message: 'Modules config updated successfully', modules });
  } catch (error) {
    console.error('Error updating operator modules:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create user
router.post('/', requireAuth, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const { username, password, role, company_id } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Username, password, and role required' });
    }

    if (!['admin', 'operator', 'manager'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await dbRun(
      'INSERT INTO users (username, password, role, company_id) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, role, company_id || null]
    );

    res.status(201).json({ id: (result as any).lastID, username, role, company_id });
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user
router.put('/:id', requireAuth, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const { username, password, role, company_id } = req.body;
    const userId = parseInt(req.params.id);

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await dbRun(
        'UPDATE users SET username = ?, password = ?, role = ?, company_id = ? WHERE id = ?',
        [username, hashedPassword, role, company_id || null, userId]
      );
    } else {
      await dbRun(
        'UPDATE users SET username = ?, role = ?, company_id = ? WHERE id = ?',
        [username, role, company_id || null, userId]
      );
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user
router.delete('/:id', requireAuth, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const userId = parseInt(req.params.id);
    await dbRun('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;





