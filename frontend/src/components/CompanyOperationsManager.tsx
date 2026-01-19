import { useState, useEffect } from 'react';
import axios from 'axios';
import { OPERATIONS } from '../constants';

interface CompanyOperationsManagerProps {
  companyId: number;
  companyName: string;
}

export default function CompanyOperationsManager({ companyId, companyName }: CompanyOperationsManagerProps) {
  const [currentOperations, setCurrentOperations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadOperations();
  }, [companyId]);

  const loadOperations = async () => {
    try {
      const response = await axios.get(`/api/company-operations/${companyId}`);
      setCurrentOperations(response.data);
    } catch (error) {
      console.error('Error loading operations:', error);
    }
  };

  const handleAddOperation = async (operation: string) => {
    if (currentOperations.includes(operation)) return;

    setLoading(true);
    try {
      await axios.post(`/api/company-operations/${companyId}`, {
        operation_type: operation
      });
      await loadOperations();
    } catch (error) {
      console.error('Error adding operation:', error);
      alert('Ошибка при добавлении операции');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOperation = async (operation: string) => {
    if (!confirm(`Удалить операцию "${operation}" для компании "${companyName}"?`)) return;

    setLoading(true);
    try {
      await axios.delete(`/api/company-operations/${companyId}/${encodeURIComponent(operation)}`);
      await loadOperations();
    } catch (error) {
      console.error('Error deleting operation:', error);
      alert('Ошибка при удалении операции');
    } finally {
      setLoading(false);
    }
  };

  const availableOperations = OPERATIONS.filter(op => !currentOperations.includes(op));

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-lg font-semibold mb-3">Операции компании: {companyName}</h3>
      
      <div className="mb-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Текущие операции:</h4>
        <div className="flex flex-wrap gap-2">
          {currentOperations.length > 0 ? (
            currentOperations.map(op => (
              <div key={op} className="flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-1 rounded">
                <span>{op}</span>
                <button
                  onClick={() => handleDeleteOperation(op)}
                  disabled={loading}
                  className="text-red-600 hover:text-red-800"
                  title="Удалить"
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <span className="text-gray-500 text-sm">Нет операций</span>
          )}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-2">Добавить операцию:</h4>
        <div className="flex flex-wrap gap-2 mb-2">
          {availableOperations.map(op => (
            <button
              key={op}
              onClick={() => handleAddOperation(op)}
              disabled={loading}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm"
            >
              + {op}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <input
            type="text"
            placeholder="Новая операция..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                handleAddOperation(e.currentTarget.value.trim());
                e.currentTarget.value = '';
              }
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">Нажмите Enter для добавления</p>
        </div>
      </div>
    </div>
  );
}

