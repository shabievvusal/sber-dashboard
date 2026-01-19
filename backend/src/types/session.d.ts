// Расширение типов сессии Express
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    user?: {
      id: number;
      username: string;
      role: 'admin' | 'operator' | 'manager';
      company_id: number | null;
    };
  }
}









