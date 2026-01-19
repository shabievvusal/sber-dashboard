import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

export default function EmployeesInfoBlock() {
  const { user } = useAuth();
  const [employeesData, setEmployeesData] = useState<any[]>([]);
  const [visibleCompanies, setVisibleCompanies] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'operator') {
      loadEmployeesData();
      const interval = setInterval(loadEmployeesData, 60000); // Refresh every minute
      
      // Загружаем видимые компании из localStorage
      const saved = localStorage.getItem('visibleCompanies');
      if (saved) {
        try {
          setVisibleCompanies(new Set(JSON.parse(saved)));
        } catch (e) {
          console.error('Error loading visible companies:', e);
        }
      }
      
      return () => clearInterval(interval);
    }
  }, [user]);

  // Отдельный эффект для отслеживания изменений видимых компаний
  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'operator') {
      const checkVisibleCompanies = () => {
        const saved = localStorage.getItem('visibleCompanies');
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as string[];
            const newSet = new Set<string>(parsed);
            setVisibleCompanies(newSet);
          } catch (e) {
            // Ignore
          }
        } else {
          // Если нет сохраненных, показываем все
          setVisibleCompanies(new Set<string>());
        }
      };
      
      checkVisibleCompanies();
      const checkInterval = setInterval(checkVisibleCompanies, 1000);
      return () => clearInterval(checkInterval);
    }
  }, [user]);

  const loadEmployeesData = async () => {
    if (user?.role !== 'admin' && user?.role !== 'operator') {
      return;
    }
    try {
      const response = await axios.get('/api/company-employees');
      setEmployeesData(response.data || []);
    } catch (error: any) {
      // If 403 or other error, just set empty array
      if (error.response?.status !== 403) {
        console.error('Error loading employees data:', error);
      }
      setEmployeesData([]);
    }
  };

  if (user?.role !== 'admin' && user?.role !== 'operator') {
    return null;
  }

  const filteredData = employeesData.filter(item => 
    visibleCompanies.size === 0 || visibleCompanies.has(item.company_name)
  );
  
  const totalEmployees = filteredData.reduce((sum, item) => sum + (item.employees_count || 0), 0);

  return (
    <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Сотрудников на смене по компаниям:</h3>
      <div className="space-y-2 text-sm">
        {filteredData.length > 0 ? (
          <>
            {filteredData.map(item => (
              <div key={item.company_id} className="flex justify-between items-center">
                <span className="text-gray-700">{item.company_name}:</span>
                <span className="font-semibold">{item.employees_count || 0}</span>
              </div>
            ))}
            <div className="border-t border-green-300 pt-2 mt-2 flex justify-between items-center font-bold">
              <span>Итого:</span>
              <span>{totalEmployees}</span>
            </div>
          </>
        ) : (
          <div className="text-gray-500 text-center py-2">Нет данных</div>
        )}
      </div>
    </div>
  );
}

