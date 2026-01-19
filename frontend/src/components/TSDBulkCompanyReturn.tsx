import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

interface BulkReturnProps {
  company: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TSDBulkCompanyReturn({ company, onClose, onSuccess }: BulkReturnProps) {
  const [tsdNumbers, setTsdNumbers] = useState<string[]>([]);
  const [currentBarcode, setCurrentBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [returnResults, setReturnResults] = useState<{ returned: any[]; errors: any[]; total_returned: number; total_errors: number } | null>(null);
  
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const barcodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    barcodeInputRef.current?.focus();
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
        // Проверяем, не добавлен ли уже этот ТСД
        if (tsdNumbers.includes(value.trim())) {
          setError(`ТСД ${value.trim()} уже добавлен в список`);
          setCurrentBarcode('');
          return;
        }

        // Проверяем, выдан ли этот ТСД этой компании
        axios.get(`/api/tsd/check/${encodeURIComponent(value.trim())}`)
          .then(response => {
            if (response.data.type === 'tsd' && response.data.status === 'issued') {
              // Проверяем, что ТСД выдан этой компании
              if (response.data.company === company || response.data.employee_login === 'BRIGADIER') {
                setTsdNumbers(prev => [...prev, value.trim()]);
                setCurrentBarcode('');
                barcodeInputRef.current?.focus();
              } else {
                setError(`ТСД ${value.trim()} выдан другой компании (${response.data.company || 'неизвестно'})`);
                setCurrentBarcode('');
              }
            } else {
              setError(`ТСД ${value.trim()} не выдан или уже возвращен`);
              setCurrentBarcode('');
            }
          })
          .catch(() => {
            setError(`Ошибка при проверке ТСД ${value.trim()}`);
            setCurrentBarcode('');
          });
      }
    }, 300);
  };

  const handleRemoveTSD = (index: number) => {
    setTsdNumbers(prev => prev.filter((_, i) => i !== index));
  };

  const handleReturn = async () => {
    if (tsdNumbers.length === 0) {
      setError('Добавьте хотя бы один ТСД');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);
    setReturnResults(null);

    try {
      const response = await axios.post('/api/tsd/return-bulk-company', {
        company: company,
        tsd_numbers: tsdNumbers
      });

      setReturnResults(response.data);
      setSuccess(true);
      
      if (response.data.total_returned > 0) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2000);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка при возврате ТСД');
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Массовый возврат ТСД компании</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        <div className="mb-4 p-3 bg-blue-50 rounded">
          <div className="font-semibold">Компания: {company}</div>
        </div>

        {success && returnResults && (
          <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
            <div className="font-semibold mb-2">Результаты возврата:</div>
            <div>Успешно возвращено: {returnResults.total_returned}</div>
            {returnResults.total_errors > 0 && (
              <div className="text-red-600 mt-2">
                Ошибок: {returnResults.total_errors}
                <ul className="list-disc list-inside mt-1">
                  {returnResults.errors.map((err, idx) => (
                    <li key={idx}>{err.tsd_number}: {err.error}</li>
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
            Отсканируйте ТСД для возврата (можно несколько подряд):
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
          <div className="text-xs text-gray-500 mt-1">
            Добавлено ТСД: {tsdNumbers.length}
          </div>
        </div>

        {/* Список добавленных ТСД */}
        {tsdNumbers.length > 0 && (
          <div className="mb-4">
            <div className="font-semibold mb-2">Список ТСД для возврата:</div>
            <div className="border border-gray-300 rounded-lg p-3 max-h-60 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {tsdNumbers.map((tsd, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-200"
                  >
                    <span className="font-mono text-sm">{tsd}</span>
                    <button
                      onClick={() => handleRemoveTSD(index)}
                      className="ml-2 text-red-500 hover:text-red-700 text-lg"
                      disabled={loading || success}
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
            onClick={handleReturn}
            disabled={loading || success || tsdNumbers.length === 0}
            className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Обработка...' : 'ПРИНЯТЬ ВСЕ ТСД'}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
            disabled={loading}
          >
            ОТМЕНА
          </button>
        </div>
      </div>
    </div>
  );
}


