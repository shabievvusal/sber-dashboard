import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import SummaryTable from '../components/SummaryTable';
import TaskList from '../components/TaskList';
import DraggableBlock from '../components/DraggableBlock';
import LogoutButton from '../components/LogoutButton';
import EmployeesInfoBlock from '../components/EmployeesInfoBlock';
import UploadReportModal from '../components/UploadReportModal';
import BarcodeIframe from '../components/BarcodeIframe';
import TSDControlEmbedded from '../components/TSDControlEmbedded';
import ServiceNoteEditor from '../components/ServiceNoteEditor';
import ShowStats from './ShowStats';

interface BlockConfig {
  id: string;
  visible: boolean;
}

interface DaySummary {
  date: string;
  total_tasks: number;
  total_weight: number;
  by_company: Record<string, number>;
  latest_finish: string | null;
}

export default function OperatorDashboard() {
  const { user, logout } = useAuth();
  const [currentHour, setCurrentHour] = useState('');
  const [barcodeIframeHeight, setBarcodeIframeHeight] = useState('100px');
  const barcodeIframeRef = useRef<HTMLIFrameElement>(null);
  const [blocks, setBlocks] = useState<BlockConfig[]>([
    { id: 'summary', visible: true },
    { id: 'analyz', visible: true },
    { id: 'reports', visible: true },
    { id: 'serviceNote', visible: true }
  ]);
  const [lastDaySummary, setLastDaySummary] = useState<DaySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'results' | 'hourly' | 'downtimes'>('summary');
  const [resultsViewMode, setResultsViewMode] = useState<'iframe' | 'react'>('react'); // Переключатель вида отображения результатов
  const [hourlyViewMode, setHourlyViewMode] = useState<'iframe' | 'react'>('iframe'); // Переключатель вида отображения по часам
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [showUploadModal, setShowUploadModal] = useState(false);

  useEffect(() => {
    updateCurrentHour();
    // Обновление текущего часа только если не просматриваем отчеты
    const interval = setInterval(() => {
      if (activeTab === 'summary') {
        updateCurrentHour();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Первичная загрузка списка дней и последней сводки, без сброса выбора при переключении вкладок
  useEffect(() => {
    loadLastDaySummary();
    loadAvailableDays();
  }, []);

  useEffect(() => {
    // Загружаем настройки модулей из БД (если есть) или из localStorage
    const loadModulesConfig = async () => {
      if (user?.id && user?.role === 'operator') {
        // Для операторов загружаем только из БД
        try {
          const response = await axios.get(`/api/users/${user.id}/modules`);
          if (response.data.modules && Array.isArray(response.data.modules)) {
            // Убеждаемся, что все необходимые модули присутствуют
            const defaultModules = [
              { id: 'summary', visible: true },
              { id: 'analyz', visible: true },
              { id: 'reports', visible: true },
              { id: 'serviceNote', visible: true }
            ];
            const allModules = defaultModules.map(defaultMod => {
              const saved = response.data.modules.find((m: BlockConfig) => m.id === defaultMod.id);
              return saved || defaultMod;
            });
            // Убеждаемся, что serviceNote присутствует в списке
            if (!allModules.find(m => m.id === 'serviceNote')) {
              allModules.push({ id: 'serviceNote', visible: true });
            }
            setBlocks(allModules);
            // Не сохраняем в localStorage для операторов - настройки управляются админом
            return;
          }
        } catch (error) {
          console.error('Error loading modules from DB:', error);
          // Если не удалось загрузить из БД, используем дефолтные настройки
          setBlocks([
            { id: 'summary', visible: true },
            { id: 'analyz', visible: true },
            { id: 'reports', visible: true },
            { id: 'serviceNote', visible: true }
          ]);
        }
      } else {
        // Для админов и других ролей используем localStorage
        const saved = localStorage.getItem('operatorBlocks');
        if (saved) {
          try {
            const parsed: BlockConfig[] = JSON.parse(saved);
            const ids = new Set(parsed.map((b) => b.id));
            if (!ids.has('analyz')) {
              parsed.push({ id: 'analyz', visible: true });
            }
            if (!ids.has('reports')) {
              parsed.push({ id: 'reports', visible: true });
            }
            setBlocks(parsed);
          } catch (e) {
            console.error('Error loading blocks config:', e);
          }
        }
      }
    };
    
    loadModulesConfig();
  }, [user?.id, user?.role]);

  useEffect(() => {
    // Обновление списка дней только если не просматриваем отчеты
    // Статистика обновляется только после загрузки нового отчета
    if (activeTab !== 'summary') {
      return;
    }
    const interval = setInterval(() => {
      loadAvailableDays();
      // loadLastDaySummary() убран - обновляется только после загрузки нового отчета
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
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

  const updateCurrentHour = () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const hour = now.getHours();
    setCurrentHour(`${dateStr} ${hour.toString().padStart(2, '0')}:00:00`);
  };

  const loadAvailableDays = async () => {
    try {
      const daysRes = await axios.get('/integrations/analyz/days');
      const days = daysRes.data?.days || [];
      setAvailableDays(days);
      return days;
    } catch (error) {
      console.error('Error loading available days:', error);
      return [];
    }
  };

  const loadLastDaySummary = async () => {
    setLoadingSummary(true);
    try {
      const days = await loadAvailableDays();
      if (days.length === 0) {
        setLastDaySummary(null);
        return;
      }
      const lastDay = days[days.length - 1];
      const summaryRes = await axios.get(`/integrations/analyz/day_summary/${lastDay}`);
      if (summaryRes.data && !summaryRes.data.error) {
        setLastDaySummary({
          ...summaryRes.data,
          date: lastDay
        });
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
    setLoadingSummary(true);
    try {
      const summaryRes = await axios.get(`/integrations/analyz/day_summary/${date}`);
      if (summaryRes.data && !summaryRes.data.error) {
        setLastDaySummary({
          ...summaryRes.data,
          date: date
        });
        // Сохраняем текущую вкладку (результаты/по часам/простои) при смене дня
      }
    } catch (error) {
      console.error('Error loading day summary:', error);
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleUploadSuccess = () => {
    loadAvailableDays();
    loadLastDaySummary();
  };

  const saveBlocksConfig = (newBlocks: BlockConfig[]) => {
    // Операторы не могут изменять настройки модулей - они управляются админом через БД
    if (user?.role === 'operator') {
      return; // Операторы не могут сохранять изменения
    }
    setBlocks(newBlocks);
    localStorage.setItem('operatorBlocks', JSON.stringify(newBlocks));
  };

  const moveBlock = (dragIndex: number, hoverIndex: number) => {
    // Операторы не могут изменять порядок модулей
    if (user?.role === 'operator') {
      return; // Операторы не могут перемещать блоки
    }
    const newBlocks = [...blocks];
    const draggedBlock = newBlocks[dragIndex];
    newBlocks.splice(dragIndex, 1);
    newBlocks.splice(hoverIndex, 0, draggedBlock);
    saveBlocksConfig(newBlocks);
  };

  const toggleBlockVisibility = (id: string) => {
    // Операторы не могут изменять видимость модулей - это управляется админом
    if (user?.role === 'operator') {
      return; // Операторы не могут переключать видимость
    }
    const newBlocks = blocks.map(block =>
      block.id === id ? { ...block, visible: !block.visible } : block
    );
    saveBlocksConfig(newBlocks);
  };

  const handleLogout = async () => {
    await logout();
  };

  if (!user) {
    return <div className="min-h-screen flex items-center justify-center">Загрузка пользователя...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <LogoutButton />
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Панель оператора</h1>
        <div className="flex gap-4 items-center">
          <button
            onClick={() => window.open('/faststat', '_blank')}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 font-semibold"
          >
            📊 Анализ работы сотрудников
          </button>
          <span className="text-gray-600">Пользователь: {user?.username}</span>
          <button
            onClick={() => setShowUploadModal(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Загрузить отчет
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Выход
          </button>
        </div>
      </div>
      <div className="flex flex-col lg:flex-row">
        <div className="w-full lg:w-80 bg-white border-r border-gray-200 p-4">
          <TaskList companyId={null} canCreate={true} />
          <EmployeesInfoBlock />
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
        <div className="flex-1 p-4 lg:p-6">
          {/* Mobile version */}
          <div className="lg:hidden space-y-4">
            {blocks
              .filter(block => block.visible)
              .map((block) => (
                block.id === 'summary' && (
                  <SummaryTable currentHour={currentHour} onHourChange={setCurrentHour} key={block.id} />
                )
              ))}
            {blocks
              .filter(block => block.visible)
              .map((block) => (
                block.id === 'reports' && (
                  <div key={block.id} className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold">Отчеты и календарь</h3>
                    </div>
                    <div className="p-4">
                      <div className="text-center py-8 text-gray-500">Откройте на десктопе для просмотра отчетов</div>
                    </div>
                  </div>
                )
              ))}
          </div>
          {/* Desktop version */}
          <div className="hidden lg:block space-y-4">
            {blocks
              .filter(block => (user?.role === 'operator' ? block.visible : true))
              .map((block, index) => {
                return (
                  <DraggableBlock
                    key={block.id}
                    id={block.id}
                    index={index}
                    moveBlock={moveBlock}
                    isVisible={block.visible}
                    onToggleVisibility={toggleBlockVisibility}
                    canToggle={user?.role !== 'operator'} // Операторы не могут переключать
                  >
                    {block.id === 'summary' && (
                      <SummaryTable currentHour={currentHour} onHourChange={setCurrentHour} />
                    )}
                    {block.id === 'analyz' && (
                      <div className="rounded-lg border border-gray-200 overflow-hidden p-4 bg-white">
                        <TSDControlEmbedded />
                      </div>
                    )}
                    {block.id === 'serviceNote' && (
                      <ServiceNoteEditor />
                    )}
                    {block.id === 'reports' && (
                  <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                    <div className={`grid grid-cols-1 gap-4 ${activeTab === 'summary' ? 'lg:grid-cols-3' : 'lg:grid-cols-1'}`}>
                      <div className={`${activeTab === 'summary' ? 'lg:col-span-2' : 'lg:col-span-1'}`}>
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
                                            src={`/integrations/analyz/analyze_day/${lastDaySummary.date}#results`}
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
                                            src={`/integrations/analyz/analyze_day/${lastDaySummary.date}#hourly`}
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
                                    src={`/integrations/analyz/analyze_day/${lastDaySummary.date}#downtimes`}
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
                      {activeTab === 'summary' && (
                        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                          <div className="p-3 border-b border-gray-200">
                            <div className="flex items-center justify-between mb-2">
                              <h5 className="mb-0 text-sm font-semibold">Календарь загруженных дней</h5>
                              <div className="flex gap-1">
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
                                  
                                  for (let i = 0; i < startIdx; i++) {
                                    cells.push(<td key={`empty-${i}`} className="p-1"></td>);
                                  }
                                  
                                  for (let day = 1; day <= daysInMonth; day++) {
                                    const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                    const hasData = availableDays.includes(dateStr);
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
                  </div>
                )}
                  </DraggableBlock>
                );
              })}
          </div>
        </div>
      </div>
      <UploadReportModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadSuccess={handleUploadSuccess}
      />
    </div>
  );
}
