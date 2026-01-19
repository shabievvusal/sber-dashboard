import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

interface TSDTransaction {
  id: number;
  issue_time: string;
  employee_login: string;
  employee_name: string | null;
  company: string | null;
  tsd_number: string;
  return_time: string | null;
  status: 'issued' | 'returned';
}

export default function TSDLogTable() {
  const { user } = useAuth();
  const [history, setHistory] = useState<TSDTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    status: '',
    employee_login: '',
    tsd_number: ''
  });
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  useEffect(() => {
    loadHistory();
  }, [filters, currentPage]);

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params: any = {
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage
      };

      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.status) params.status = filters.status;
      if (filters.employee_login) params.employee_login = filters.employee_login;
      if (filters.tsd_number) params.tsd_number = filters.tsd_number;

      const response = await axios.get('/api/tsd/history', { params });
      setHistory(response.data.history);
      setTotal(response.data.total);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка при загрузке истории');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Вы уверены, что хотите удалить эту запись?')) {
      return;
    }

    setDeletingId(id);
    try {
      await axios.delete(`/api/tsd/${id}`);
      loadHistory(); // Перезагружаем список
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка при удалении записи');
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = async () => {
    try {
      const params: any = {};
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.status) params.status = filters.status;

      const response = await axios.get('/api/tsd/export', {
        params,
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `tsd_history_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      setError('Ошибка при экспорте данных');
    }
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString('ru-RU');
    } catch {
      return dateString;
    }
  };

  const totalPages = Math.ceil(total / itemsPerPage);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Журнал операций</h2>
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          Экспорт в CSV
        </button>
      </div>

      {/* Фильтры */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <div>
          <label className="block text-sm font-semibold mb-1">Дата с</label>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => handleFilterChange('startDate', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Дата по</label>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => handleFilterChange('endDate', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Статус</label>
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded"
          >
            <option value="">Все</option>
            <option value="issued">На руках</option>
            <option value="returned">Возвращено</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Логин сотрудника</label>
          <input
            type="text"
            value={filters.employee_login}
            onChange={(e) => handleFilterChange('employee_login', e.target.value)}
            placeholder="Поиск..."
            className="w-full px-3 py-2 border border-gray-300 rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Номер ТСД</label>
          <input
            type="text"
            value={filters.tsd_number}
            onChange={(e) => handleFilterChange('tsd_number', e.target.value)}
            placeholder="Поиск..."
            className="w-full px-3 py-2 border border-gray-300 rounded"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">Загрузка...</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-4 py-2 text-left">ID</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Время выдачи</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Сотрудник</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Компания</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">ТСД</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Время возврата</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Статус</th>
                  {user?.role === 'admin' && (
                    <th className="border border-gray-300 px-4 py-2 text-left">Действия</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={user?.role === 'admin' ? 8 : 7} className="border border-gray-300 px-4 py-8 text-center text-gray-500">
                      Нет данных
                    </td>
                  </tr>
                ) : (
                  history.map((transaction) => (
                    <tr key={transaction.id} className="hover:bg-gray-50">
                      <td className="border border-gray-300 px-4 py-2">{transaction.id}</td>
                      <td className="border border-gray-300 px-4 py-2">
                        {formatDate(transaction.issue_time)}
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        {transaction.employee_name || transaction.employee_login}
                        {transaction.employee_login && (
                          <span className="text-gray-500 text-sm ml-1">
                            ({transaction.employee_login})
                          </span>
                        )}
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        {transaction.company || '-'}
                      </td>
                      <td className="border border-gray-300 px-4 py-2 font-mono">
                        {transaction.tsd_number}
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        {transaction.return_time ? formatDate(transaction.return_time) : '-'}
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        <span
                          className={`px-2 py-1 rounded text-sm ${
                            transaction.status === 'issued'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {transaction.status === 'issued' ? 'На руках' : 'Возвращено'}
                        </span>
                      </td>
                      {user?.role === 'admin' && (
                        <td className="border border-gray-300 px-4 py-2">
                          <button
                            onClick={() => handleDelete(transaction.id)}
                            disabled={deletingId === transaction.id}
                            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                          >
                            {deletingId === transaction.id ? 'Удаление...' : 'Удалить'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Пагинация */}
          {totalPages > 1 && (
            <div className="mt-4 flex justify-between items-center">
              <div className="text-sm text-gray-600">
                Показано {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, total)} из {total}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Назад
                </button>
                <span className="px-4 py-2">
                  Страница {currentPage} из {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Вперед
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

