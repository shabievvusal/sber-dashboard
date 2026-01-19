import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import TSDBulkCompanyReturn from './TSDBulkCompanyReturn';

interface TSDTransaction {
  id: number;
  tsd_number: string;
  employee_login: string;
  employee_name: string | null;
  company: string | null;
  issue_time: string;
  return_time: string | null;
  status: 'issued' | 'returned';
}

export default function TSDReturnForm({ onSuccess }: { onSuccess: () => void }) {
  const [tsdBarcode, setTsdBarcode] = useState('');
  const [transaction, setTransaction] = useState<TSDTransaction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [recentReturns, setRecentReturns] = useState<any[]>([]);
  const [showBulkReturn, setShowBulkReturn] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [companies, setCompanies] = useState<string[]>([]);
  
  const tsdInputRef = useRef<HTMLInputElement>(null);
  const tsdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoReturnTriggeredRef = useRef<string>(''); // Отслеживаем, для какого ТСД уже была автоматическая выдача

  useEffect(() => {
    tsdInputRef.current?.focus();
    loadRecentReturns();
    loadCompanies();
  }, []);

  const loadRecentReturns = async () => {
    try {
      const response = await axios.get('/api/tsd/history', {
        params: { limit: 5, status: 'returned' }
      });
      setRecentReturns(response.data.history || []);
    } catch (err) {
      console.error('Error loading recent returns:', err);
    }
  };

  const loadCompanies = async () => {
    try {
      const response = await axios.get('/api/tsd/stats');
      const companyNames = response.data
        .map((stat: any) => stat.company)
        .filter((name: string) => name && name !== 'Без компании');
      setCompanies(companyNames);
    } catch (err) {
      console.error('Error loading companies:', err);
    }
  };

  // Обработка сканирования штрих-кода ТСД
  const handleTSDBarcodeChange = async (value: string) => {
    setTsdBarcode(value);
    setError(null);
    setSuccess(false);
    
    if (tsdTimeoutRef.current) {
      clearTimeout(tsdTimeoutRef.current);
    }

    tsdTimeoutRef.current = setTimeout(async () => {
      if (value.trim().length > 0) {
        try {
          const response = await axios.get(`/api/tsd/check/${encodeURIComponent(value.trim())}`);
          if (response.data.type === 'tsd' && response.data.status === 'issued') {
            // Загружаем полную информацию о транзакции
            const activeResponse = await axios.get('/api/tsd/active');
            const activeTransaction = activeResponse.data.find(
              (t: TSDTransaction) => t.tsd_number === value.trim() && t.status === 'issued'
            );
            
            if (activeTransaction) {
              setTransaction(activeTransaction);
            } else {
              setTransaction(null);
              setError('Активная выдача не найдена');
            }
          } else {
            setTransaction(null);
            setError('ТСД не выдан или уже возвращен');
          }
        } catch (err: any) {
          setTransaction(null);
          setError(err.response?.data?.error || 'Ошибка при проверке ТСД');
        }
      } else {
        setTransaction(null);
      }
    }, 300);
  };

  const handleReturn = async () => {
    if (!transaction || transaction.status !== 'issued') {
      setError('Нет активной выдачи для возврата');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await axios.post('/api/tsd/return', {
        tsd_number: transaction.tsd_number
      });

      setSuccess(true);
      autoReturnTriggeredRef.current = ''; // Сбрасываем флаг для следующего возврата
      loadRecentReturns(); // Обновляем список последних возвратов
      // Быстро очищаем поле ввода для следующего сканирования
      setTsdBarcode('');
      setTransaction(null);
      setTimeout(() => {
        setSuccess(false);
        onSuccess();
      }, 600); // Короткое время показа сообщения
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка при возврате ТСД');
    } finally {
      setLoading(false);
    }
  };

  // Автоматическое подтверждение возврата, если ТСД отсканирован и выдан
  useEffect(() => {
    // Проверяем условия для автоматического возврата
    if (
      transaction && 
      transaction.status === 'issued' && 
      !loading && 
      !success && 
      !error &&
      tsdBarcode.trim().length > 0
    ) {
      // Создаем уникальный ключ для ТСД
      const returnKey = transaction.tsd_number;
      
      // Проверяем, не была ли уже вызвана автоматическая выдача для этого ТСД
      if (autoReturnTriggeredRef.current !== returnKey) {
        autoReturnTriggeredRef.current = returnKey;
        
        // Небольшая задержка, чтобы пользователь успел увидеть информацию о выдаче
        const autoReturnTimer = setTimeout(() => {
          handleReturn();
        }, 500);
        
        return () => clearTimeout(autoReturnTimer);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction, loading, success, error, tsdBarcode]);

  const handleClear = () => {
    setTsdBarcode('');
    setTransaction(null);
    setError(null);
    setSuccess(false);
    autoReturnTriggeredRef.current = ''; // Сбрасываем флаг автоматического возврата
    tsdInputRef.current?.focus();
  };

  const formatDuration = (issueTime: string) => {
    try {
      const issueDate = new Date(issueTime);
      return formatDistanceToNow(issueDate, { addSuffix: false });
    } catch {
      return 'неизвестно';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-6">Возврат ТСД</h2>

      <div className="space-y-6">
        {/* Поле для сканирования ТСД - статичное, не двигается */}
        <div>
          <label className="block text-sm font-semibold mb-2">
            Отсканируйте ТСД для возврата:
          </label>
          <div className="relative">
            <input
              ref={tsdInputRef}
              type="text"
              value={tsdBarcode}
              onChange={(e) => handleTSDBarcodeChange(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && transaction && transaction.status === 'issued') {
                  handleReturn();
                }
              }}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Отсканируйте штрих-код ТСД"
              autoFocus
            />
            {/* Сообщения об успехе и ошибке - абсолютное позиционирование, не двигают поле */}
            {success && (
              <div className="absolute top-full left-0 right-0 mt-2 p-2 bg-green-100 border border-green-400 text-green-700 rounded text-sm z-10 shadow-md">
                ТСД успешно возвращен!
              </div>
            )}
            {error && (
              <div className="absolute top-full left-0 right-0 mt-2 p-2 bg-red-100 border border-red-400 text-red-700 rounded text-sm z-10 shadow-md">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Информация о выдаче */}
        {transaction && transaction.status === 'issued' && (
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h3 className="font-semibold mb-3">Информация о выдаче:</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-semibold">ТСД:</span> {transaction.tsd_number}
              </div>
              <div>
                <span className="font-semibold">У кого:</span>{' '}
                {transaction.employee_name || transaction.employee_login}
                {transaction.employee_login && (
                  <span className="text-gray-600"> ({transaction.employee_login})</span>
                )}
              </div>
              {transaction.company && (
                <div>
                  <span className="font-semibold">Компания:</span> {transaction.company}
                </div>
              )}
              <div>
                <span className="font-semibold">Когда выдан:</span>{' '}
                {new Date(transaction.issue_time).toLocaleString('ru-RU')}
              </div>
              <div>
                <span className="font-semibold">На руках:</span> {formatDuration(transaction.issue_time)}
              </div>
            </div>
          </div>
        )}

        {/* Кнопки */}
        <div className="flex gap-4">
          <button
            onClick={handleReturn}
            disabled={loading || !transaction || transaction.status !== 'issued'}
            className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Обработка...' : 'ПРИНЯТЬ ВОЗВРАТ'}
          </button>
          <button
            onClick={handleClear}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
          >
            ОТМЕНА
          </button>
        </div>

        {/* Кнопка массового возврата */}
        <div className="pt-4 border-t border-gray-200">
          <button
            onClick={() => setShowBulkReturn(true)}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
          >
            Массовый возврат ТСД
          </button>
        </div>

        {/* Последние 5 возвратов */}
        {recentReturns.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">Последние возвраты:</h3>
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
              <div className="space-y-2">
                {recentReturns.map((returnItem) => (
                  <div key={returnItem.id} className="flex items-center justify-between text-sm bg-white p-2 rounded border border-gray-200">
                    <div className="flex-1">
                      <span className="font-semibold text-green-600">{returnItem.tsd_number}</span>
                      {' ← '}
                      <span className="font-medium">{returnItem.employee_name || returnItem.employee_login}</span>
                      {returnItem.company && (
                        <span className="text-gray-500 ml-2">({returnItem.company})</span>
                      )}
                    </div>
                    <div className="text-gray-500 text-xs">
                      {returnItem.return_time ? (
                        new Date(returnItem.return_time).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      ) : (
                        new Date(returnItem.issue_time).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Модальное окно выбора компании для массового возврата */}
      {showBulkReturn && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Выберите компанию</h3>
              <button
                onClick={() => {
                  setShowBulkReturn(false);
                  setSelectedCompany(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {companies.length === 0 ? (
                <div className="text-gray-500 text-center py-4">
                  Нет доступных компаний для массового возврата
                </div>
              ) : (
                companies.map((company) => (
                  <button
                    key={company}
                    onClick={() => {
                      setSelectedCompany(company);
                      setShowBulkReturn(false);
                    }}
                    className="w-full text-left px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
                  >
                    {company}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно массового возврата */}
      {selectedCompany && (
        <TSDBulkCompanyReturn
          company={selectedCompany}
          onClose={() => {
            setSelectedCompany(null);
            loadRecentReturns();
          }}
          onSuccess={() => {
            loadRecentReturns();
            onSuccess();
          }}
        />
      )}
    </div>
  );
}

