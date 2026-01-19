import express from 'express';
import bcrypt from 'bcrypt';
import { dbGet } from '../database';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();

router.post('/login', async (req: AuthRequest, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await dbGet(
      'SELECT id, username, password, role, company_id FROM users WHERE username = ?',
      [username]
    ) as any;

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    (req.session as any).user = {
      id: user.id,
      username: user.username,
      role: user.role,
      company_id: user.company_id
    };

    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        company_id: user.company_id
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (req: AuthRequest, res) => {
  req.session?.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

router.get('/me', (req: AuthRequest, res) => {
  if (!req.session || !(req.session as any).user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ user: (req.session as any).user });
});

export default router;





