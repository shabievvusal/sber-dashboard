import { useEffect, useState } from 'react';
import axios from 'axios';

interface EmployeeRow {
  code: string;
  company: string;
  name: string;
  assignment: string;
  photo_url?: string | null;
}

function createEmptyRow(): EmployeeRow {
  return { code: '', company: '', name: '', assignment: '' };
}

export default function EmployeesMappingEditor() {
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingPhotoCode, setUploadingPhotoCode] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get<{ rows: EmployeeRow[] }>('/api/employees-mapping');
      setRows(res.data.rows ?? []);
    } catch (e) {
      console.error(e);
      setError('Не удалось загрузить employees.csv');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateRow = (index: number, field: keyof EmployeeRow, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addRow = () => {
    setRows((prev) => [...prev, createEmptyRow()]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const cleaned = rows.map((r) => ({
        code: r.code.trim(),
        company: r.company.trim(),
        name: r.name.trim(),
        assignment: r.assignment.trim()
      }));
      await axios.put('/api/employees-mapping', { rows: cleaned });
      setSuccess('Изменения сохранены в employees.csv');
    } catch (e) {
      console.error(e);
      setError('Ошибка при сохранении employees.csv');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFile = async (file: File) => {
    try {
      setUploading(true);
      setError(null);
      setSuccess(null);
      const formData = new FormData();
      formData.append('file', file);
      await axios.post('/api/employees-mapping/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setSuccess('Файл загружен и сохранён как employees.csv');
      await load();
    } catch (e) {
      console.error(e);
      setError('Ошибка при загрузке файла employees.csv');
    } finally {
      setUploading(false);
    }
  };

  const triggerFileInput = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        void handleUploadFile(file);
      }
    };
    input.click();
  };

  const uploadEmployeePhoto = async (code: string, file: File) => {
    try {
      setUploadingPhotoCode(code);
      setError(null);
      setSuccess(null);
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`/api/employees-mapping/photo/${encodeURIComponent(code)}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const photoUrl = (res.data?.photo_url as string | undefined) || null;
      setRows((prev) =>
        prev.map((r) => (r.code === code ? { ...r, photo_url: photoUrl ? `${photoUrl}?t=${Date.now()}` : null } : r))
      );
      setSuccess(`Фото загружено для ${code}`);
    } catch (e: any) {
      console.error(e);
      setError(e?.response?.data?.error || e?.message || 'Ошибка при загрузке фото');
    } finally {
      setUploadingPhotoCode(null);
    }
  };

  const triggerPhotoInput = (code: string) => {
    if (!code.trim()) {
      setError('Сначала заполните поле "Код / логин" (Утвердил)');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void uploadEmployeePhoto(code.trim(), file);
    };
    input.click();
  };

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Справочник сотрудников (employees.csv)</h2>
          <p className="text-xs text-gray-500">
            Онлайн-редактор файла соответствия: логин (Утвердил) → Компания / ФИО / Занятость.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={triggerFileInput}
            disabled={uploading}
            className="px-3 py-1.5 text-sm rounded bg-white hover:bg-gray-100 border border-gray-300 disabled:opacity-60"
          >
            {uploading ? 'Загрузка...' : 'Загрузить из файла'}
          </button>
          <button
            type="button"
            onClick={addRow}
            className="px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200 border border-gray-300"
          >
            + Строка
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
      <div className="px-4 py-2">
        {loading && <div className="text-sm text-gray-500 mb-2">Загрузка таблицы...</div>}
        {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
        {success && <div className="text-sm text-green-600 mb-2">{success}</div>}
      </div>
      <div className="px-4 pb-4 overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1 border-b border-gray-200 text-left w-40">Код / логин</th>
              <th className="px-2 py-1 border-b border-gray-200 text-left w-40">Компания</th>
              <th className="px-2 py-1 border-b border-gray-200 text-left">ФИО</th>
              <th className="px-2 py-1 border-b border-gray-200 text-left w-40">Занятость</th>
              <th className="px-2 py-1 border-b border-gray-200 text-left w-40">Фото</th>
              <th className="px-2 py-1 border-b border-gray-200 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="odd:bg-white even:bg-gray-50">
                <td className="px-2 py-1 border-b border-gray-100">
                  <input
                    className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
                    value={row.code}
                    onChange={(e) => updateRow(index, 'code', e.target.value)}
                    placeholder="Утвердил"
                  />
                </td>
                <td className="px-2 py-1 border-b border-gray-100">
                  <input
                    className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
                    value={row.company}
                    onChange={(e) => updateRow(index, 'company', e.target.value)}
                    placeholder="Компания"
                  />
                </td>
                <td className="px-2 py-1 border-b border-gray-100">
                  <input
                    className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
                    value={row.name}
                    onChange={(e) => updateRow(index, 'name', e.target.value)}
                    placeholder="ФИО"
                  />
                </td>
                <td className="px-2 py-1 border-b border-gray-100">
                  <input
                    className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs"
                    value={row.assignment}
                    onChange={(e) => updateRow(index, 'assignment', e.target.value)}
                    placeholder="Занятость"
                  />
                </td>
                <td className="px-2 py-1 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded border border-gray-300 bg-white overflow-hidden flex items-center justify-center">
                      {row.photo_url ? (
                        <img
                          src={row.photo_url}
                          alt="Фото"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-gray-400">—</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => triggerPhotoInput(row.code)}
                      disabled={uploadingPhotoCode === row.code}
                      className="px-2 py-1 text-xs rounded bg-white hover:bg-gray-100 border border-gray-300 disabled:opacity-60"
                      title="Загрузить фото сотрудника"
                    >
                      {uploadingPhotoCode === row.code ? '...' : 'Загрузить'}
                    </button>
                  </div>
                </td>
                <td className="px-2 py-1 border-b border-gray-100 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="text-xs text-red-600 hover:text-red-800"
                    title="Удалить строку"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td
                  className="px-2 py-3 text-center text-gray-400 text-xs border-b border-gray-100"
                  colSpan={6}
                >
                  Таблица пуста. Нажмите «+ Строка», чтобы добавить запись.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


