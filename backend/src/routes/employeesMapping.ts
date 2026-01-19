import express from 'express';
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import multer from 'multer';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();
const upload = multer();

interface EmployeeRow {
  code: string;     // Утвердил (логин / код)
  company: string;  // Компания
  name: string;     // ФИО
  assignment: string; // Занятость / роль (если есть)
  photo_url?: string | null;
}

// Путь к employees.csv - используем общую директорию с Analyz
// В Docker: /app/analyz-data/employees.csv
// Локально: ../../../Analyz/employees.csv
const EMPLOYEES_CSV_PATH = process.env.EMPLOYEES_CSV_PATH || 
  (process.env.NODE_ENV === 'production' 
    ? '/app/analyz-data/employees.csv'
    : path.resolve(__dirname, '../../../Analyz/employees.csv'));
const EMPLOYEE_PHOTOS_DIR = path.resolve(__dirname, '../../uploads/employee_photos');

function ensurePhotosDir() {
  try {
    fs.mkdirSync(EMPLOYEE_PHOTOS_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function safeCode(code: string) {
  return (code || '')
    .trim()
    .replace(/[^\w-]/g, '_')
    .slice(0, 80);
}

function getExistingPhotoFilename(code: string): string | null {
  ensurePhotosDir();
  const base = safeCode(code);
  if (!base) return null;
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (const ext of exts) {
    const p = path.join(EMPLOYEE_PHOTOS_DIR, `${base}${ext}`);
    if (fs.existsSync(p)) return `${base}${ext}`;
  }
  return null;
}

function getPhotoUrlForCode(code: string): string | null {
  const filename = getExistingPhotoFilename(code);
  if (!filename) return null;
  return `/uploads/employee_photos/${filename}`;
}

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensurePhotosDir();
    cb(null, EMPLOYEE_PHOTOS_DIR);
  },
  filename: (req, file, cb) => {
    const codeParam = (req.params as any)?.code || '';
    const base = safeCode(String(codeParam));
    const mime = (file.mimetype || '').toLowerCase();
    const ext =
      mime === 'image/jpeg' ? '.jpg' :
      mime === 'image/png' ? '.png' :
      mime === 'image/webp' ? '.webp' :
      path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${base}${ext}`);
  }
});

const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) return cb(null, true);
    return cb(new Error('Только изображения (image/*)'));
  }
});

function detectEncoding(buffer: Buffer): 'utf8' | 'cp1251' {
  // Пробуем декодировать как cp1251
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

function parseEmployeesCsv(buffer: Buffer): EmployeeRow[] {
  // Автоматически определяем кодировку файла
  const encoding = detectEncoding(buffer);
  const text = encoding === 'cp1251' 
    ? iconv.decode(buffer, 'cp1251')
    : buffer.toString('utf-8');
  
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  return lines.map((line) => {
    const parts = line.split(';');
    const [code = '', company = '', name = '', assignment = ''] = parts;
    return {
      code: code.trim(),
      company: company.trim(),
      name: name.trim(),
      assignment: assignment.trim()
    };
  });
}

function serializeEmployeesCsv(rows: EmployeeRow[]): Buffer {
  const lines = rows.map((row) =>
    [row.code ?? '', row.company ?? '', row.name ?? '', row.assignment ?? ''].join(';')
  );
  const text = lines.join('\r\n');
  // Кодируем обратно в cp1251
  return iconv.encode(text, 'cp1251');
}

// GET /api/employees-mapping
router.get('/', (_req, res) => {
  try {
    if (!fs.existsSync(EMPLOYEES_CSV_PATH)) {
      return res.json({ rows: [] });
    }
    const buffer = fs.readFileSync(EMPLOYEES_CSV_PATH);
    const rows = parseEmployeesCsv(buffer).map((r) => ({
      ...r,
      photo_url: getPhotoUrlForCode(r.code)
    }));
    return res.json({ rows });
  } catch (err) {
    console.error('Failed to read employees.csv', err);
    return res.status(500).json({ error: 'Не удалось прочитать employees.csv' });
  }
});

// PUT /api/employees-mapping
router.put('/', (req, res) => {
  try {
    const body = req.body as { rows?: EmployeeRow[] };
    const rows = Array.isArray(body.rows) ? body.rows : [];

    const cleaned: EmployeeRow[] = rows.map((r) => ({
      code: (r.code || '').trim(),
      company: (r.company || '').trim(),
      name: (r.name || '').trim(),
      assignment: (r.assignment || '').trim()
    }));

    // Убеждаемся, что директория существует
    const dir = path.dirname(EMPLOYEES_CSV_PATH);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (dirErr: any) {
      console.error('Failed to create directory for employees.csv', dirErr);
      // Продолжаем, возможно директория уже существует
    }

    const buffer = serializeEmployeesCsv(cleaned);
    fs.writeFileSync(EMPLOYEES_CSV_PATH, buffer);

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to write employees.csv', err);
    return res.status(500).json({ 
      error: 'Не удалось сохранить employees.csv',
      details: err?.message || String(err)
    });
  }
});

// POST /api/employees-mapping/upload
// Принимает файл CSV (может быть в UTF-8 или cp1251) и сохраняет как employees.csv в cp1251.
router.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Файл не передан' });
    }
    
    // Убеждаемся, что директория существует
    const dir = path.dirname(EMPLOYEES_CSV_PATH);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (dirErr: any) {
      console.error('Failed to create directory for employees.csv', dirErr);
      // Продолжаем, возможно директория уже существует
    }
    
    // Определяем кодировку загруженного файла и декодируем
    const encoding = detectEncoding(req.file.buffer);
    const text = encoding === 'cp1251'
      ? iconv.decode(req.file.buffer, 'cp1251')
      : req.file.buffer.toString('utf-8');
    
    // Всегда сохраняем в cp1251 (как требуется для совместимости)
    const buffer = iconv.encode(text, 'cp1251');
    fs.writeFileSync(EMPLOYEES_CSV_PATH, buffer);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to upload employees.csv', err);
    return res.status(500).json({ 
      error: 'Не удалось сохранить загруженный файл employees.csv',
      details: err?.message || String(err)
    });
  }
});

// POST /api/employees-mapping/photo/:code
// Загрузка фото сотрудника (только админ)
router.post(
  '/photo/:code',
  requireAuth,
  requireRole('admin'),
  photoUpload.single('file'),
  (req: AuthRequest, res) => {
    try {
      const codeParam = String(req.params.code || '').trim();
      if (!codeParam) {
        return res.status(400).json({ error: 'Не указан код сотрудника' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Файл не передан' });
      }

      // удаляем старые расширения (если меняли формат)
      const base = safeCode(codeParam);
      const keep = path.basename(req.file.filename);
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const candidate = `${base}${ext}`;
        if (candidate === keep) continue;
        const p = path.join(EMPLOYEE_PHOTOS_DIR, candidate);
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          // ignore
        }
      }

      const url = getPhotoUrlForCode(codeParam);
      return res.json({ success: true, photo_url: url });
    } catch (err: any) {
      console.error('Failed to upload employee photo', err);
      return res.status(500).json({ error: err?.message || 'Не удалось загрузить фото' });
    }
  }
);

export default router;


