import { useState, useEffect, useRef } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import html2canvas from 'html2canvas';
import axios from 'axios';
import LogoutButton from '../components/LogoutButton';
import { useAuth } from '../contexts/AuthContext';

// Регистрируем компоненты Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface Task {
  time: string;
  product: string;
  weight: number;
  count: number;
  eo?: string;
  sourceEO?: string;
  processType?: string;
  fullData: string[];
}

interface Employee {
  employee: string;
  company?: string;
  lastTime: string;
  taskCount: number;
  totalWeight: number;
  uniqueProductsCount: number;
  uniqueEO2021Count: number;
  uniqueEO2060Count: number;
  tasks: Task[];
  tasks2021: Task[];
  tasks2060: Task[];
  eo2060Data: Record<string, EO2060Data>;
  products2021Data: Record<string, Product2021Data>;
  idleCount: number;
  idleTimes: IdleTime[];
  taskDurations: number[];
}

interface EO2060Data {
  count: number;
  weight: number;
  tasks: number;
  items: Array<{
    time: string;
    product: string;
    count: number;
    weight: number;
  }>;
}

interface Product2021Data {
  count: number;
  weight: number;
  tasks: number;
  items: Array<{
    time: string;
    count: number;
    weight: number;
    sourceEO?: string;
  }>;
}

interface IdleTime {
  from: string;
  to: string;
  duration: number;
  formatted: string;
}

interface ApiTask {
  employee: string;
  company?: string;
  time: string;
  product: string;
  weight: number;
  count: number;
  eo?: string;
  sourceEO?: string;
  processType?: string;
}

