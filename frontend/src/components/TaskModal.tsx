import { useState, useEffect } from 'react';
import axios from 'axios';

interface TaskModalProps {
  onClose: () => void;
  onTaskCreated: () => void;
}

export default function TaskModal({ onClose, onTaskCreated }: TaskModalProps) {
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    try {
      const response = await axios.get('/api/companies');
      setCompanies(response.data);
      if (response.data.length > 0) {
        setSelectedCompanyId(response.data[0].id);
      }
    } catch (error) {
      console.error('Error loading companies:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyId || !title) return;

    setLoading(true);
    try {
      await axios.post('/api/tasks', {
        title,
        assigned_company_id: selectedCompanyId,
        duration_minutes: durationMinutes,
        require_photo: requirePhoto ? 1 : 0
      });
      onTaskCreated();
    } catch (error) {
      console.error('Error creating task:', error);
      alert('Ошибка при создании задачи');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Создать задание</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Компания
            </label>
            <select
              value={selectedCompanyId || ''}
              onChange={(e) => setSelectedCompanyId(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            >
              <option value="">Выберите компанию</option>
              {companies.map(company => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Текст задачи
            </label>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              rows={3}
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Время выполнения (минуты)
            </label>
            <input
              type="number"
              min="1"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 60)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            />
          </div>
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requirePhoto}
                onChange={(e) => setRequirePhoto(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium text-gray-700">
                Фото обязательно (задачу нельзя завершить без фото)
              </span>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
            >
              {loading ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}



