import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import TaskList from '../components/TaskList';
import LogoutButton from '../components/LogoutButton';
import { getCurrentHours } from '../constants';
import BarcodeIframe from '../components/BarcodeIframe';
import TSDCompanyStats from '../components/TSDCompanyStats';
import ShowStats from './ShowStats';

interface DaySummary {
  date: string;
  total_tasks: number;
  total_weight: number;
  by_company: Record<string, number>;
  latest_finish: string | null;
}

export default function ManagerDashboard() {
  const { user } = useAuth();
  const ANALYZ_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // не чаще 1 раза в час
  const [data, setData] = useState<Record<string, Record<string, number>>>({});
  const [saving, setSaving] = useState(false);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [companyOperations, setCompanyOperations] = useState<string[]>([]);
  const [companyName, setCompanyName] = useState('Компания');
  const [hours, setHours] = useState<string[]>(getCurrentHours());
  const [windowStart, setWindowStart] = useState(0);
  const [lastDaySummary, setLastDaySummary] = useState<DaySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'results' | 'hourly' | 'downtimes'>('summary');
  const [resultsViewMode, setResultsViewMode] = useState<'iframe' | 'react'>('react'); // Переключатель вида отображения результатов
  const [hourlyViewMode, setHourlyViewMode] = useState<'iframe' | 'react'>('iframe'); // Переключатель вида отображения по часам
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [daySummaryCache, setDaySummaryCache] = useState<Record<string, DaySummary>>({});
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [barcodeIframeHeight, setBarcodeIframeHeight] = useState('100px');
  const barcodeIframeRef = useRef<HTMLIFrameElement>(null);
  const lastDaysFetchAtRef = useRef<number>(0);

  useEffect(() => {
    loadCompanyInfo();
    loadEmployeesCount();
    
    // Обновление графика часов каждую минуту (только если не просматриваем отчеты)
    const hoursInterval = setInterval(() => {
      if (activeTab === 'summary') {
        setHours(getCurrentHours());
      }
    }, 60000);
    
    // Обновление статистики убрано - обновляется только после загрузки нового отчета
    
    return () => {
      clearInterval(hoursInterval);
    };
  }, []); // не перезапускаем при переключении вкладок, чтобы не сбивать выбранный день

  useEffect(() => {
    // Обработчик сообщений от iframe генератора штрихкодов
    const handleMessage = (event: MessageEvent) => {
      // Проверяем тип сообщения и данные
      if (event.data && event.data.type === 'barcode-resize') {
        const height = event.data.height;
        if (height === 'expand') {
          setBarcodeIframeHeight('520px');
        } else if (height === 'collapse') {
          setBarcodeIframeHeight('100px');
        } else if (typeof height === 'string' && height.endsWith('px')) {
          setBarcodeIframeHeight(height);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    // Обновление информации о компании только если не просматриваем отчеты
    if (activeTab !== 'summary') {
      return;
    }
    const interval = setInterval(() => {
      loadCompanyInfo();
    }, ANALYZ_REFRESH_INTERVAL_MS); // не чаще 1 раза в час
    return () => clearInterval(interval);
  }, [user?.company_id, activeTab]);

  // Очищаем кэш при изменении компании (данные зависят от компании)
  useEffect(() => {
    // Пропускаем первую загрузку (когда companyName еще 'Компания')
    if (companyName === 'Компания') {
      return;
    }
    setDaySummaryCache({});
    // Перезагружаем последний день при изменении компании
    loadLastDaySummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyName]);

  const loadEmployeesCount = async () => {
    if (!user?.company_id) return;
    try {
      const response = await axios.get(`/api/company-employees/${user.company_id}`);
      setTotalEmployees(response.data.employees_count || 0);
    } catch (error) {
      console.error('Error loading employees count:', error);
    }
  };


  const loadCompanyInfo = async () => {
    if (!user?.company_id) return;

    try {
      const [companiesRes, operationsRes] = await Promise.all([
        axios.get('/api/companies'),
        axios.get(`/api/company-operations/${user.company_id}`)
      ]);

      const company = companiesRes.data.find((c: any) => c.id === user.company_id);
      if (company) {
        setCompanyName(company.name);
      }

      setCompanyOperations(operationsRes.data);
    } catch (error) {
      console.error('Error loading company info:', error);
    }
  };

  const loadAvailableDays = async (force = false) => {
    try {
      const now = Date.now();
      if (!force && availableDays.length > 0 && now - lastDaysFetchAtRef.current < ANALYZ_REFRESH_INTERVAL_MS) {
        return availableDays;
      }
      const daysRes = await axios.get('/integrations/analyz/days');
      const days = daysRes.data?.days || [];
      const previousDaysCount = availableDays.length;
      setAvailableDays(days);
      lastDaysFetchAtRef.current = now;
      
      // Если появился новый день, очищаем кэш (данные могли обновиться)
      if (previousDaysCount > 0 && days.length > previousDaysCount) {
        setDaySummaryCache({});
        // Автоматически переключаемся на новый день
        void loadDaySummary(days[days.length - 1]);
      }
      
      return days;
    } catch (error: any) {
      console.error('Error loading available days:', error);
      // Axios interceptor уже обработал retry, здесь просто логируем
      return [];
    }
  };

  const loadLastDaySummary = async () => {
    setLoadingSummary(true);
    try {
      // Получаем список дней
      const days = await loadAvailableDays();
      
      if (days.length === 0) {
        setLastDaySummary(null);
        return;
      }
      
      // Берем последний день
      const lastDay = days[days.length - 1];
      
      // Проверяем кэш
      if (daySummaryCache[lastDay]) {
        setLastDaySummary(daySummaryCache[lastDay]);
        setLoadingSummary(false);
        return;
      }
      
      // Получаем сводку за этот день
      // Сводка — как у оператора/админа (без фильтра по компании)
      const summaryRes = await axios.get(`/integrations/analyz/day_summary/${lastDay}`);
      if (summaryRes.data && !summaryRes.data.error) {
        const summary: DaySummary = {
          ...summaryRes.data,
          date: lastDay
        };
        // Сохраняем в кэш
        setDaySummaryCache((prev: Record<string, DaySummary>) => ({ ...prev, [lastDay]: summary }));
        setLastDaySummary(summary);
      } else {
        setLastDaySummary(null);
      }
    } catch (error) {
      console.error('Error loading last day summary:', error);
      setLastDaySummary(null);
    } finally {
      setLoadingSummary(false);
    }
  };

  const loadDaySummary = async (date: string) => {
    // Проверяем кэш - если данные уже есть, используем их без загрузки
    if (daySummaryCache[date]) {
      setLastDaySummary(daySummaryCache[date]);
      return;
    }
    
    setLoadingSummary(true);
    try {
      // Сводка — как у оператора/админа (без фильтра по компании)
      const summaryRes = await axios.get(`/integrations/analyz/day_summary/${date}`);
      if (summaryRes.data && !summaryRes.data.error) {
        const summary: DaySummary = {
          ...summaryRes.data,
          date: date
        };
        // Сохраняем в кэш
        setDaySummaryCache((prev: Record<string, DaySummary>) => ({ ...prev, [date]: summary }));
        setLastDaySummary(summary);
      }
    } catch (error) {
      console.error('Error loading day summary:', error);
    } finally {
      setLoadingSummary(false);
    }
  };

  const loadData = async () => {
    if (!user?.company_id) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      const loadedData: Record<string, Record<string, number>> = {};
      
      companyOperations.forEach((op: string) => {
        loadedData[op] = {};
        hours.forEach((h: string) => {
          loadedData[op][h] = 0;
        });
      });

      // Load data for all hours (для ночного графика может быть предыдущий день)
      for (const hour of hours) {
        const [hourNum] = hour.split(':');
        const hourValue = parseInt(hourNum);
        let date = new Date(today);
        
        // Для ночного графика (часы 22-23 и 00-09) может быть предыдущий день
        const now = new Date();
        if (hourValue < 10 && now.getHours() >= 21) {
          // Это ночной график, часы 00-09 могут быть следующего дня
          date.setDate(date.getDate() + 1);
        } else if (hourValue >= 22) {
          // Часы 22-23 могут быть текущего дня или следующего
          if (now.getHours() < 22) {
            date.setDate(date.getDate() - 1);
          }
        }
        
        const dateStr = date.toISOString().split('T')[0];
        const fullHour = `${dateStr} ${hourNum.padStart(2, '0')}:00:00`;
        
        try {
          const response = await axios.get(`/api/hourly-data/${fullHour}`, {
            params: { company_id: user.company_id }
          });
          response.data.forEach((row: any) => {
            if (loadedData[row.operation_type] && loadedData[row.operation_type][hour] !== undefined) {
              loadedData[row.operation_type][hour] = row.value;
            }
          });
        } catch (error) {
          // Ignore errors for hours with no data
        }
      }

      setData(loadedData);
      // Убрали автоматический расчет - не изменяем totalEmployees
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  useEffect(() => {
    if (companyOperations.length > 0) {
      loadData();
    }
  }, [user?.company_id, companyOperations, hours]);

  useEffect(() => {
    if (!companyName || companyName === 'Компания') {
      return;
    }
    loadLastDaySummary();
    loadAvailableDays(true);
  }, [companyName]);

  useEffect(() => {
    // Обновляем список дней не чаще 1 раза в час (только если не просматриваем отчеты)
    if (activeTab !== 'summary') {
      return;
    }
    const interval = setInterval(() => {
      void loadAvailableDays(true);
    }, ANALYZ_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeTab]);

  const availableDaysSet = useMemo(() => new Set(availableDays), [availableDays]);

useEffect(() => {
  if (hours.length === 0) {
    setWindowStart(0);
    return;
  }
  const windowSize = Math.min(3, hours.length);
  const maxStart = Math.max(0, hours.length - windowSize);
  const now = new Date();
  const currentHour = now.getHours();
  const currentIdx = hours.findIndex((h: string) => {
    const [hourNum] = h.split(':');
    return parseInt(hourNum) === currentHour;
  });
  let desiredStart = currentIdx === -1 ? 0 : currentIdx - Math.floor(windowSize / 2);
  desiredStart = Math.max(0, Math.min(desiredStart, maxStart));
  setWindowStart(desiredStart);
}, [hours]);

const windowSize = Math.min(3, hours.length || 1);
const maxWindowStart = Math.max(0, hours.length - windowSize);
const visibleHours = useMemo(() => {
  if (hours.length === 0) return [];
  return hours.slice(windowStart, windowStart + windowSize);
}, [hours, windowStart, windowSize]);

const centerHour = useMemo(() => {
  if (visibleHours.length === 0) return null;
  return visibleHours[Math.floor(visibleHours.length / 2)];
}, [visibleHours]);

const shiftHourWindow = (direction: number) => {
  if (hours.length <= windowSize) return;
  setWindowStart((prev: number) => {
    const next = Math.max(0, Math.min(prev + direction, maxWindowStart));
    return next;
  });
};

  // Убрали автоматический расчет - теперь только ручной ввод

  const handleValueChange = async (operation: string, hour: string, value: number) => {
    if (!user?.company_id) return;

    const newData = { ...data };
    if (!newData[operation]) newData[operation] = {};
    newData[operation][hour] = value;
    setData(newData);
    // Убрали автоматический расчет - не изменяем totalEmployees

    // Определяем дату для сохранения (для ночного графика может быть предыдущий день)
    const now = new Date();
    let date = new Date(now);
    const [hourNum] = hour.split(':');
    const hourValue = parseInt(hourNum);
    
    // Если час < 10, это ночной график и может быть следующий день
    if (hourValue < 10 && now.getHours() >= 21) {
      date.setDate(date.getDate() + 1);
    }
    
    const dateStr = date.toISOString().split('T')[0];
    const fullHour = `${dateStr} ${hourNum.padStart(2, '0')}:00:00`;

    setSaving(true);
    try {
      await axios.post('/api/hourly-data', {
        company_id: user.company_id,
        operation_type: operation,
        hour: fullHour,
        value
      });
    } catch (error) {
      console.error('Error saving data:', error);
    } finally {
      setSaving(false);
    }
  };

  const getCurrentHourTotal = () => {
    const now = new Date();
    const currentHour = now.getHours();
    
    // Находим текущий час в списке hours
    const currentHourStr = hours.find((h: string) => {
      const [hourNum] = h.split(':');
      const hourValue = parseInt(hourNum);
      // Для ночного графика учитываем переход через полночь
      if (hourValue < 10 && currentHour >= 21) {
        return hourValue === currentHour || (currentHour === 0 && hourValue === 0);
      }
      return hourValue === currentHour;
    });
    
    if (currentHourStr) {
      const operationsSum: number = (Object.values(data) as Record<string, number>[]).reduce((sum: number, opData: Record<string, number>) => {
        return sum + (opData[currentHourStr] || 0);
      }, 0);
      // Итого = Сумма операций - Сотрудников на смене
      return operationsSum - totalEmployees;
    }
    return 0 - totalEmployees;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <LogoutButton />
      <div className="flex flex-col lg:flex-row">
        {/* Left sidebar - Tasks */}
        <div className="w-full lg:w-80 bg-white border-r border-gray-200 p-4">
          <TaskList companyId={user?.company_id || null} />
          
          {/* Employee input block - bottom left */}
          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Сотрудников на смене:
            </label>
            <input
              type="number"
              min="0"
              value={totalEmployees}
              onChange={(e: React.ChangeEvent<HTMLInputElement> | any) => {
                const value = parseInt(e.target.value) || 0;
                setTotalEmployees(value);
                if (user?.company_id) {
                  axios.post(`/api/company-employees/${user.company_id}`, {
                    employees_count: value
                  }).catch((err: unknown) => console.error('Error saving employees count:', err));
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded text-lg font-bold text-center"
              placeholder="0"
            />
          </div>

          {/* Summary table for current hour */}
          <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
            <h3 className="text-sm font-semibold mb-2">Распределение по операциям (текущий час)</h3>
            <div className="space-y-1 text-xs">
              {companyOperations.map((op: string) => {
                const now = new Date();
                const currentHour = now.getHours();
                const currentHourStr = hours.find((h: string) => {
                  const [hourNum] = h.split(':');
                  const hourValue = parseInt(hourNum);
                  if (hourValue < 10 && currentHour >= 21) {
                    return hourValue === currentHour || (currentHour === 0 && hourValue === 0);
                  }
                  return hourValue === currentHour;
                }) || hours[0];
                const value = data[op]?.[currentHourStr] || 0;
                return (
                  <div key={op} className="flex justify-between items-center py-1 border-b border-gray-100">
                    <span className="text-gray-700">{op}:</span>
                    <span className="font-semibold">{value}</span>
                  </div>
                );
              })}
              <div className="flex justify-between items-center py-1 border-t-2 border-gray-300 font-bold mt-1">
                <span>Итого:</span>
                <span className={getCurrentHourTotal() !== 0 ? 'text-red-600' : ''}>
                  {getCurrentHourTotal()}
                </span>
              </div>
            </div>
          </div>

          {/* TSD Stats Block */}
          {companyName && (
            <TSDCompanyStats companyName={companyName} />
          )}

          {/* Barcode generator embedded block */}
          <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
            <h3 className="text-sm font-semibold mb-1">Генератор штрихкодов</h3>
            <p className="text-xs text-gray-600 mb-3">
              Введите параметры и получите штрихкоды прямо в этом блоке.
            </p>
            <div className="rounded border border-gray-200 overflow-hidden" style={{ overflow: 'hidden' }}>
              <BarcodeIframe
                ref={barcodeIframeRef}
                compact={true}
                style={{ 
                  height: barcodeIframeHeight, 
                  transition: 'height 0.3s ease',
                  overflow: 'hidden',
                  display: 'block'
                }}
              />
            </div>
          </div>
        </div>

        {/* Main content - Data input */}
        <div className="flex-1 p-4 lg:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl lg:text-2xl font-bold">Ввод данных - {companyName}</h1>
            {saving && <span className="text-sm text-gray-500">Сохранение...</span>}
          </div>

          {/* Hour navigation */}
          <div className="flex items-center justify-between gap-2 mb-4">
            <button
              onClick={() => shiftHourWindow(-1)}
              disabled={windowStart === 0}
              className={`px-3 py-2 rounded ${
                windowStart === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              ←
            </button>
            <div className="flex gap-2">
              {visibleHours.map((hour: string) => (
                <span
                  key={hour}
                  className={`px-3 py-1 rounded text-sm font-semibold ${
                    centerHour === hour ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {hour}
                </span>
              ))}
            </div>
            <button
              onClick={() => shiftHourWindow(1)}
              disabled={windowStart >= maxWindowStart}
              className={`px-3 py-2 rounded ${
                windowStart >= maxWindowStart
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              →
            </button>
          </div>
          
          {/* Mobile-friendly input */}
          <div className="lg:hidden space-y-4">
            {companyOperations.map((operation: string) => (
              <div key={operation} className="bg-white rounded-lg shadow p-4">
                <h3 className="font-semibold mb-3 text-lg">{operation}</h3>
                <div className="grid grid-cols-3 gap-2">
                  {visibleHours.map((hour: string) => (
                    <div key={hour} className="flex flex-col">
                      <label className={`text-xs mb-1 ${centerHour === hour ? 'text-blue-600 font-semibold' : 'text-gray-500'}`}>
                        {hour}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={data[operation]?.[hour] || 0}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleValueChange(operation, hour, parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-2 border border-gray-300 rounded text-center text-lg"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10">
                    Операции
                  </th>
                  {visibleHours.map((hour: string) => (
                    <th
                      key={hour}
                      className={`px-4 py-3 text-center text-sm font-semibold ${
                        centerHour === hour ? 'text-blue-600' : 'text-gray-700'
                      }`}
                    >
                      {hour}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {companyOperations.map((operation: string) => (
                  <tr key={operation}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 sticky left-0 bg-white z-10">
                      {operation}
                    </td>
                    {visibleHours.map((hour: string) => (
                      <td key={hour} className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          value={data[operation]?.[hour] || 0}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleValueChange(operation, hour, parseInt(e.target.value) || 0)}
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Last Day Summary with Tabs and Calendar */}
          <div className={`mt-6 grid grid-cols-1 gap-4 ${activeTab === 'summary' ? 'lg:grid-cols-3' : 'lg:grid-cols-1'}`}>
            {/* Summary and Tabs - 2 columns when summary, full width otherwise */}
            <div className={`bg-white rounded-lg shadow border border-gray-200 overflow-hidden ${activeTab === 'summary' ? 'lg:col-span-2' : 'lg:col-span-1'}`}>
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Отчет за {lastDaySummary?.date || 'дату'}</h3>
                </div>
                {lastDaySummary && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setActiveTab('summary')}
                      className={`px-3 py-1.5 text-sm rounded ${
                        activeTab === 'summary'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      Сводка
                    </button>
                    <button
                      onClick={() => setActiveTab('results')}
                      className={`px-3 py-1.5 text-sm rounded ${
                        activeTab === 'results'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      Результаты
                    </button>
                    <button
                      onClick={() => setActiveTab('hourly')}
                      className={`px-3 py-1.5 text-sm rounded ${
                        activeTab === 'hourly'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      По часам
                    </button>
                    <button
                      onClick={() => setActiveTab('downtimes')}
                      className={`px-3 py-1.5 text-sm rounded ${
                        activeTab === 'downtimes'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      Простои
                    </button>
                  </div>
                )}
              </div>
              <div className="relative">
                {loadingSummary ? (
                  <div className="text-center py-8 text-gray-500">Загрузка...</div>
                ) : lastDaySummary ? (
                  <>
                    {activeTab === 'summary' && (
                      <div className="p-4">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Задач:</span>
                            <span className="font-semibold">{lastDaySummary.total_tasks}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Вес, кг:</span>
                            <span className="font-semibold">{Number(lastDaySummary.total_weight).toLocaleString('ru-RU')}</span>
                          </div>
                          {lastDaySummary.latest_finish && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Окончание:</span>
                              <span className="font-semibold">{lastDaySummary.latest_finish}</span>
                            </div>
                          )}
                        </div>
                        <hr className="my-2" />
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {Object.entries(lastDaySummary.by_company).map(([company, count]) => (
                            <div key={company}><strong>{company}:</strong> {count}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {activeTab === 'results' && (
                      <div className="overflow-hidden">
                                      {/* Переключатель вида отображения */}
                                      <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                                        <span className="text-sm font-medium text-gray-700">Вид отображения:</span>
                                        <div className="flex gap-2">
                                          <button
                                            onClick={() => setResultsViewMode('react')}
                                            className={`px-3 py-1.5 text-xs rounded transition-colors ${
                                              resultsViewMode === 'react'
                                                ? 'bg-blue-600 text-white shadow-md'
                                                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                                            }`}
                                          >
                                            React (с нумерацией и кубками)
                                          </button>
                                          <button
                                            onClick={() => setResultsViewMode('iframe')}
                                            className={`px-3 py-1.5 text-xs rounded transition-colors ${
                                              resultsViewMode === 'iframe'
                                                ? 'bg-blue-600 text-white shadow-md'
                                                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                                            }`}
                                          >
                                            iFrame (классический)
                                          </button>
                                        </div>
                                      </div>
                                      {resultsViewMode === 'react' ? (
                                        <div className="p-4 min-h-[600px]">
                                          <ShowStats embedded={true} />
                                        </div>
                                      ) : (
                                        <div className="overflow-hidden" style={{ minHeight: '600px' }}>
                                          <iframe
                                            src={`/integrations/analyz/analyze_day/${lastDaySummary.date}?company_name=${encodeURIComponent(companyName)}#results`}
                                            title="Результаты"
                                            className="w-full"
                                            style={{ minHeight: '1200px', border: '0' }}
                                          />
                                        </div>
                                      )}
                                    </div>
                    )}
                    {activeTab === 'hourly' && (
                      <div className="overflow-hidden">
                                      {/* Переключатель вида отображения */}
                                      <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                                        <span className="text-sm font-medium text-gray-700">Вид отображения:</span>
                                        <div className="flex gap-2">
                                          <button
                                            onClick={() => setHourlyViewMode('react')}
                                            className={`px-3 py-1.5 text-xs rounded transition-colors ${
                                              hourlyViewMode === 'react'
                                                ? 'bg-blue-600 text-white shadow-md'
                                                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                                            }`}
                                          >
                                            React (с нумерацией и кубками)
                                          </button>
                                          <button
                                            onClick={() => setHourlyViewMode('iframe')}
                                            className={`px-3 py-1.5 text-xs rounded transition-colors ${
                                              hourlyViewMode === 'iframe'
                                                ? 'bg-blue-600 text-white shadow-md'
                                                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                                            }`}
                                          >
                                            iFrame (классический)
                                          </button>
                                        </div>
                                      </div>
                                      {hourlyViewMode === 'react' ? (
                                        <div className="p-4 min-h-[600px]">
                                          <ShowStats embedded={true} />
                                        </div>
                                      ) : (
                                        <div className="overflow-hidden" style={{ minHeight: '600px' }}>
                                          <iframe
                                            src={`/integrations/analyz/analyze_day/${lastDaySummary.date}?company_name=${encodeURIComponent(companyName)}#hourly`}
                                            title="По часам"
                                            className="w-full"
                                            style={{ minHeight: '1200px', border: '0' }}
                                          />
                                        </div>
                                      )}
                                    </div>
                    )}
                    {activeTab === 'downtimes' && (
                      <div className="overflow-hidden" style={{ minHeight: '600px' }}>
                        <iframe
                          src={`/integrations/analyz/analyze_day/${lastDaySummary.date}?company_name=${encodeURIComponent(companyName)}#downtimes`}
                          title="Простои"
                          className="w-full"
                          style={{ minHeight: '1200px', border: '0' }}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-500">Нет загруженных отчетов</div>
                )}
              </div>
            </div>

            {/* Calendar - 1 column, показывается только во вкладке "Сводка" */}
            {activeTab === 'summary' && (
              <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                <div className="p-3 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="mb-0 text-sm font-semibold">Календарь загруженных дней</h5>
                    <div className="flex gap-1">
                      <button
                        onClick={() => void loadAvailableDays(true)}
                        className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200"
                        title="Обновить список дней"
                      >
                        ⟳
                      </button>
                      <button
                        onClick={() => {
                          if (calendarMonth === 0) {
                            setCalendarMonth(11);
                            setCalendarYear(calendarYear - 1);
                          } else {
                            setCalendarMonth(calendarMonth - 1);
                          }
                        }}
                        className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200"
                      >
                        ◀
                      </button>
                      <button
                        onClick={() => {
                          if (calendarMonth === 11) {
                            setCalendarMonth(0);
                            setCalendarYear(calendarYear + 1);
                          } else {
                            setCalendarMonth(calendarMonth + 1);
                          }
                        }}
                        className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200"
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-center">
                    {['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'][calendarMonth]} {calendarYear}
                  </div>
                </div>
                <div className="p-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-center text-gray-500">
                        <th className="p-1">Пн</th>
                        <th className="p-1">Вт</th>
                        <th className="p-1">Ср</th>
                        <th className="p-1">Чт</th>
                        <th className="p-1">Пт</th>
                        <th className="p-1">Сб</th>
                        <th className="p-1">Вс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const firstDay = new Date(calendarYear, calendarMonth, 1);
                        const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
                        const startIdx = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
                        const daysInMonth = lastDay.getDate();
                        const rows = [];
                        let cells = [];
                        
                        // Пустые ячейки до первого дня
                        for (let i = 0; i < startIdx; i++) {
                          cells.push(<td key={`empty-${i}`} className="p-1"></td>);
                        }
                        
                        // Дни месяца
                        for (let day = 1; day <= daysInMonth; day++) {
                          const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const hasData = availableDaysSet.has(dateStr);
                          const isSelected = lastDaySummary?.date === dateStr;
                          
                          cells.push(
                            <td
                              key={day}
                              className={`p-1 text-center cursor-pointer ${
                                isSelected ? 'bg-blue-100 font-semibold' : hasData ? 'font-semibold text-blue-600' : 'text-gray-400'
                              } hover:bg-gray-100 rounded`}
                              onClick={() => hasData && loadDaySummary(dateStr)}
                              title={hasData ? `Загрузить отчет за ${dateStr}` : ''}
                            >
                              <div className="flex items-center justify-center">
                                {day}
                                {hasData && <span className="ml-0.5 text-blue-500">•</span>}
                              </div>
                            </td>
                          );
                          
                          if (cells.length === 7) {
                            rows.push(<tr key={`row-${rows.length}`}>{cells}</tr>);
                            cells = [];
                          }
                        }
                        
                        // Добиваем ряд пустыми ячейками
                        while (cells.length < 7) {
                          cells.push(<td key={`empty-end-${cells.length}`} className="p-1"></td>);
                        }
                        if (cells.length > 0) {
                          rows.push(<tr key={`row-${rows.length}`}>{cells}</tr>);
                        }
                        
                        return rows;
                      })()}
                    </tbody>
                  </table>
                  <div className="mt-2 text-xs text-gray-500 text-center">
                    Клик по дате с точкой открывает отчет
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Summary Modal */}
          {showSummaryModal && lastDaySummary && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                  <h5 className="text-lg font-semibold">Итоги дня</h5>
                  <button
                    onClick={() => setShowSummaryModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-4">
                  <div className="space-y-2 mb-4">
                    <div><strong>Дата:</strong> {lastDaySummary.date}</div>
                    <div><strong>Задач всего:</strong> {lastDaySummary.total_tasks}</div>
                    <div><strong>Вес, кг:</strong> {Number(lastDaySummary.total_weight).toLocaleString('ru-RU')}</div>
                  </div>
                  <hr className="my-2" />
                  <div className="space-y-2 mb-4">
                    <div><strong>Штат:</strong> {lastDaySummary.by_company['Штат'] || 0}</div>
                    <div><strong>Мувинг:</strong> {lastDaySummary.by_company['Мувинг'] || 0}</div>
                    <div><strong>Градус:</strong> {lastDaySummary.by_company['Градус'] || 0}</div>
                    <div><strong>Два Колеса:</strong> {lastDaySummary.by_company['Два Колеса'] || 0}</div>
                    <div><strong>Без компании:</strong> {lastDaySummary.by_company['без компании'] || 0}</div>
                  </div>
                  {lastDaySummary.latest_finish && (
                    <>
                      <hr className="my-2" />
                      <div><strong>Окончание задач:</strong> {lastDaySummary.latest_finish}</div>
                    </>
                  )}
                </div>
                <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
                  <a
                    href={`/integrations/analyz/analyze_day/${lastDaySummary.date}?company_name=${encodeURIComponent(companyName)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Открыть отчёт
                  </a>
                  <button
                    onClick={() => setShowSummaryModal(false)}
                    className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