export default function FastStat() {
  useAuth();
  const [employeeData, setEmployeeData] = useState<Employee[]>([]);
  const [filteredData, setFilteredData] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentSortColumn, setCurrentSortColumn] = useState('lastTime');
  const [currentSortOrder, setCurrentSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showModal, setShowModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [currentModalTab, setCurrentModalTab] = useState('summary');
  const [expandedEO2060, setExpandedEO2060] = useState<Set<string>>(new Set());
  const [expandedProducts2021, setExpandedProducts2021] = useState<Set<string>>(new Set());
  const [chartData, setChartData] = useState<any>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const itemsPerPage = 50;

  const filters = {
    company: 'all',
    idle: 'all',
    process: 'all',
    tasks: '',
    sortBy: 'time',
    sortOrder: 'asc' as 'asc' | 'desc',
  };

  const [filterState, setFilterState] = useState(filters);

  function compareTime(time1: string, time2: string): number {
    const toSeconds = (time: string) => {
      const parts = time.split(':');
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2] || '0');
    };
    return toSeconds(time1) - toSeconds(time2);
  }

  function timeDifference(time1: string, time2: string): number {
    const toSeconds = (time: string) => {
      const parts = time.split(':');
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2] || '0');
    };
    return Math.abs(toSeconds(time1) - toSeconds(time2));
  }

  function formatTimeDifference(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    let result = '';
    if (hours > 0) result += `${hours} ч `;
    if (minutes > 0) result += `${minutes} мин `;
    if (secs > 0 || result === '') result += `${secs} сек`;

    return result.trim();
  }

  function analyzeIdleTime(employees: Employee[]) {
    employees.forEach((emp) => {
      emp.idleCount = 0;
      emp.idleTimes = [];
      emp.taskDurations = [];

      const sortedTasks = [...emp.tasks].sort((a, b) => compareTime(a.time, b.time));

      for (let i = 1; i < sortedTasks.length; i++) {
        const prevTime = sortedTasks[i - 1].time;
        const currTime = sortedTasks[i].time;
        const diffSeconds = timeDifference(prevTime, currTime);

        if (diffSeconds > 600) {
          emp.idleCount++;
          emp.idleTimes.push({
            from: prevTime,
            to: currTime,
            duration: diffSeconds,
            formatted: formatTimeDifference(diffSeconds),
          });
        }

        emp.taskDurations.push(diffSeconds);
      }
    });
  }

  async function loadAvailableDays() {
    try {
      const daysRes = await axios.get('/integrations/analyz/days');
      const days = daysRes.data?.days || [];
      setAvailableDays(days);
      if (days.length > 0 && !selectedDate) {
        setSelectedDate(days[days.length - 1]);
      }
      return days;
    } catch (error) {
      console.error('Error loading available days:', error);
      setError('Не удалось загрузить список доступных дней');
      return [];
    }
  }

  function processApiTasks(tasks: ApiTask[]): Employee[] {
    const employees: Record<string, any> = {};

    tasks.forEach((task) => {
      const employee = task.employee;
      const time = task.time;
      const weight = task.weight;
      const product = task.product;
      const count = task.count;
      const eo = task.eo || '';
      const sourceEO = task.sourceEO || '';
      const processType = task.processType || '';

      if (!employee || !time || employee === 'Утвердил:' || employee === '') {
        return;
      }

      if (!employees[employee]) {
        employees[employee] = {
          company: task.company || '',
          lastTime: time,
          taskCount: 1,
          totalWeight: weight,
          uniqueProducts: new Set([product]),
          uniqueEO2021: new Set(),
          uniqueEO2060: new Set(),
          tasks: [
            {
              time: time,
              product: product,
              weight: weight,
              count: count,
              eo: eo,
              sourceEO: sourceEO,
              processType: processType,
              fullData: [],
            },
          ],
          tasks2021: [],
          tasks2060: [],
          eo2060Data: {},
          products2021Data: {},
        };
      } else {
        employees[employee].taskCount++;
        employees[employee].totalWeight += weight;
        employees[employee].uniqueProducts.add(product);

        const taskData = {
          time: time,
          product: product,
          weight: weight,
          count: count,
          eo: eo,
          sourceEO: sourceEO,
          processType: processType,
          fullData: [],
        };

        employees[employee].tasks.push(taskData);

        if (processType === '2021') {
          employees[employee].tasks2021.push(taskData);

          if (sourceEO) {
            employees[employee].uniqueEO2021.add(sourceEO);
          }

          if (product) {
            if (!employees[employee].products2021Data[product]) {
              employees[employee].products2021Data[product] = {
                count: 0,
                weight: 0,
                tasks: 0,
                items: [],
              };
            }
            employees[employee].products2021Data[product].count += count;
            employees[employee].products2021Data[product].weight += weight;
            employees[employee].products2021Data[product].tasks++;
            employees[employee].products2021Data[product].items.push({
              time: time,
              count: count,
              weight: weight,
              sourceEO: sourceEO,
            });
          }
        } else if (processType === '2060') {
          employees[employee].tasks2060.push(taskData);

          if (eo) {
            employees[employee].uniqueEO2060.add(eo);

            if (!employees[employee].eo2060Data[eo]) {
              employees[employee].eo2060Data[eo] = {
                count: 0,
                weight: 0,
                tasks: 0,
                items: [],
              };
            }
            employees[employee].eo2060Data[eo].count += count;
            employees[employee].eo2060Data[eo].weight += weight;
            employees[employee].eo2060Data[eo].tasks++;
            employees[employee].eo2060Data[eo].items.push({
              time: time,
              product: product,
              count: count,
              weight: weight,
            });
          }
        }

        if (compareTime(time, employees[employee].lastTime) > 0) {
          employees[employee].lastTime = time;
        }
      }
    });

    const resultArray = Object.keys(employees).map((employee) => ({
      employee,
      company: employees[employee].company || '',
      lastTime: employees[employee].lastTime,
      taskCount: employees[employee].taskCount,
      totalWeight: parseFloat(employees[employee].totalWeight.toFixed(3)),
      uniqueProductsCount: employees[employee].uniqueProducts.size,
      uniqueEO2021Count: employees[employee].uniqueEO2021.size,
      uniqueEO2060Count: employees[employee].uniqueEO2060.size,
      tasks: employees[employee].tasks.sort((a: Task, b: Task) => compareTime(a.time, b.time)),
      tasks2021: employees[employee].tasks2021.sort((a: Task, b: Task) => compareTime(a.time, b.time)),
      tasks2060: employees[employee].tasks2060.sort((a: Task, b: Task) => compareTime(a.time, b.time)),
      eo2060Data: employees[employee].eo2060Data,
      products2021Data: employees[employee].products2021Data,
      idleCount: 0,
      idleTimes: [],
      taskDurations: [],
    }));

    resultArray.sort((a, b) => compareTime(a.lastTime, b.lastTime));

    return resultArray;
  }

  async function loadDayData(date: string) {
    if (!date) return;

    setLoading(true);
    setError(null);

    try {
      const response = await axios.get<{ 
        date: string; 
        tasks: ApiTask[]; 
        error?: string;
        message?: string;
        available_columns?: string[];
        total_tasks?: number;
      }>(
        `/integrations/analyz/faststat_data/${date}`
      );

      if (response.data.error) {
        let errorMessage = response.data.message || response.data.error;
        
        if (response.data.error === 'no_data') {
          errorMessage = 'Нет данных за выбранный день. Убедитесь, что файл был загружен для этой даты.';
        } else if (response.data.error === 'required_columns_not_found') {
          errorMessage = `Не найдены обязательные колонки в файле. ${response.data.message || ''}`;
          if (response.data.available_columns) {
            errorMessage += ` Доступные колонки: ${response.data.available_columns.slice(0, 10).join(', ')}...`;
          }
        } else if (response.data.error === 'no_tasks') {
          errorMessage = 'В файле нет задач с валидными данными.';
        }
        
        setError(errorMessage);
        setEmployeeData([]);
        setFilteredData([]);
        setChartData(null);
        return;
      }

      const tasks = response.data.tasks || [];
      if (tasks.length === 0) {
        setError('Нет задач за выбранный день. Возможно, файл не содержит валидных данных.');
        setEmployeeData([]);
        setFilteredData([]);
        setChartData(null);
        return;
      }

      const employees = processApiTasks(tasks);
      analyzeIdleTime(employees);
      setEmployeeData(employees);
      setFilteredData(employees);
      createTimeChart(employees);
    } catch (error: any) {
      console.error('Error loading day data:', error);
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error || 
                          error.message || 
                          'Неизвестная ошибка';
      setError(`Ошибка при загрузке данных: ${errorMessage}`);
      setEmployeeData([]);
      setFilteredData([]);
      setChartData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAvailableDays();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      loadDayData(selectedDate);
    }
  }, [selectedDate]);

  function createTimeChart(employees: Employee[]) {
    const labels = [];
    const data = [];

    for (let hour = 19; hour <= 21; hour++) {
      labels.push(`${hour}:00`);
      const count = employees.filter((emp) => {
        const empHour = parseInt(emp.lastTime.split(':')[0]);
        return empHour === hour;
      }).length;
      data.push(count);
    }

    setChartData({
      labels,
      datasets: [
        {
          label: 'Количество сотрудников',
          data: data,
          backgroundColor: [
            'rgba(46, 204, 113, 0.7)',
            'rgba(52, 152, 219, 0.7)',
            'rgba(231, 76, 60, 0.7)',
          ],
          borderColor: ['rgb(46, 204, 113)', 'rgb(52, 152, 219)', 'rgb(231, 76, 60)'],
          borderWidth: 1,
        },
      ],
    });
  }

  function applyFilters() {
    if (employeeData.length === 0) {
      setFilteredData([]);
      return;
    }

    let filtered = [...employeeData];

    if (filterState.company !== 'all') {
      filtered = filtered.filter((emp) => {
        const empCompany = (emp.company || '').trim();
        return empCompany === filterState.company;
      });
    }

    if (filterState.idle === 'with_idle') {
      filtered = filtered.filter((emp) => emp.idleCount > 0);
    } else if (filterState.idle === 'without_idle') {
      filtered = filtered.filter((emp) => emp.idleCount === 0);
    }

    if (filterState.process === '2021') {
      filtered = filtered.filter((emp) => emp.tasks2021.length > 0);
    } else if (filterState.process === '2060') {
      filtered = filtered.filter((emp) => emp.tasks2060.length > 0);
    }

    if (filterState.tasks) {
      const minTasks = parseInt(filterState.tasks);
      if (!isNaN(minTasks)) {
        filtered = filtered.filter((emp) => emp.taskCount >= minTasks);
      }
    }

    sortData(filtered, filterState.sortBy, filterState.sortOrder);
    setCurrentPage(1);
  }

  function sortData(data: Employee[], column: string, order: 'asc' | 'desc') {
    data.sort((a, b) => {
      let aValue: any, bValue: any;

      switch (column) {
        case 'company':
          aValue = (a.company || '').toLowerCase();
          bValue = (b.company || '').toLowerCase();
          break;
        case 'employee':
          aValue = a.employee;
          bValue = b.employee;
          break;
        case 'time':
        case 'lastTime':
          aValue = compareTime(a.lastTime, '00:00:00');
          bValue = compareTime(b.lastTime, '00:00:00');
          break;
        case 'tasks':
        case 'taskCount':
          aValue = a.taskCount;
          bValue = b.taskCount;
          break;
        case 'weight':
        case 'totalWeight':
          aValue = a.totalWeight;
          bValue = b.totalWeight;
          break;
        case 'unique_eo_2021':
          aValue = a.uniqueEO2021Count;
          bValue = b.uniqueEO2021Count;
          break;
        case 'unique_eo_2060':
          aValue = a.uniqueEO2060Count;
          bValue = b.uniqueEO2060Count;
          break;
        case 'idle':
        case 'idleCount':
          aValue = a.idleCount;
          bValue = b.idleCount;
          break;
        default:
          aValue = compareTime(a.lastTime, '00:00:00');
          bValue = compareTime(b.lastTime, '00:00:00');
      }

      if (order === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    setFilteredData([...data]);
  }

  function sortTable(column: string) {
    const newOrder =
      currentSortColumn === column ? (currentSortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
    
    setCurrentSortColumn(column);
    setCurrentSortOrder(newOrder);

    setFilterState({
      ...filterState,
      sortBy: column,
      sortOrder: newOrder,
    });
  }

  async function captureScreenshot(companyName?: string) {
    if (!tableRef.current) {
      alert('Таблица не найдена');
      return;
    }

    const targetCompany = companyName || filterState.company;
    if (targetCompany === 'all') {
      alert('Пожалуйста, выберите компанию из фильтра перед созданием скриншота');
      return;
    }

    // Фильтруем данные по выбранной компании
    let dataToScreenshot = [...employeeData];
    if (targetCompany !== 'all') {
      dataToScreenshot = dataToScreenshot.filter((emp) => {
        const empCompany = (emp.company || '').trim();
        return empCompany === targetCompany;
      });
    }

    if (dataToScreenshot.length === 0) {
      alert('Нет данных для выбранной компании');
      return;
    }

    // Сортируем данные по количеству задач (по убыванию)
    dataToScreenshot.sort((a, b) => b.taskCount - a.taskCount);

    setScreenshotLoading(true);
    try {
      // Создаем временный контейнер со всей таблицей (все страницы)
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '-9999px';
      tempContainer.style.top = '0';
      tempContainer.style.width = (tableRef.current.offsetWidth || 1200) + 'px';
      tempContainer.style.backgroundColor = '#ffffff';
      tempContainer.style.padding = '20px';
      tempContainer.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      tempContainer.style.fontSize = '14px';
      tempContainer.style.lineHeight = '1.5';
      
      // Создаем новый заголовок таблицы с отдельными столбцами для КДК и ХР
      const tableHeader = document.createElement('thead');
      const headerRow = document.createElement('tr');
      const headerTitles = ['Компания', 'Сотрудник', 'Последнее время', 'Задачи', 'КДК', 'ХР', 'Вес (кг)', 'ЕО КДК', 'ЕО ХР', 'Простои >10 мин'];
      headerTitles.forEach((title) => {
        const th = document.createElement('th');
        th.style.verticalAlign = 'middle';
        th.style.padding = '6px 8px';
        th.style.backgroundColor = '#3b82f6';
        th.style.color = '#ffffff';
        th.style.fontWeight = 'bold';
        th.style.textAlign = 'left';
        th.style.borderBottom = '1px solid #2563eb';
        th.style.borderRight = '1px solid #2563eb';
        th.style.fontSize = '12px';
        th.textContent = title;
        headerRow.appendChild(th);
      });
      tableHeader.appendChild(headerRow);
      
      // Создаем тело таблицы со всеми данными (уже отсортированными)
      const tableBody = document.createElement('tbody');
      dataToScreenshot.forEach((emp) => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid #e5e7eb';
        
        // Компания
        const cell1 = document.createElement('td');
        cell1.style.verticalAlign = 'middle';
        cell1.style.textAlign = 'center';
        cell1.style.padding = '6px 8px';
        cell1.style.borderBottom = '1px solid #e5e7eb';
        cell1.style.borderRight = '1px solid #e5e7eb';
        cell1.style.fontSize = '12px';
        cell1.innerHTML = emp.company ? 
          `<span style="display: inline-block; padding: 2px 6px; background-color: #f3f4f6; color: #374151; border-radius: 4px; font-size: 11px; vertical-align: middle;">${emp.company}</span>` : 
          '<span style="color: #9ca3af; font-size: 11px; vertical-align: middle;">—</span>';
        row.appendChild(cell1);
        
        // Сотрудник (без бейджей КДК/ХР)
        const cell2 = document.createElement('td');
        cell2.style.verticalAlign = 'middle';
        cell2.style.padding = '6px 8px';
        cell2.style.borderBottom = '1px solid #e5e7eb';
        cell2.style.borderRight = '1px solid #e5e7eb';
        cell2.style.fontSize = '12px';
        cell2.style.fontWeight = 'bold';
        cell2.textContent = emp.employee;
        row.appendChild(cell2);
        
        // Последнее время
        const cell3 = document.createElement('td');
        cell3.style.verticalAlign = 'middle';
        cell3.style.padding = '6px 8px';
        cell3.style.borderBottom = '1px solid #e5e7eb';
        cell3.style.borderRight = '1px solid #e5e7eb';
        cell3.style.textAlign = 'left';
        cell3.style.fontSize = '12px';
        cell3.textContent = emp.lastTime;
        row.appendChild(cell3);
        
        // Задачи
        const cell4 = document.createElement('td');
        cell4.style.verticalAlign = 'middle';
        cell4.style.padding = '6px 8px';
        cell4.style.borderBottom = '1px solid #e5e7eb';
        cell4.style.borderRight = '1px solid #e5e7eb';
        cell4.style.textAlign = 'left';
        cell4.style.fontSize = '12px';
        cell4.textContent = emp.taskCount.toString();
        row.appendChild(cell4);
        
        // КДК (отдельный столбец)
        const cell5 = document.createElement('td');
        cell5.style.verticalAlign = 'middle';
        cell5.style.textAlign = 'center';
        cell5.style.padding = '6px 8px';
        cell5.style.borderBottom = '1px solid #e5e7eb';
        cell5.style.borderRight = '1px solid #e5e7eb';
        cell5.style.fontSize = '12px';
        cell5.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background-color: #dbeafe; color: #1e40af; border-radius: 4px; font-size: 11px; font-weight: bold; vertical-align: middle;">${emp.tasks2021.length}</span>`;
        row.appendChild(cell5);
        
        // ХР (отдельный столбец)
        const cell6 = document.createElement('td');
        cell6.style.verticalAlign = 'middle';
        cell6.style.textAlign = 'center';
        cell6.style.padding = '6px 8px';
        cell6.style.borderBottom = '1px solid #e5e7eb';
        cell6.style.borderRight = '1px solid #e5e7eb';
        cell6.style.fontSize = '12px';
        cell6.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background-color: #fed7aa; color: #9a3412; border-radius: 4px; font-size: 11px; font-weight: bold; vertical-align: middle;">${emp.tasks2060.length}</span>`;
        row.appendChild(cell6);
        
        // Вес
        const cell7 = document.createElement('td');
        cell7.style.verticalAlign = 'middle';
        cell7.style.padding = '6px 8px';
        cell7.style.borderBottom = '1px solid #e5e7eb';
        cell7.style.borderRight = '1px solid #e5e7eb';
        cell7.style.textAlign = 'left';
        cell7.style.fontSize = '12px';
        cell7.textContent = `${emp.totalWeight.toFixed(2)} кг`;
        row.appendChild(cell7);
        
        // ЕО КДК
        const cell8 = document.createElement('td');
        cell8.style.verticalAlign = 'middle';
        cell8.style.textAlign = 'center';
        cell8.style.padding = '6px 8px';
        cell8.style.borderBottom = '1px solid #e5e7eb';
        cell8.style.borderRight = '1px solid #e5e7eb';
        cell8.style.fontSize = '12px';
        cell8.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background-color: #dbeafe; color: #1e40af; border-radius: 4px; font-size: 11px; font-weight: bold; vertical-align: middle;">${emp.uniqueEO2021Count}</span>`;
        row.appendChild(cell8);
        
        // ЕО ХР
        const cell9 = document.createElement('td');
        cell9.style.verticalAlign = 'middle';
        cell9.style.textAlign = 'center';
        cell9.style.padding = '6px 8px';
        cell9.style.borderBottom = '1px solid #e5e7eb';
        cell9.style.borderRight = '1px solid #e5e7eb';
        cell9.style.fontSize = '12px';
        cell9.innerHTML = `<span style="display: inline-block; padding: 2px 6px; background-color: #fed7aa; color: #9a3412; border-radius: 4px; font-size: 11px; font-weight: bold; vertical-align: middle;">${emp.uniqueEO2060Count}</span>`;
        row.appendChild(cell9);
        
        // Простои
        const cell10 = document.createElement('td');
        cell10.style.verticalAlign = 'middle';
        cell10.style.textAlign = 'center';
        cell10.style.padding = '6px 8px';
        cell10.style.borderBottom = '1px solid #e5e7eb';
        cell10.style.fontSize = '12px';
        if (emp.idleCount > 0) {
          cell10.style.color = '#ea580c';
          cell10.style.fontWeight = 'bold';
          cell10.innerHTML = `${emp.idleCount}<span style="display: inline-block; margin-left: 4px; padding: 2px 6px; background-color: #fed7aa; color: #9a3412; border-radius: 4px; font-size: 11px; font-weight: bold; vertical-align: middle;">${emp.idleCount}</span>`;
        } else {
          cell10.textContent = emp.idleCount.toString();
        }
        row.appendChild(cell10);
        
        tableBody.appendChild(row);
      });
      
      // Создаем полную таблицу
      const fullTable = document.createElement('table');
      fullTable.style.width = '100%';
      fullTable.style.borderCollapse = 'collapse';
      fullTable.style.borderSpacing = '0';
      fullTable.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
      fullTable.appendChild(tableHeader);
      fullTable.appendChild(tableBody);
      
      tempContainer.appendChild(fullTable);
      document.body.appendChild(tempContainer);
      
      // Делаем скриншот
      const canvas = await html2canvas(tempContainer, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
        width: tempContainer.offsetWidth,
        height: tempContainer.scrollHeight,
      });

      // Удаляем временный контейнер
      document.body.removeChild(tempContainer);

      canvas.toBlob(async (blob) => {
        if (!blob) {
          alert('Ошибка при создании скриншота');
          setScreenshotLoading(false);
          return;
        }

        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          alert(`Скриншот таблицы компании "${targetCompany}" скопирован в буфер обмена!`);
        } catch (err) {
          // Fallback: скачать файл, если копирование не поддерживается
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          const safeCompanyName = targetCompany.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');
          link.download = `скриншот_${safeCompanyName}_${selectedDate || 'дата'}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          alert(`Скриншот сохранен как файл (копирование в буфер обмена не поддерживается в вашем браузере)`);
        }
        setScreenshotLoading(false);
      }, 'image/png');
    } catch (error) {
      console.error('Ошибка при создании скриншота:', error);
      alert('Ошибка при создании скриншота');
      setScreenshotLoading(false);
    }
  }

  async function quickScreenshot(companyName: string) {
    await captureScreenshot(companyName);
  }

  // Получаем список уникальных компаний
  const uniqueCompanies = (() => {
    const companies = new Set<string>();
    employeeData.forEach((emp) => {
      if (emp.company && emp.company.trim()) {
        companies.add(emp.company.trim());
      }
    });
    return Array.from(companies).sort();
  })();

  useEffect(() => {
    applyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterState, employeeData.length]);


  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, filteredData.length);
  const pageData = filteredData.slice(startIndex, endIndex);

  const totalWeight = employeeData.reduce((sum, emp) => sum + emp.totalWeight, 0);
  const totalTasks = employeeData.reduce((sum, emp) => sum + emp.taskCount, 0);
  const totalUniqueEO2021 = employeeData.reduce((sum, emp) => sum + emp.uniqueEO2021Count, 0);
  const totalUniqueEO2060 = employeeData.reduce((sum, emp) => sum + emp.uniqueEO2060Count, 0);
  const totalTasks2021 = employeeData.reduce((sum, emp) => sum + emp.tasks2021.length, 0);
  const totalTasks2060 = employeeData.reduce((sum, emp) => sum + emp.tasks2060.length, 0);
  const totalIdleCount = employeeData.reduce((sum, emp) => sum + emp.idleCount, 0);

  return (
    <div className="min-h-screen bg-gray-100 p-5">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-800 border-b-4 border-blue-500 pb-2">
              📊 Анализ работы сотрудников - ЕО по процессам КДК и ХР
            </h1>
            <LogoutButton />
          </div>

          {employeeData.length > 0 && uniqueCompanies.length > 0 && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-700 mb-3">📸 Быстрые скриншоты по компаниям:</h3>
              <div className="flex flex-wrap gap-2">
                {uniqueCompanies.map((company) => (
                  <button
                    key={company}
                    onClick={async () => await quickScreenshot(company)}
                    disabled={screenshotLoading}
                    className="bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded font-bold transition text-sm"
                    title={`Создать скриншот таблицы компании "${company}" (сортировка по количеству задач)`}
                  >
                    {screenshotLoading ? '⏳' : '📸'} {company}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4 text-center">Выберите дату для анализа</h2>
            <div className="flex flex-col md:flex-row gap-4 items-center justify-center">
              <div className="flex-1 max-w-md">
                <label className="block font-bold text-gray-700 mb-2">Дата:</label>
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded"
                  disabled={loading || availableDays.length === 0}
                >
                  <option value="">Выберите дату...</option>
                  {availableDays.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
              {employeeData.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                    let csvContent =
                      'Сотрудник;Компания;Последнее время;Всего задач;Задач КДК;Задач ХР;Общий вес (кг);ЕО КДК;ЕО ХР;Уникальные товары;Простои >10 мин;Статус\n';

                      employeeData.forEach((emp) => {
                        let status = 'В норме';
                        const timeSeconds = compareTime(emp.lastTime, '00:00:00');
                        const workEndSeconds = 21 * 3600;

                        if (timeSeconds > workEndSeconds) {
                          status = 'Задержка';
                        } else if (timeSeconds > 20 * 3600 + 30 * 60) {
                          status = 'Близко к концу';
                        }

                        csvContent += `${emp.employee};${emp.company || ''};${emp.lastTime};${emp.taskCount};${emp.tasks2021.length};${emp.tasks2060.length};${emp.totalWeight.toFixed(2)};${emp.uniqueEO2021Count};${emp.uniqueEO2060Count};${emp.uniqueProductsCount};${emp.idleCount};${status}\n`;
                      });

                      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.setAttribute('href', url);
                      link.setAttribute('download', `анализ_сотрудников_${selectedDate}.csv`);
                      link.style.visibility = 'hidden';
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded font-bold transition"
                  >
                    📥 Экспорт в CSV
                  </button>
                  <button
                    onClick={() => captureScreenshot()}
                    disabled={screenshotLoading || filterState.company === 'all'}
                    className="bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-6 py-2 rounded font-bold transition flex items-center gap-2"
                    title={filterState.company === 'all' ? 'Выберите компанию из фильтра для создания скриншота' : 'Скопировать скриншот таблицы в буфер обмена'}
                  >
                    {screenshotLoading ? (
                      <>
                        <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        Создание...
                      </>
                    ) : (
                      <>
                        📸 Скриншот таблицы
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-center">
                {error}
              </div>
            )}
          </div>

          {loading && (
            <div className="text-center py-8">
              <div className="inline-block w-10 h-10 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin mb-4"></div>
              <p className="text-lg">Загрузка данных... Пожалуйста, подождите</p>
            </div>
          )}

          {employeeData.length > 0 && (
            <div>
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6 rounded">
                <p className="mb-2">
                  <strong>📌 Примечание:</strong> Рабочий день до 21:00. Нажмите на сотрудника для
                  просмотра детальной информации.
                </p>
                <p className="mb-2">
                  <strong>🏷️ Уникальные ЕО:</strong> Для процесса ХР - "Принимающие ЕО", для
                  процесса КДК - "Отпускающие ЕО".
                </p>
                <p>
                  <strong>📦 Товары по процессам:</strong> В детализации показаны товары отдельно
                  по процессам КДК и ХР.
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-6 mb-6">
                <h3 className="text-xl font-semibold mb-4">📈 Общая статистика</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white p-4 rounded shadow">
                    <h4 className="text-blue-500 font-semibold mb-2">Всего сотрудников</h4>
                    <div className="text-2xl font-bold text-gray-800">{employeeData.length}</div>
                  </div>
                  <div className="bg-white p-4 rounded shadow">
                    <h4 className="text-blue-500 font-semibold mb-2">Всего задач</h4>
                    <div className="text-2xl font-bold text-gray-800">{totalTasks}</div>
                    <div className="text-sm text-gray-600">
                      КДК: {totalTasks2021} | ХР: {totalTasks2060}
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded shadow">
                    <h4 className="text-blue-500 font-semibold mb-2">Общий вес</h4>
                    <div className="text-2xl font-bold text-gray-800">
                      {totalWeight.toFixed(2)} кг
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded shadow">
                    <h4 className="text-blue-500 font-semibold mb-2">ЕО КДК</h4>
                    <div className="text-2xl font-bold text-gray-800">{totalUniqueEO2021}</div>
                  </div>
                  <div className="bg-white p-4 rounded shadow">
                    <h4 className="text-blue-500 font-semibold mb-2">ЕО ХР</h4>
                    <div className="text-2xl font-bold text-gray-800">{totalUniqueEO2060}</div>
                  </div>
                  <div className="bg-white p-4 rounded shadow">
                    <h4 className="text-blue-500 font-semibold mb-2">Простои &gt;10 мин</h4>
                    <div className="text-2xl font-bold text-gray-800">{totalIdleCount}</div>
                  </div>
                  <div className="bg-white p-4 rounded shadow">
                    <h4 className="text-blue-500 font-semibold mb-2">Ранний финиш</h4>
                    <div className="text-2xl font-bold text-green-600">
                      {employeeData[0]?.lastTime || 'Нет'}
                    </div>
                    <p className="text-sm text-gray-600">{employeeData[0]?.employee || ''}</p>
                  </div>
                </div>
              </div>

              <h3 className="text-2xl font-semibold mb-4">
                👥 Рейтинг сотрудников по времени завершения работы
              </h3>

              <div className="bg-gray-50 rounded-lg p-5 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                  <div>
                    <label className="block font-bold text-gray-700 mb-2">Компания:</label>
                    <select
                      value={filterState.company}
                      onChange={(e) => setFilterState({ ...filterState, company: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value="all">Все компании</option>
                      {(() => {
                        const companies = new Set<string>();
                        employeeData.forEach((emp) => {
                          if (emp.company && emp.company.trim()) {
                            companies.add(emp.company.trim());
                          }
                        });
                        return Array.from(companies).sort().map((company) => (
                          <option key={company} value={company}>
                            {company}
                          </option>
                        ));
                      })()}
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-gray-700 mb-2">Простои:</label>
                    <select
                      value={filterState.idle}
                      onChange={(e) => setFilterState({ ...filterState, idle: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value="all">Любые</option>
                      <option value="with_idle">С простоями</option>
                      <option value="without_idle">Без простоев</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-gray-700 mb-2">Процесс:</label>
                    <select
                      value={filterState.process}
                      onChange={(e) => setFilterState({ ...filterState, process: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value="all">Все процессы</option>
                      <option value="2021">Только КДК</option>
                      <option value="2060">Только ХР</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-gray-700 mb-2">Задач (мин):</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="Минимум задач"
                      value={filterState.tasks}
                      onChange={(e) => setFilterState({ ...filterState, tasks: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-gray-700 mb-2">Сортировка:</label>
                    <select
                      value={filterState.sortBy}
                      onChange={(e) => setFilterState({ ...filterState, sortBy: e.target.value })}
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value="time">Время завершения</option>
                      <option value="tasks">Количество задач</option>
                      <option value="weight">Общий вес</option>
                      <option value="unique_eo_2021">ЕО КДК</option>
                      <option value="unique_eo_2060">ЕО ХР</option>
                      <option value="idle">Простои</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-bold text-gray-700 mb-2">Порядок:</label>
                    <select
                      value={filterState.sortOrder}
                      onChange={(e) =>
                        setFilterState({
                          ...filterState,
                          sortOrder: e.target.value as 'asc' | 'desc',
                        })
                      }
                      className="w-full p-2 border border-gray-300 rounded"
                    >
                      <option value="asc">По возрастанию</option>
                      <option value="desc">По убыванию</option>
                    </select>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={() => {
                        setFilterState(filters);
                        setCurrentSortColumn('lastTime');
                        setCurrentSortOrder('asc');
                      }}
                      className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded font-bold transition"
                    >
                      Сбросить
                    </button>
                    <span className="text-gray-600">
                      Показано: {filteredData.length} из {employeeData.length}
                    </span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto mb-6" ref={tableRef}>
                <table className="w-full border-collapse shadow-lg">
                  <thead>
                    <tr>
                      <th
                        onClick={() => sortTable('company')}
                        className="bg-blue-500 text-white p-3 text-left font-bold cursor-pointer hover:bg-blue-600 sticky top-0"
                      >
                        Компания
                      </th>
                      <th
                        onClick={() => sortTable('employee')}
                        className="bg-blue-500 text-white p-3 text-left font-bold cursor-pointer hover:bg-blue-600 sticky top-0"
                      >
                        Сотрудник
                      </th>
                      <th
                        onClick={() => sortTable('lastTime')}
                        className="bg-blue-500 text-white p-3 text-left font-bold cursor-pointer hover:bg-blue-600 sticky top-0"
                      >
                        Последнее время
                      </th>
                      <th
                        onClick={() => sortTable('taskCount')}
                        className="bg-blue-500 text-white p-3 text-left font-bold cursor-pointer hover:bg-blue-600 sticky top-0"
                      >
                        Задачи
                      </th>
                      <th
                        onClick={() => sortTable('totalWeight')}
                        className="bg-blue-500 text-white p-3 text-left font-bold cursor-pointer hover:bg-blue-600 sticky top-0"
                      >
                        Вес (кг)
                      </th>
                      <th
                        onClick={() => sortTable('unique_eo_2021')}
                        className="bg-blue-500 text-white p-3 text-left font-bold cursor-pointer hover:bg-blue-600 sticky top-0"
                      >
                        ЕО КДК
                      </th>
                      <th
                        onClick={() => sortTable('unique_eo_2060')}
                        className="bg-blue-500 text-white p-3 text-left font-bold cursor-pointer hover:bg-blue-600 sticky top-0"
                      >
                        ЕО ХР
                      </th>
                      <th
                        onClick={() => sortTable('idleCount')}
                        className="bg-blue-500 text-white p-3 text-left font-bold cursor-pointer hover:bg-blue-600 sticky top-0"
                      >
                        Простои &gt;10 мин
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageData.map((emp) => {
                      return (
                        <tr
                          key={emp.employee}
                          onClick={() => {
                            setSelectedEmployee(emp);
                            setShowModal(true);
                            setCurrentModalTab('summary');
                          }}
                          className="cursor-pointer hover:bg-blue-50 transition"
                        >
                          <td className="p-3 border-b border-gray-200">
                            {emp.company ? (
                              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                {emp.company}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-sm">—</span>
                            )}
                          </td>
                          <td className="p-3 border-b border-gray-200">
                            <div>
                              <strong>{emp.employee}</strong>
                            </div>
                            <div className="mt-2">
                            {emp.tasks2021.length > 0 && (
                              <span className="ml-0 mr-2 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                                КДК: {emp.tasks2021.length}
                              </span>
                            )}
                            {emp.tasks2060.length > 0 && (
                              <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-bold">
                                ХР: {emp.tasks2060.length}
                              </span>
                            )}
                            </div>
                          </td>
                          <td className="p-3 border-b border-gray-200">{emp.lastTime}</td>
                          <td className="p-3 border-b border-gray-200">{emp.taskCount}</td>
                          <td className="p-3 border-b border-gray-200">
                            {emp.totalWeight.toFixed(2)} кг
                          </td>
                          <td className="p-3 border-b border-gray-200">
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                              {emp.uniqueEO2021Count}
                            </span>
                          </td>
                          <td className="p-3 border-b border-gray-200">
                            <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-bold">
                              {emp.uniqueEO2060Count}
                            </span>
                          </td>
                          <td
                            className={`p-3 border-b border-gray-200 ${
                              emp.idleCount > 0 ? 'text-orange-600 font-bold' : ''
                            }`}
                          >
                            {emp.idleCount}
                            {emp.idleCount > 0 && (
                              <span className="ml-2 px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-bold">
                                {emp.idleCount}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-4 my-6">
                  <button
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    ◀ Назад
                  </button>
                  <span className="text-gray-600">
                    Страница {currentPage} из {totalPages} ({startIndex + 1}-{endIndex} из{' '}
                    {filteredData.length})
                  </span>
                  <button
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    Вперед ▶
                  </button>
                </div>
              )}

              {chartData && (
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                  <h3 className="text-xl font-semibold mb-4">
                    📅 Распределение времени завершения работы
                  </h3>
                  <div className="h-64">
                    <Bar
                      data={chartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                          y: {
                            beginAtZero: true,
                            title: {
                              display: true,
                              text: 'Количество сотрудников',
                            },
                          },
                          x: {
                            title: {
                              display: true,
                              text: 'Время завершения работы',
                            },
                          },
                        },
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Модальное окно с детальной информацией */}
      {showModal && selectedEmployee && (
        <div
          className="fixed inset-0 bg-black bg-opacity-70 z-50 overflow-y-auto"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white m-12 p-8 rounded-lg max-w-6xl mx-auto relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="absolute top-4 right-6 text-3xl cursor-pointer text-gray-500 hover:text-red-500"
              onClick={() => setShowModal(false)}
            >
              &times;
            </span>

            <div className="border-b-2 border-blue-500 pb-4 mb-6">
              <h2 className="text-2xl font-bold">{selectedEmployee.employee}</h2>
              {selectedEmployee.company && (
                <p className="text-gray-500 text-sm mb-2">
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                    {selectedEmployee.company}
                  </span>
                </p>
              )}
              <p className="text-gray-600">
                Последняя задача: {selectedEmployee.lastTime} | Всего задач: {selectedEmployee.taskCount}{' '}
                (КДК: {selectedEmployee.tasks2021.length}, ХР: {selectedEmployee.tasks2060.length})
              </p>
            </div>

            <div className="flex border-b mb-6 flex-wrap">
              <button
                onClick={() => setCurrentModalTab('summary')}
                className={`px-5 py-2 mr-2 rounded-t ${
                  currentModalTab === 'summary'
                    ? 'bg-white border border-b-0 border-gray-300 font-bold text-blue-500'
                    : 'bg-gray-100'
                }`}
              >
                📊 Общая статистика
              </button>
              <button
                onClick={() => setCurrentModalTab('products2021')}
                className={`px-5 py-2 mr-2 rounded-t ${
                  currentModalTab === 'products2021'
                    ? 'bg-white border border-b-0 border-gray-300 font-bold text-blue-500'
                    : 'bg-gray-100'
                }`}
              >
                📦 Товары КДК
              </button>
              <button
                onClick={() => setCurrentModalTab('eo2060')}
                className={`px-5 py-2 mr-2 rounded-t ${
                  currentModalTab === 'eo2060'
                    ? 'bg-white border border-b-0 border-gray-300 font-bold text-blue-500'
                    : 'bg-gray-100'
                }`}
              >
                🏷️ ЕО ХР
              </button>
              <button
                onClick={() => setCurrentModalTab('tasks')}
                className={`px-5 py-2 mr-2 rounded-t ${
                  currentModalTab === 'tasks'
                    ? 'bg-white border border-b-0 border-gray-300 font-bold text-blue-500'
                    : 'bg-gray-100'
                }`}
              >
                📝 Все задачи
              </button>
              <button
                onClick={() => setCurrentModalTab('idle')}
                className={`px-5 py-2 mr-2 rounded-t ${
                  currentModalTab === 'idle'
                    ? 'bg-white border border-b-0 border-gray-300 font-bold text-blue-500'
                    : 'bg-gray-100'
                }`}
              >
                ⏱️ Простои
              </button>
            </div>

            {currentModalTab === 'summary' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gray-50 p-5 rounded-lg border-l-4 border-blue-500">
                  <h3 className="text-lg font-semibold mb-3">📊 Основная статистика</h3>
                  <div className="space-y-2 text-sm">
                    <p>
                      <strong>Всего задач:</strong> {selectedEmployee.taskCount}
                    </p>
                    <p>
                      <strong>Задач КДК:</strong> {selectedEmployee.tasks2021.length}
                    </p>
                    <p>
                      <strong>Задач ХР:</strong> {selectedEmployee.tasks2060.length}
                    </p>
                    <p>
                      <strong>Общий вес:</strong> {selectedEmployee.totalWeight.toFixed(2)} кг
                    </p>
                    <p>
                      <strong>Средний вес/задачу:</strong>{' '}
                      {(selectedEmployee.totalWeight / selectedEmployee.taskCount).toFixed(3)} кг
                    </p>
                    <p>
                      <strong>Уникальных товаров:</strong> {selectedEmployee.uniqueProductsCount}
                    </p>
                    <p>
                      <strong>Уникальных ЕО КДК:</strong> {selectedEmployee.uniqueEO2021Count}
                    </p>
                    <p>
                      <strong>Уникальных ЕО ХР:</strong> {selectedEmployee.uniqueEO2060Count}
                    </p>
                    <p>
                      <strong>Среднее время между задачами:</strong>{' '}
                      {selectedEmployee.taskDurations.length > 0
                        ? formatTimeDifference(
                            selectedEmployee.taskDurations.reduce((a, b) => a + b, 0) /
                              selectedEmployee.taskDurations.length
                          )
                        : 'Нет данных'}
                    </p>
                  </div>
                </div>
                <div className="bg-gray-50 p-5 rounded-lg border-l-4 border-blue-500">
                  <h3 className="text-lg font-semibold mb-3">⏱️ Анализ времени</h3>
                  <div className="space-y-2 text-sm">
                    <p>
                      <strong>Первая задача:</strong>{' '}
                      {selectedEmployee.tasks.length > 0 ? selectedEmployee.tasks[0].time : 'Нет данных'}
                    </p>
                    <p>
                      <strong>Последняя задача:</strong> {selectedEmployee.lastTime}
                    </p>
                    <p>
                      <strong>Общая продолжительность работы:</strong>{' '}
                      {selectedEmployee.tasks.length > 0
                        ? formatTimeDifference(
                            compareTime(
                              selectedEmployee.lastTime,
                              selectedEmployee.tasks[0].time
                            )
                          )
                        : 'Нет данных'}
                    </p>
                    <p>
                      <strong>Простоев &gt;10 мин:</strong> {selectedEmployee.idleCount}
                    </p>
                    <p>
                      <strong>Среднее время на задачу:</strong>{' '}
                      {selectedEmployee.tasks.length > 0
                        ? formatTimeDifference(
                            compareTime(selectedEmployee.lastTime, selectedEmployee.tasks[0].time) /
                              selectedEmployee.taskCount
                          )
                        : 'Нет данных'}
                    </p>
                  </div>
                </div>
                <div className="bg-gray-50 p-5 rounded-lg border-l-4 border-blue-500">
                  <h3 className="text-lg font-semibold mb-3">🏷️ Уникальные ЕО</h3>
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {(() => {
                      const allEOs = new Set<string>();
                      const eoDetails: Record<string, any> = {};

                      selectedEmployee.tasks2021.forEach((task) => {
                        if (task.sourceEO) {
                          allEOs.add(`КДК: ${task.sourceEO}`);
                          if (!eoDetails[task.sourceEO]) {
                            eoDetails[task.sourceEO] = {
                              process: 'КДК',
                              count: 0,
                              weight: 0,
                              tasks: 0,
                            };
                          }
                          eoDetails[task.sourceEO].count += task.count;
                          eoDetails[task.sourceEO].weight += task.weight;
                          eoDetails[task.sourceEO].tasks++;
                        }
                      });

                      selectedEmployee.tasks2060.forEach((task) => {
                        if (task.eo) {
                          allEOs.add(`ХР: ${task.eo}`);
                          if (!eoDetails[task.eo]) {
                            eoDetails[task.eo] = {
                              process: 'ХР',
                              count: 0,
                              weight: 0,
                              tasks: 0,
                            };
                          }
                          eoDetails[task.eo].count += task.count;
                          eoDetails[task.eo].weight += task.weight;
                          eoDetails[task.eo].tasks++;
                        }
                      });

                      if (allEOs.size === 0) {
                        return <p>Нет данных о ЕО</p>;
                      }

                      return Array.from(allEOs).map((eoStr) => {
                        const [processLabel, eo] = eoStr.split(': ');
                        const details = eoDetails[eo];
                        // Определяем, какой это процесс по исходным данным
                        const isKDK = processLabel === 'КДК' || (details && 
                          selectedEmployee.tasks2021.some(t => t.sourceEO === eo));
                        return (
                          <div key={eoStr} className="bg-white p-3 rounded border-l-3 border-blue-500">
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-bold">{eo}</span>
                              <div className="flex gap-2">
                                <span
                                  className={`px-2 py-1 rounded text-xs font-bold ${
                                    isKDK
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-orange-100 text-orange-700'
                                  }`}
                                >
                                  {processLabel}
                                </span>
                                <span className="text-orange-600 font-bold">
                                  {details.weight.toFixed(2)} кг
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div>
                                <span className="font-bold text-gray-600">Задач:</span> {details.tasks}
                              </div>
                              <div>
                                <span className="font-bold text-gray-600">Количество:</span> {details.count}{' '}
                                шт
                              </div>
                              <div>
                                <span className="font-bold text-gray-600">Процесс:</span>{' '}
                                {processLabel === 'КДК' ? 'Отпускающая' : 'Принимающая'}
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            )}

            {currentModalTab === 'products2021' && (
              <div className="bg-gray-50 p-5 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">
                  📦 Товары по процессу КДК (Отпуск со склада)
                </h3>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {Object.keys(selectedEmployee.products2021Data).length > 0 ? (
                    Object.entries(selectedEmployee.products2021Data)
                      .sort(([, a], [, b]) => b.tasks - a.tasks)
                      .map(([product, data]) => {
                        const isExpanded = expandedProducts2021.has(product);
                        return (
                          <div
                            key={product}
                            className="bg-white p-4 rounded border-l-3 border-blue-500 cursor-pointer hover:bg-blue-50 transition"
                            onClick={() => {
                              const newSet = new Set(expandedProducts2021);
                              if (isExpanded) {
                                newSet.delete(product);
                              } else {
                                newSet.add(product);
                              }
                              setExpandedProducts2021(newSet);
                            }}
                          >
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-bold">{product}</span>
                              <div className="flex gap-2 items-center">
                                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                                  {data.tasks} задач
                                </span>
                                <span className="text-orange-600 font-bold">
                                  {data.weight.toFixed(2)} кг
                                </span>
                                <span className="text-blue-500">{isExpanded ? '▼' : '▶'}</span>
                              </div>
                            </div>
                            {isExpanded && (
                              <div className="mt-3 pt-3 border-t">
                                <div className="grid grid-cols-3 gap-2 text-xs mb-2 font-bold border-b pb-2">
                                  <span>Время</span>
                                  <span>Шт</span>
                                  <span>Вес</span>
                                </div>
                                {data.items.map((item, idx) => (
                                  <div key={idx} className="grid grid-cols-3 gap-2 text-xs mb-2">
                                    <div>
                                      <span className="font-bold text-gray-600">Время:</span> {item.time}
                                    </div>
                                    <div>
                                      <span className="font-bold text-gray-600">Кол-во:</span> {item.count}{' '}
                                      шт
                                    </div>
                                    <div>
                                      <span className="font-bold text-gray-600">Вес:</span>{' '}
                                      {item.weight.toFixed(3)} кг
                                    </div>
                                    {item.sourceEO && (
                                      <div className="col-span-3 text-xs text-gray-500 mt-1">
                                        ЕО: {item.sourceEO}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                  ) : (
                    <p>Нет задач по процессу КДК</p>
                  )}
                </div>
              </div>
            )}

            {currentModalTab === 'eo2060' && (
              <div className="bg-gray-50 p-5 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">🏷️ ЕО по процессу ХР</h3>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {Object.keys(selectedEmployee.eo2060Data).length > 0 ? (
                    Object.entries(selectedEmployee.eo2060Data)
                      .sort(([, a], [, b]) => b.tasks - a.tasks)
                      .map(([eo, data]) => {
                        const isExpanded = expandedEO2060.has(eo);
                        return (
                          <div
                            key={eo}
                            className="bg-white p-4 rounded border-l-3 border-blue-500 cursor-pointer hover:bg-blue-50 transition"
                            onClick={() => {
                              const newSet = new Set(expandedEO2060);
                              if (isExpanded) {
                                newSet.delete(eo);
                              } else {
                                newSet.add(eo);
                              }
                              setExpandedEO2060(newSet);
                            }}
                          >
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-bold">{eo}</span>
                              <div className="flex gap-2 items-center">
                                <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-bold">
                                  {data.tasks} задач
                                </span>
                                <span className="text-orange-600 font-bold">
                                  {data.weight.toFixed(2)} кг
                                </span>
                                <span className="text-blue-500">{isExpanded ? '▼' : '▶'}</span>
                              </div>
                            </div>
                            {isExpanded && (
                              <div className="mt-3 pt-3 border-t">
                                <div className="grid grid-cols-4 gap-2 text-xs mb-2 font-bold border-b pb-2">
                                  <span>Время</span>
                                  <span>Товар</span>
                                  <span>Шт</span>
                                  <span>Вес</span>
                                </div>
                                {data.items.map((item, idx) => (
                                  <div key={idx} className="grid grid-cols-4 gap-2 text-xs mb-2">
                                    <div>
                                      <span className="font-bold text-gray-600">Время:</span> {item.time}
                                    </div>
                                    <div>
                                      <span className="font-bold text-gray-600">Товар:</span>{' '}
                                      {item.product || 'Не указан'}
                                    </div>
                                    <div>
                                      <span className="font-bold text-gray-600">Кол-во:</span> {item.count}{' '}
                                      шт
                                    </div>
                                    <div>
                                      <span className="font-bold text-gray-600">Вес:</span>{' '}
                                      {item.weight.toFixed(3)} кг
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                  ) : (
                    <p>Нет задач по процессу ХР</p>
                  )}
                </div>
              </div>
            )}

            {currentModalTab === 'tasks' && (
              <div className="bg-gray-50 p-5 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">📝 Полная детализация всех задач</h3>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {selectedEmployee.tasks.map((task, index) => {
                    const processBadge =
                      task.processType === '2021' ? (
                        <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                          КДК
                        </span>
                      ) : task.processType === '2060' ? (
                        <span className="ml-2 px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-bold">
                          ХР
                        </span>
                      ) : null;

                    const eoInfo =
                      task.processType === '2021'
                        ? `Отпускающая: ${task.sourceEO || 'Не указана'}`
                        : task.processType === '2060'
                        ? `Принимающая: ${task.eo || 'Не указана'}`
                        : 'Не указана';

                    return (
                      <div key={index} className="bg-white p-4 rounded border-l-3 border-blue-500">
                        <div className="flex justify-between items-center mb-2 pb-2 border-b">
                          <span className="font-bold">
                            {task.time} {processBadge}
                          </span>
                          <span className="text-orange-600 font-bold">{task.weight.toFixed(3)} кг</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                          <div>
                            <span className="font-bold text-gray-600">Товар:</span> {task.product || 'Не указано'}
                          </div>
                          <div>
                            <span className="font-bold text-gray-600">Количество:</span> {task.count} шт
                          </div>
                          <div>
                            <span className="font-bold text-gray-600">ЕО:</span> {eoInfo}
                          </div>
                          <div>
                            <span className="font-bold text-gray-600">Процесс:</span>{' '}
                            {task.processType === '2021' ? 'КДК' : task.processType === '2060' ? 'ХР' : task.processType || 'Не указан'}{' '}
                            {task.processType === '2021' ? '(Отпуск со склада)' : ''}
                          </div>
                          {index > 0 && (
                            <div className="col-span-4">
                              <span className="font-bold text-gray-600">Время от предыдущей:</span>{' '}
                              {formatTimeDifference(
                                timeDifference(task.time, selectedEmployee.tasks[index - 1].time)
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {currentModalTab === 'idle' && (
              <div className="bg-gray-50 p-5 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">
                  ⚠️ Простои в работе (более 10 минут)
                </h3>
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {selectedEmployee.idleTimes.length > 0 ? (
                    selectedEmployee.idleTimes.map((idle, idx) => (
                      <div key={idx} className="bg-yellow-50 p-3 rounded border-l-4 border-yellow-400">
                        <strong>
                          {idle.from} - {idle.to}
                        </strong>
                        <span className="float-right text-orange-600">{idle.formatted}</span>
                      </div>
                    ))
                  ) : (
                    <p>Простоев более 10 минут не обнаружено</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

