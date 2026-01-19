import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

interface BulkIssueProps {
  company: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface IssueError {
  tsd_number: string;
  error: string;
}

interface IssueResults {
  issued: any[];
  errors: IssueError[];
  total_issued: number;
  total_errors: number;
}

export default function TSDBulkCompanyIssue({ company, onClose, onSuccess }: BulkIssueProps) {
  const [tsdNumbers, setTsdNumbers] = useState<string[]>([]);
  const [currentBarcode, setCurrentBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [issueResults, setIssueResults] = useState<IssueResults | null>(null);
  
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const barcodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    barcodeInputRef.current?.focus();
    return () => {
      if (barcodeTimeoutRef.current) {
        clearTimeout(barcodeTimeoutRef.current);
      }
    };
  }, []);

  // Обработка сканирования штрих-кода ТСД
  const handleBarcodeChange = (value: string) => {
    setCurrentBarcode(value);
    setError(null);
    
    if (barcodeTimeoutRef.current) {
      clearTimeout(barcodeTimeoutRef.current);
    }

    barcodeTimeoutRef.current = setTimeout(() => {
      if (value.trim().length > 0) {
        const trimmedValue = value.trim();
        
        // Проверяем, не добавлен ли уже этот ТСД
        if (tsdNumbers.includes(trimmedValue)) {
          setError(`ТСД ${trimmedValue} уже добавлен в список`);
          setCurrentBarcode('');
          return;
        }

        // Проверяем, не выдан ли уже этот ТСД
        axios.get(`/api/tsd/check/${encodeURIComponent(trimmedValue)}`)
          .then(response => {
            if (response.data.type === 'tsd' && response.data.status === 'issued') {
              setError(`ТСД ${trimmedValue} уже выдан (${response.data.employee_name || response.data.employee_login})`);
              setCurrentBarcode('');
            } else {
              // Добавляем ТСД в список
              setTsdNumbers(prev => [...prev, trimmedValue]);
              setCurrentBarcode('');
              barcodeInputRef.current?.focus();
            }
          })
          .catch(() => {
            // Если ошибка проверки, все равно добавляем (может быть новый ТСД)
            setTsdNumbers(prev => [...prev, trimmedValue]);
            setCurrentBarcode('');
            barcodeInputRef.current?.focus();
          });
      }
    }, 300);
  };

  const handleRemoveTSD = (index: number) => {
    setTsdNumbers(prev => prev.filter((_, i) => i !== index));
  };

  const handleIssue = async () => {
    if (tsdNumbers.length === 0) {
      setError('Добавьте хотя бы один ТСД');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setIssueResults(null);

    try {
      const response = await axios.post('/api/tsd/issue-bulk-company', {
        company: company,
        tsd_numbers: tsdNumbers
      });

      setIssueResults(response.data);
      setSuccess(true);
      
      if (response.data.total_issued > 0) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2000);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка при выдаче ТСД');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && currentBarcode.trim()) {
      e.preventDefault();
      handleBarcodeChange(currentBarcode);
    }
  };

  const handleClearAll = () => {
    setTsdNumbers([]);
    setCurrentBarcode('');
    setError(null);
    setIssueResults(null);
    setSuccess(false);
    barcodeInputRef.current?.focus();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Массовая выдача ТСД компании</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
            disabled={loading}
          >
            ×
          </button>
        </div>

        <div className="mb-4 p-3 bg-blue-50 rounded">
          <div className="font-semibold">Компания: {company}</div>
          <div className="text-sm text-gray-600 mt-1">
            Добавьте ТСД для выдачи этой компании
          </div>
        </div>

        {success && issueResults && (
          <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
            <div className="font-semibold mb-2">Результаты выдачи:</div>
            <div className="mb-2">Успешно выдано: {issueResults.total_issued}</div>
            {issueResults.total_errors > 0 && (
              <div className="mt-2">
                <div className="font-semibold text-red-600">
                  Ошибок: {issueResults.total_errors}
                </div>
                <ul className="list-disc list-inside mt-1 pl-2">
                  {issueResults.errors.map((err, idx) => (
                    <li key={idx} className="text-sm">
                      {err.tsd_number}: {err.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2">
            Отсканируйте ТСД (можно несколько подряд):
          </label>
          <input
            ref={barcodeInputRef}
            type="text"
            value={currentBarcode}
            onChange={(e) => handleBarcodeChange(e.target.value)}
            onKeyPress={handleKeyPress}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Отсканируйте штрих-код ТСД"
            disabled={loading || success}
          />
          <div className="flex justify-between items-center mt-1">
            <div className="text-xs text-gray-500">
              Добавлено ТСД: {tsdNumbers.length}
            </div>
            {tsdNumbers.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs text-red-600 hover:text-red-800"
                disabled={loading || success}
              >
                Очистить все
              </button>
            )}
          </div>
        </div>

        {/* Список добавленных ТСД */}
        {tsdNumbers.length > 0 && (
          <div className="mb-4">
            <div className="font-semibold mb-2">Список ТСД для выдачи:</div>
            <div className="border border-gray-300 rounded-lg p-3 max-h-60 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {tsdNumbers.map((tsd, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-200 hover:bg-gray-100"
                  >
                    <span className="font-mono text-sm">{tsd}</span>
                    <button
                      onClick={() => handleRemoveTSD(index)}
                      className="ml-2 text-red-500 hover:text-red-700 text-lg"
                      disabled={loading || success}
                      title="Удалить"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Кнопки */}
        <div className="flex gap-4">
          <button
            onClick={handleIssue}
            disabled={loading || success || tsdNumbers.length === 0}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Обработка...
              </span>
            ) : 'ВЫДАТЬ ВСЕ ТСД'}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            disabled={loading}
          >
            ОТМЕНА
          </button>
        </div>

        {/* Подсказка */}
        <div className="mt-4 p-3 bg-gray-50 rounded text-sm text-gray-600">
          <div className="font-semibold mb-1">Инструкция:</div>
          <ol className="list-decimal list-inside space-y-1 pl-2">
            <li>Отсканируйте штрих-код ТСД (или введите вручную)</li>
            <li>ТСД автоматически добавится в список</li>
            <li>Повторите для всех ТСД которые нужно выдать</li>
            <li>Нажмите "ВЫДАТЬ ВСЕ ТСД"</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
