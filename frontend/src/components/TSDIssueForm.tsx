import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import TSDBulkCompanyIssue from './TSDBulkCompanyIssue';
import TSDBulkCompanyReturn from './TSDBulkCompanyReturn';

interface CompanyStats {
  company: string;
  issued_count: number;
  returned_count: number;
  issued_tsd_numbers: string | null;
  company_issued_count?: number;
}

interface EmployeeInfo {
  login: string;
  name: string;
  company: string | null;
}

interface TSDInfo {
  tsd_number: string;
  status: 'available' | 'issued';
  employee_login?: string;
  employee_name?: string;
  issue_time?: string;
}

export default function TSDIssueForm({ onSuccess }: { onSuccess: () => void }) {
  const [employeeBarcode, setEmployeeBarcode] = useState('');
  const [tsdBarcode, setTsdBarcode] = useState('');
  const [employeeInfo, setEmployeeInfo] = useState<EmployeeInfo | null>(null);
  const [tsdInfo, setTsdInfo] = useState<TSDInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [companyStats, setCompanyStats] = useState<CompanyStats[]>([]);
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [bulkIssueCompany, setBulkIssueCompany] = useState<string | null>(null);
  const [bulkReturnCompany, setBulkReturnCompany] = useState<string | null>(null);
  const [recentIssues, setRecentIssues] = useState<any[]>([]);
  
  const employeeInputRef = useRef<HTMLInputElement>(null);
  const tsdInputRef = useRef<HTMLInputElement>(null);
  const employeeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tsdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoIssueTriggeredRef = useRef<string>(''); // Отслеживаем, для какой комбинации уже была автоматическая выдача

  useEffect(() => {
    employeeInputRef.current?.focus();
    loadCompanyStats();
    loadRecentIssues();
  }, []);

  const loadRecentIssues = async () => {
    try {
      const response = await axios.get('/api/tsd/history', {
        params: { limit: 5, status: 'issued' }
      });
      setRecentIssues(response.data.history || []);
    } catch (err) {
      console.error('Error loading recent issues:', err);
    }
  };

  useEffect(() => {
    if (success) {
      loadCompanyStats();
    }
  }, [success]);

  // Автоматическое подтверждение выдачи, если сотрудник и свободный ТСД отсканированы
  useEffect(() => {
    // Проверяем условия для автоматической выдачи
    if (
      employeeInfo && 
      tsdInfo && 
      tsdInfo.status === 'available' && 
      !loading && 
      !success && 
      !error &&
      tsdBarcode.trim().length > 0
    ) {
      // Создаем уникальный ключ для комбинации сотрудник+ТСД
      const issueKey = `${employeeInfo.login}-${tsdInfo.tsd_number}`;
      
      // Проверяем, не была ли уже вызвана автоматическая выдача для этой комбинации
      if (autoIssueTriggeredRef.current !== issueKey) {
        autoIssueTriggeredRef.current = issueKey;
        
        // Небольшая задержка, чтобы пользователь успел увидеть информацию о ТСД
        const autoIssueTimer = setTimeout(() => {
          handleIssue();
        }, 500);
        
        return () => clearTimeout(autoIssueTimer);
      }
    }
  }, [employeeInfo, tsdInfo, loading, success, error, tsdBarcode]);

  const loadCompanyStats = async () => {
    try {
      const response = await axios.get('/api/tsd/stats');
      setCompanyStats(response.data);
    } catch (err) {
      console.error('Error loading company stats:', err);
    }
  };

  const handleAddCompany = () => {
    if (newCompanyName.trim()) {
      // Добавляем новую компанию в список (без статистики, так как она пустая)
      setCompanyStats(prev => [
        ...prev,
        {
          company: newCompanyName.trim(),
          issued_count: 0,
          returned_count: 0,
          issued_tsd_numbers: null
        }
      ]);
      setNewCompanyName('');
      setShowAddCompany(false);
    }
  };

  // Обработка сканирования штрих-кода сотрудника
  const handleEmployeeBarcodeChange = async (value: string) => {
    setEmployeeBarcode(value);
    setError(null);
    
    if (employeeTimeoutRef.current) {
      clearTimeout(employeeTimeoutRef.current);
    }

    employeeTimeoutRef.current = setTimeout(async () => {
      if (value.trim().length > 0) {
        try {
          const response = await axios.get(`/api/tsd/check/${encodeURIComponent(value.trim())}`);
          if (response.data.type === 'employee') {
            setEmployeeInfo({
              login: response.data.login,
              name: response.data.name,
              company: response.data.company
            });
            // Автоматически переходим к полю ТСД
            setTimeout(() => {
              tsdInputRef.current?.focus();
            }, 100);
          } else {
            setEmployeeInfo(null);
            setError('Сотрудник не найден');
          }
        } catch (err: any) {
          setEmployeeInfo(null);
          setError(err.response?.data?.error || 'Ошибка при проверке штрих-кода');
        }
      } else {
        setEmployeeInfo(null);
      }
    }, 300);
  };

  // Обработка сканирования штрих-кода ТСД
  const handleTSDBarcodeChange = async (value: string) => {
    setTsdBarcode(value);
    setError(null);
    
    if (tsdTimeoutRef.current) {
      clearTimeout(tsdTimeoutRef.current);
    }

    tsdTimeoutRef.current = setTimeout(async () => {
      if (value.trim().length > 0) {
        try {
          const response = await axios.get(`/api/tsd/check/${encodeURIComponent(value.trim())}`);
          if (response.data.type === 'tsd') {
            if (response.data.status === 'issued') {
              setTsdInfo({
                tsd_number: response.data.tsd_number,
                status: 'issued',
                employee_login: response.data.employee_login,
                employee_name: response.data.employee_name,
                issue_time: response.data.issue_time
              });
              setError('ТСД уже выдан');
            } else {
              setTsdInfo({
                tsd_number: response.data.tsd_number,
                status: 'available'
              });
            }
          } else {
            // Если это не ТСД, но есть номер, используем его
            setTsdInfo({
              tsd_number: value.trim(),
              status: 'available'
            });
          }
        } catch (err: any) {
          setTsdInfo({
            tsd_number: value.trim(),
            status: 'available'
          });
        }
      } else {
        setTsdInfo(null);
      }
    }, 300);
  };

  const handleIssue = async () => {
    if (!employeeInfo || !tsdInfo || tsdInfo.status === 'issued') {
      setError('Заполните все поля корректно');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await axios.post('/api/tsd/issue', {
        employee_login: employeeInfo.login,
        employee_name: employeeInfo.name,
        company: employeeInfo.company,
        tsd_number: tsdInfo.tsd_number
      });

      setSuccess(true);
      autoIssueTriggeredRef.current = ''; // Сбрасываем флаг для следующей выдачи
      loadCompanyStats(); // Обновляем статистику
      loadRecentIssues(); // Обновляем список последних выдач
      // Быстро очищаем поля ввода для следующего сканирования
      setEmployeeBarcode('');
      setTsdBarcode('');
      setEmployeeInfo(null);
      setTsdInfo(null);
      setTimeout(() => {
        setSuccess(false);
        onSuccess();
      }, 600); // Короткое время показа сообщения
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || 'Ошибка при выдаче ТСД';
      setError(errorMessage);
      // Если ошибка о превышении лимита, показываем дополнительную информацию
      if (err.response?.data?.details?.current_count !== undefined) {
        setError(`${errorMessage} (У сотрудника уже ${err.response.data.details.current_count} ТСД)`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setEmployeeBarcode('');
    setTsdBarcode('');
    setEmployeeInfo(null);
    setTsdInfo(null);
    setError(null);
    setSuccess(false);
    autoIssueTriggeredRef.current = ''; // Сбрасываем флаг автоматической выдачи
    employeeInputRef.current?.focus();
  };

  const handleKeyPress = (e: React.KeyboardEvent, nextField?: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (nextField) {
        nextField();
      }
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-6">Выдача ТСД</h2>

      <div className="space-y-6">
        {/* Поля для сканирования - в одну строку для компактности */}
        <div className="grid grid-cols-2 gap-4">
          {/* Поле для сканирования сотрудника */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              1. Отсканируйте бейдж сотрудника:
            </label>
            <div className="relative">
              <input
                ref={employeeInputRef}
                type="text"
                value={employeeBarcode}
                onChange={(e) => handleEmployeeBarcodeChange(e.target.value)}
                onKeyPress={(e) => handleKeyPress(e, () => tsdInputRef.current?.focus())}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Отсканируйте штрих-код сотрудника"
                autoFocus
              />
              {/* Сообщения об ошибке - абсолютное позиционирование, не двигают поле */}
              {error && !success && (
                <div className="absolute top-full left-0 right-0 mt-2 p-2 bg-red-100 border border-red-400 text-red-700 rounded text-sm z-10 shadow-md">
                  {error}
                </div>
              )}
            </div>
            {employeeInfo && (
              <div className="mt-2 p-3 bg-blue-50 rounded">
                <div className="font-semibold text-sm">Сотрудник: {employeeInfo.name}</div>
                <div className="text-xs text-gray-600">
                  Компания: {employeeInfo.company || 'Не указана'}
                </div>
              </div>
            )}
          </div>

          {/* Поле для сканирования ТСД */}
          <div>
            <label className="block text-sm font-semibold mb-2">
              2. Отсканируйте ТСД:
            </label>
            <div className="relative">
              <input
                ref={tsdInputRef}
                type="text"
                value={tsdBarcode}
                onChange={(e) => handleTSDBarcodeChange(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && employeeInfo && tsdInfo && tsdInfo.status === 'available') {
                    handleIssue();
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Отсканируйте штрих-код ТСД"
              />
              {/* Сообщения об успехе и ошибке - абсолютное позиционирование, не двигают поле */}
              {success && (
                <div className="absolute top-full left-0 right-0 mt-2 p-2 bg-green-100 border border-green-400 text-green-700 rounded text-sm z-10 shadow-md">
                  ТСД успешно выдан!
                </div>
              )}
              {error && success && (
                <div className="absolute top-full left-0 right-0 mt-2 p-2 bg-red-100 border border-red-400 text-red-700 rounded text-sm z-10 shadow-md">
                  {error}
                </div>
              )}
            </div>
            {tsdInfo && (
              <div className={`mt-2 p-3 rounded ${
                tsdInfo.status === 'issued' ? 'bg-red-50' : 'bg-green-50'
              }`}>
                <div className="font-semibold text-sm">ТСД: {tsdInfo.tsd_number}</div>
                <div className="text-xs">
                  Статус: {tsdInfo.status === 'issued' ? (
                    <span className="text-red-600">
                      Занят (выдан {tsdInfo.employee_name || tsdInfo.employee_login})
                    </span>
                  ) : (
                    <span className="text-green-600">Свободен</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Кнопки */}
        <div className="flex gap-4">
          <button
            onClick={handleIssue}
            disabled={loading || !employeeInfo || !tsdInfo || tsdInfo.status === 'issued'}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Обработка...' : 'ВЫДАТЬ'}
          </button>
          <button
            onClick={handleClear}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
          >
            ОЧИСТИТЬ
          </button>
        </div>

        {/* Последние 5 выдач */}
        {recentIssues.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">Последние выдачи:</h3>
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
              <div className="space-y-2">
                {recentIssues.map((issue) => (
                  <div key={issue.id} className="flex items-center justify-between text-sm bg-white p-2 rounded border border-gray-200">
                    <div className="flex-1">
                      <span className="font-semibold text-blue-600">{issue.tsd_number}</span>
                      {' → '}
                      <span className="font-medium">{issue.employee_name || issue.employee_login}</span>
                      {issue.company && (
                        <span className="text-gray-500 ml-2">({issue.company})</span>
                      )}
                    </div>
                    <div className="text-gray-500 text-xs">
                      {new Date(issue.issue_time).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Блоки статистики по компаниям */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-4">Статистика по компаниям</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {companyStats.map((stat, index) => (
              <div
                key={index}
                className="bg-gray-50 border border-gray-200 rounded-lg p-4 min-h-[120px] flex flex-col"
              >
                <div className="font-semibold text-sm mb-2 text-gray-700">
                  {stat.company || 'Без компании'}
                </div>
                <div className="text-xs text-gray-600 mb-1">
                  Выдано: <span className="font-semibold text-blue-600">{stat.issued_count}</span>
                </div>
                <div className="text-xs text-gray-600 mb-2">
                  Сдано: <span className="font-semibold text-green-600">{stat.returned_count}</span>
                </div>
                {stat.issued_tsd_numbers && (
                  <div className="text-xs text-gray-500 mb-2 break-words">
                    ТСД: {stat.issued_tsd_numbers.split(',').join(', ')}
                  </div>
                )}
                <div className="mt-auto flex gap-2">
                  <button
                    onClick={() => setBulkIssueCompany(stat.company)}
                    className="flex-1 px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                  >
                    Массовая выдача
                  </button>
                  <button
                    onClick={() => setBulkReturnCompany(stat.company)}
                    className="flex-1 px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"
                  >
                    Принять ТСД
                  </button>
                </div>
              </div>
            ))}
            
            {/* Блок добавления новой компании */}
            {showAddCompany ? (
              <div className="bg-blue-50 border-2 border-blue-300 border-dashed rounded-lg p-4 min-h-[120px] flex flex-col">
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddCompany();
                    }
                  }}
                  placeholder="Название компании"
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm mb-2"
                  autoFocus
                />
                <div className="flex gap-2 mt-auto">
                  <button
                    onClick={handleAddCompany}
                    className="flex-1 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                  >
                    Добавить
                  </button>
                  <button
                    onClick={() => {
                      setShowAddCompany(false);
                      setNewCompanyName('');
                    }}
                    className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddCompany(true)}
                className="bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg p-4 min-h-[120px] flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <span className="text-3xl text-gray-400">+</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Модальное окно массовой выдачи */}
      {bulkIssueCompany && (
        <TSDBulkCompanyIssue
          company={bulkIssueCompany}
          onClose={() => {
            setBulkIssueCompany(null);
            loadCompanyStats();
          }}
          onSuccess={() => {
            loadCompanyStats();
            onSuccess();
          }}
        />
      )}

      {/* Модальное окно массового возврата */}
      {bulkReturnCompany && (
        <TSDBulkCompanyReturn
          company={bulkReturnCompany}
          onClose={() => {
            setBulkReturnCompany(null);
            loadCompanyStats();
          }}
          onSuccess={() => {
            loadCompanyStats();
            onSuccess();
          }}
        />
      )}
    </div>
  );
}

