import { useState, useEffect } from 'react';
import axios from 'axios';
import { getCurrentHours } from '../constants';
import { format } from 'date-fns';
import CompanyOperationsManager from './CompanyOperationsManager';
import { useAuth } from '../contexts/AuthContext';

interface SummaryTableProps {
  currentHour: string;
  onHourChange: (hour: string) => void;
}

export default function SummaryTable({ currentHour, onHourChange }: SummaryTableProps) {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Record<string, Record<string, number>>>({});
  const [editingCell, setEditingCell] = useState<{ operation: string; company: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showOperationsManager, setShowOperationsManager] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<{ id: number; name: string } | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [visibleCompanies, setVisibleCompanies] = useState<Set<string>>(new Set());
  const [employeesData, setEmployeesData] = useState<Record<string, number>>({});

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'operator') {
      axios.get('/api/companies').then(res => {
        const loadedCompanies = res.data;
        setCompanies(loadedCompanies);
        
        // Initialize visible companies from localStorage or all companies
        const saved = localStorage.getItem('visibleCompanies');
        if (saved) {
          try {
            const savedNames = JSON.parse(saved);
            const companyNames = loadedCompanies.map((c: any) => c.name);
            // Only include companies that exist
            const validNames = savedNames.filter((name: string) => companyNames.includes(name));
            setVisibleCompanies(new Set(validNames.length > 0 ? validNames : companyNames));
          } catch (e) {
            console.error('Error loading visible companies:', e);
            setVisibleCompanies(new Set(loadedCompanies.map((c: any) => c.name)));
          }
        } else {
          // Show all companies by default
          setVisibleCompanies(new Set(loadedCompanies.map((c: any) => c.name)));
        }
      }).catch(err => console.error('Error loading companies:', err));

      // Load employees data
      loadEmployeesData();
    }
  }, [user]);

  const loadEmployeesData = async () => {
    try {
      const response = await axios.get('/api/company-employees');
      const data = response.data || [];
      const employeesMap: Record<string, number> = {};
      data.forEach((item: any) => {
        employeesMap[item.company_name] = item.employees_count || 0;
      });
      setEmployeesData(employeesMap);
    } catch (error) {
      console.error('Error loading employees data:', error);
      setEmployeesData({});
    }
  };

  const loadSummary = async () => {
    try {
      const response = await axios.get(`/api/hourly-data/summary/${currentHour}`);
      setSummary(response.data || {});
    } catch (error) {
      console.error('Error loading summary:', error);
      setSummary({});
    }
  };

  useEffect(() => {
    if (currentHour) {
      loadSummary();
    }
  }, [currentHour]);

  const handleCellClick = (operation: string, company: string) => {
    const value = summary[operation]?.[company] || 0;
    setEditingCell({ operation, company });
    setEditValue(value.toString());
  };

  const handleCellSave = async () => {
    if (!editingCell) return;

    const value = parseInt(editValue) || 0;
    const [datePart] = currentHour.split(' ');
    const [hourNum] = currentHour.split(' ')[1].split(':');
    const fullHour = `${datePart} ${hourNum.padStart(2, '0')}:00:00`;

    // Get company ID
    try {
      const companiesResponse = await axios.get('/api/companies');
      const company = companiesResponse.data.find((c: any) => c.name === editingCell.company);
      
      if (company) {
        await axios.post('/api/hourly-data', {
          company_id: company.id,
          operation_type: editingCell.operation,
          hour: fullHour,
          value
        });
        loadSummary();
      }
    } catch (error) {
      console.error('Error saving cell:', error);
    }

    setEditingCell(null);
  };

  const handleCellCancel = () => {
    setEditingCell(null);
  };

  const getOperations = () => {
    if (!summary || typeof summary !== 'object') return [];
    return Object.keys(summary).filter(op => op !== 'Итого');
  };

  const getVisibleCompanies = () => {
    if (companies.length === 0) return [];
    return companies.filter(c => visibleCompanies.has(c.name)).map(c => c.name);
  };

  const getTotalForCompany = (company: string) => {
    const employeesOnShift = employeesData[company] || 0;
    const operationsSum = getOperations().reduce((sum, op) => sum + (summary[op]?.[company] || 0), 0);
    return operationsSum - employeesOnShift;
  };

  const getTotalForOperation = (operation: string) => {
    return getVisibleCompanies().reduce((sum, company) => sum + (summary[operation]?.[company] || 0), 0);
  };

  const getGrandTotal = () => {
    const totalEmployees = getVisibleCompanies().reduce((sum, company) => {
      return sum + (employeesData[company] || 0);
    }, 0);
    const totalOperations = getOperations().reduce((sum, op) => sum + getTotalForOperation(op), 0);
    return totalOperations - totalEmployees;
  };

  const formatHour = (hourStr: string) => {
    try {
      const date = new Date(hourStr);
      return format(date, 'HH:mm');
    } catch {
      return hourStr.split(' ')[1]?.substring(0, 5) || hourStr;
    }
  };

  const [currentHours, setCurrentHours] = useState<string[]>(getCurrentHours());

  useEffect(() => {
    // Обновляем часы каждую минуту для проверки смены графика
    const interval = setInterval(() => {
      setCurrentHours(getCurrentHours());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const getTodayHours = () => {
    const today = new Date().toISOString().split('T')[0];
    return currentHours.map(h => {
      const [hour] = h.split(':');
      return `${today} ${hour.padStart(2, '0')}:00:00`;
    });
  };

  const handleTimelineClick = (hour: string) => {
    onHourChange(hour);
  };

  const toggleCompanyVisibility = (companyName: string) => {
    const newVisible = new Set(visibleCompanies);
    if (newVisible.has(companyName)) {
      newVisible.delete(companyName);
    } else {
      newVisible.add(companyName);
    }
    setVisibleCompanies(newVisible);
    localStorage.setItem('visibleCompanies', JSON.stringify(Array.from(newVisible)));
  };

  if (!currentHour) {
    return <div className="text-center py-8 text-gray-500">Загрузка...</div>;
  }

  const visibleCompaniesList = getVisibleCompanies();

  return (
    <div>
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4 gap-4">
        <h2 className="text-xl lg:text-2xl font-bold">
          Сводная таблица
        </h2>
        {(user?.role === 'admin' || user?.role === 'operator') && companies.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {companies.map(company => (
              <div key={company.id} className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setSelectedCompany(company);
                    setShowOperationsManager(true);
                  }}
                  className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                >
                  {company.name}
                </button>
                <button
                  onClick={() => toggleCompanyVisibility(company.name)}
                  className={`px-2 py-1 rounded text-xs ${
                    visibleCompanies.has(company.name)
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-300 text-gray-700'
                  }`}
                  title={visibleCompanies.has(company.name) ? 'Скрыть' : 'Показать'}
                >
                  {visibleCompanies.has(company.name) ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {showOperationsManager && selectedCompany && (
        <div className="mb-4">
          <CompanyOperationsManager
            companyId={selectedCompany.id}
            companyName={selectedCompany.name}
          />
          <button
            onClick={() => {
              setShowOperationsManager(false);
              setSelectedCompany(null);
              loadSummary();
            }}
            className="mt-2 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Закрыть
          </button>
        </div>
      )}
      <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Операции</th>
              {visibleCompaniesList.length > 0 ? visibleCompaniesList.map(company => (
                <th key={company} className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
                  {company}
                </th>
              )) : (
                <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
                  Загрузка...
                </th>
              )}
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Итого</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {getOperations().length > 0 ? getOperations().map(operation => (
              <tr key={operation}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{operation}</td>
                {visibleCompaniesList.map(company => (
                  <td
                    key={company}
                    className="px-4 py-3 text-center text-sm cursor-pointer hover:bg-gray-50"
                    onClick={() => handleCellClick(operation, company)}
                  >
                    {editingCell?.operation === operation && editingCell?.company === company ? (
                      <div className="flex gap-2 justify-center">
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleCellSave}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCellSave();
                            if (e.key === 'Escape') handleCellCancel();
                          }}
                          className="w-20 px-2 py-1 border border-blue-500 rounded text-center"
                          autoFocus
                        />
                      </div>
                    ) : (
                      summary[operation]?.[company] || 0
                    )}
                  </td>
                ))}
                <td className="px-4 py-3 text-center text-sm font-semibold">
                  {getTotalForOperation(operation)}
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={Math.max(visibleCompaniesList.length, 1) + 2} className="px-4 py-8 text-center text-gray-500">
                  Нет данных. Добавьте операции для компаний.
                </td>
              </tr>
            )}
            {visibleCompaniesList.length > 0 && (
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-3 text-sm">Итого</td>
                {visibleCompaniesList.map(company => {
                  const total = getTotalForCompany(company);
                  return (
                    <td 
                      key={company} 
                      className={`px-4 py-3 text-center text-sm ${total !== 0 ? 'text-red-600 font-bold' : ''}`}
                    >
                      {total}
                    </td>
                  );
                })}
                <td className={`px-4 py-3 text-center text-sm ${getGrandTotal() !== 0 ? 'text-red-600 font-bold' : ''}`}>
                  {getGrandTotal()}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold mb-4">Таймлайн</h3>
        <div className="flex gap-2 overflow-x-auto">
          {getTodayHours().map((hour, index) => {
            const isActive = hour === currentHour;
            return (
              <button
                key={hour}
                onClick={() => handleTimelineClick(hour)}
                className={`px-4 py-2 rounded ${
                  isActive
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {currentHours[index]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}



