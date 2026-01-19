import express from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import sqlite3 from 'sqlite3';
import path from 'path';

const router = express.Router();

// Путь к базе данных Analyz
const analyzDbPath = path.join(__dirname, '../../../Analyz/database.sqlite3');

// Поиск товара по артикулу SAP (GROUP_CODE) или штрихкоду (BARCODE)
router.get('/search', requireAuth, async (req: AuthRequest, res: express.Response) => {
  try {
    const code = req.query.code as string;

    if (!code || !code.trim()) {
      return res.status(400).json({ error: 'Код не указан' });
    }

    const searchCode = code.trim();

    // Подключаемся к базе данных Analyz
    const db = new sqlite3.Database(analyzDbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error('Error opening Analyz database:', err);
        return res.status(500).json({ error: 'Ошибка подключения к базе данных' });
      }
    });

    // Сначала пробуем найти по штрихкоду (BARCODE)
    db.get(
      'SELECT group_code, product_name FROM products WHERE barcode = ? LIMIT 1',
      [searchCode],
      (err, row: any) => {
        if (err) {
          db.close();
          console.error('Error searching product by barcode:', err);
          return res.status(500).json({ error: 'Ошибка при поиске товара' });
        }

        if (row) {
          // Найден по штрихкоду - возвращаем GROUP_CODE и PRODUCT_NAME
          db.close();
          return res.json({ 
            found: true,
            searchType: 'barcode',
            groupCode: row.group_code,
            productName: row.product_name || null
          });
        }

        // Если не найден по штрихкоду, ищем по GROUP_CODE
        db.get(
          'SELECT DISTINCT group_code, product_name FROM products WHERE group_code = ? AND product_name IS NOT NULL AND product_name != "" LIMIT 1',
          [searchCode],
          (err2, row2: any) => {
            db.close();

            if (err2) {
              console.error('Error searching product by group_code:', err2);
              return res.status(500).json({ error: 'Ошибка при поиске товара' });
            }

            if (row2) {
              // Найден по GROUP_CODE - возвращаем PRODUCT_NAME
              res.json({ 
                found: true,
                searchType: 'group_code',
                groupCode: row2.group_code,
                productName: row2.product_name
              });
            } else {
              res.json({ 
                found: false,
                searchType: null,
                groupCode: null,
                productName: null
              });
            }
          }
        );
      }
    );
  } catch (error) {
    console.error('Error in product search:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

