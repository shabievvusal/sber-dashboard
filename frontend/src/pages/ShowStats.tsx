import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import LogoutButton from '../components/LogoutButton';
import { useAuth } from '../contexts/AuthContext';
import { 
  Search, 
  RefreshCw, 
  Filter, 
  TrendingUp, 
  Package, 
  Scale, 
  Clock, 
  Users,
  Camera,
  BarChart3,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

type EmployeeStat = {
  id: string;
  name: string;
  company?: string;
  tasks: number;
  weight: number;
  qty: number;
  speed: number;
  breaks_total: string;
  breaks_total_seconds?: number;
};

type EmployeeStatsResponse = {
  date: string;
  employees: EmployeeStat[];
  error?: string;
};

type EmployeesMappingRow = {
  code: string;
  photo_url?: string | null;
};

type CompanyTheme = {
  accentText: string;
  badgeBg: string;
  badgeBorder: string;
  ring: string;
  border: string;
  sidePanelBg: string;
  gradient: string;
  shadow: string;
  progress: string;
  cardBg: string;
};

function normalizeCompany(company?: string) {
  return (company || '').trim().toLowerCase();
}

function getCompanyTheme(company?: string): CompanyTheme {
  const c = normalizeCompany(company);
  
  if (c === 'штат') {
    return {
      accentText: 'text-emerald-700',
      badgeBg: 'bg-gradient-to-r from-emerald-600 to-emerald-500',
      badgeBorder: 'border-emerald-600/30',
      ring: 'ring-emerald-500/20',
      border: 'border-emerald-500/20',
      sidePanelBg: 'bg-gradient-to-r from-emerald-900/80 to-emerald-800/80',
      gradient: 'from-emerald-500/10 to-emerald-500/5',
      shadow: 'shadow-emerald-500/10',
      progress: 'bg-emerald-500',
      cardBg: 'bg-gradient-to-br from-white via-white to-emerald-50/30'
    };
  }
  if (c === 'градус' || c === 'эск') {
    return {
      accentText: 'text-blue-700',
      badgeBg: 'bg-gradient-to-r from-blue-600 to-blue-500',
      badgeBorder: 'border-blue-600/30',
      ring: 'ring-blue-500/20',
      border: 'border-blue-500/20',
      sidePanelBg: 'bg-gradient-to-r from-blue-900/80 to-blue-800/80',
      gradient: 'from-blue-500/10 to-blue-500/5',
      shadow: 'shadow-blue-500/10',
      progress: 'bg-blue-500',
      cardBg: 'bg-gradient-to-br from-white via-white to-blue-50/30'
    };
  }
  if (c === 'мувинг') {
    return {
      accentText: 'text-amber-700',
      badgeBg: 'bg-gradient-to-r from-amber-600 to-amber-500',
      badgeBorder: 'border-amber-600/30',
      ring: 'ring-amber-500/20',
      border: 'border-amber-500/20',
      sidePanelBg: 'bg-gradient-to-r from-amber-900/80 to-amber-800/80',
      gradient: 'from-amber-500/10 to-amber-500/5',
      shadow: 'shadow-amber-500/10',
      progress: 'bg-amber-500',
      cardBg: 'bg-gradient-to-br from-white via-white to-amber-50/30'
    };
  }
  return {
    accentText: 'text-slate-700',
    badgeBg: 'bg-gradient-to-r from-slate-700 to-slate-600',
    badgeBorder: 'border-slate-600/30',
    ring: 'ring-slate-500/20',
    border: 'border-slate-300/50',
    sidePanelBg: 'bg-gradient-to-r from-slate-900/80 to-slate-800/80',
    gradient: 'from-slate-500/10 to-slate-500/5',
    shadow: 'shadow-slate-500/10',
    progress: 'bg-slate-500',
    cardBg: 'bg-gradient-to-br from-white via-white to-slate-50/30'
  };
}

function fmtNum(v: number, digits = 0) {
  const n = Number.isFinite(v) ? v : 0;
  return n.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

type TasksBucketKey = '0-399' | '400-699' | '700-999' | '1000+';

const TASK_BUCKETS: Array<{ key: TasksBucketKey; label: string; min: number; max?: number; color: string }> = [
  { key: '1000+', label: '1000+ задач', min: 1000, color: 'bg-gradient-to-r from-emerald-600 to-emerald-500' },
  { key: '700-999', label: '700–999 задач', min: 700, max: 999, color: 'bg-gradient-to-r from-blue-600 to-blue-500' },
  { key: '400-699', label: '400–699 задач', min: 400, max: 699, color: 'bg-gradient-to-r from-amber-600 to-amber-500' },
  { key: '0-399', label: '0–399 задач', min: 0, max: 399, color: 'bg-gradient-to-r from-slate-600 to-slate-500' }
];

function getTasksBucket(tasks: number): TasksBucketKey {
  const t = Math.max(0, Math.floor(Number.isFinite(tasks) ? tasks : 0));
  if (t >= 1000) return '1000+';
  if (t >= 700) return '700-999';
  if (t >= 400) return '400-699';
  return '0-399';
}

interface ShowStatsProps {
  embedded?: boolean; // Если true, скрываем LogoutButton и некоторые элементы заголовка
}

export default function ShowStats({ embedded = false }: ShowStatsProps = {} as ShowStatsProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string>('');
  const [employees, setEmployees] = useState<EmployeeStat[]>([]);
  const [query, setQuery] = useState('');
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({});
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const [expandedBuckets, setExpandedBuckets] = useState<Record<TasksBucketKey, boolean>>({
    '0-399': true,
    '400-699': true,
    '700-999': true,
    '1000+': true
  });

  const toggleBucket = (key: TasksBucketKey) => {
    setExpandedBuckets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e => {
      const name = (e.name || e.id || '').toLowerCase();
      const company = (e.company || '').toLowerCase();
      return name.includes(q) || company.includes(q);
    });
  }, [employees, query]);

  const statsSummary = useMemo(() => {
    const totalEmployees = filtered.length;
    const totalTasks = filtered.reduce((sum, e) => sum + (e.tasks || 0), 0);
    const avgTasks = totalEmployees > 0 ? totalTasks / totalEmployees : 0;
    const totalWeight = filtered.reduce((sum, e) => sum + (e.weight || 0), 0) / 1000;
    
    return { totalEmployees, totalTasks, avgTasks, totalWeight };
  }, [filtered]);

  const groupedByTasks = useMemo(() => {
    const groups: Record<TasksBucketKey, EmployeeStat[]> = {
      '0-399': [],
      '400-699': [],
      '700-999': [],
      '1000+': []
    };
    for (const e of filtered) {
      const bucket = getTasksBucket(e.tasks);
      groups[bucket].push(e);
    }
    for (const key of Object.keys(groups) as TasksBucketKey[]) {
      groups[key].sort((a, b) => {
        const ta = Number.isFinite(a.tasks) ? a.tasks : 0;
        const tb = Number.isFinite(b.tasks) ? b.tasks : 0;
        if (tb !== ta) return tb - ta;
        const sa = Number.isFinite(a.speed) ? a.speed : 0;
        const sb = Number.isFinite(b.speed) ? b.speed : 0;
        return sb - sa;
      });
    }
    return groups;
  }, [filtered]);

  // Получаем общий топ-3 лидеров по всем категориям для кубков
  const topLeaders = useMemo(() => {
    const allSorted = [...filtered].sort((a, b) => {
      const ta = Number.isFinite(a.tasks) ? a.tasks : 0;
      const tb = Number.isFinite(b.tasks) ? b.tasks : 0;
      if (tb !== ta) return tb - ta;
      const sa = Number.isFinite(a.speed) ? a.speed : 0;
      const sb = Number.isFinite(b.speed) ? b.speed : 0;
      return sb - sa;
    });
    return allSorted.slice(0, 3).map(e => e.id);
  }, [filtered]);

  const loadPhotos = async () => {
    try {
      const res = await axios.get<{ rows: EmployeesMappingRow[] }>('/api/employees-mapping');
      const next: Record<string, string> = {};
      for (const r of res.data.rows || []) {
        const code = String(r.code || '').trim();
        const url = String(r.photo_url || '').trim();
        if (code && url) next[code] = url;
      }
      setPhotoMap(next);
    } catch {
      // не блокируем страницу, если фото не загрузились
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get<EmployeeStatsResponse>('/integrations/analyz/employee_stats_today');
      if ((res.data as any)?.error) {
        setError((res.data as any).error || 'Ошибка загрузки');
        setEmployees([]);
        setDate('');
      } else {
        setEmployees(res.data.employees || []);
        setDate(res.data.date || '');
      }
      void loadPhotos();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Ошибка загрузки');
      setEmployees([]);
      setDate('');
    } finally {
      setLoading(false);
    }
  };

  const uploadPhotoForEmployee = async (employeeId: string, file: File) => {
    try {
      setUploadingPhotoId(employeeId);
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`/api/employees-mapping/photo/${encodeURIComponent(employeeId)}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const url = String(res.data?.photo_url || '').trim();
      if (url) {
        setPhotoMap((prev) => ({ ...prev, [employeeId]: `${url}?t=${Date.now()}` }));
      } else {
        void loadPhotos();
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Ошибка при загрузке фото');
    } finally {
      setUploadingPhotoId(null);
    }
  };

  const triggerUploadPhoto = (employeeId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void uploadPhotoForEmployee(employeeId, file);
    };
    input.click();
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className={`${embedded ? '' : 'min-h-screen'} bg-gradient-to-br from-slate-50 via-white to-slate-100`}>
      {!embedded && <LogoutButton />}
      
      <div className="max-w-[2000px] mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <BarChart3 className="w-8 h-8 text-blue-600" />
                <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                  Статистика сотрудников
                </h1>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <Clock className="w-4 h-4" />
                <span className="text-sm font-medium">
                  {date ? `За ${date}` : 'За сегодня'}
                </span>
                <span className="mx-2">•</span>
                <Users className="w-4 h-4" />
                <span className="text-sm font-medium">{statsSummary.totalEmployees} сотрудников</span>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full sm:w-80 pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent shadow-sm"
                  placeholder="Поиск сотрудника или компании…"
                />
              </div>
              <button
                onClick={() => void load()}
                disabled={loading}
                className="px-5 py-3 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 text-white hover:from-slate-800 hover:to-slate-700 disabled:opacity-50 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-slate-900/10 hover:shadow-xl hover:shadow-slate-900/20"
                title="Обновить данные"
              >
                {loading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <RefreshCw className="w-5 h-5" />
                )}
                <span>Обновить</span>
              </button>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-200/50 shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Всего задач</p>
                  <p className="text-3xl font-bold text-slate-900 mt-2">{fmtNum(statsSummary.totalTasks)}</p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/10">
                  <Package className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
            </div>
            
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-200/50 shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Среднее на сотрудника</p>
                  <p className="text-3xl font-bold text-slate-900 mt-2">{fmtNum(statsSummary.avgTasks, 1)}</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-500/10">
                  <Users className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </div>
            
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-200/50 shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Общий вес</p>
                  <p className="text-3xl font-bold text-slate-900 mt-2">{fmtNum(statsSummary.totalWeight, 2)} т</p>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/10">
                  <Scale className="w-6 h-6 text-amber-600" />
                </div>
              </div>
            </div>
            
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-5 border border-slate-200/50 shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Скорость</p>
                  <p className="text-3xl font-bold text-slate-900 mt-2">
                    {filtered.length > 0 
                      ? fmtNum(filtered.reduce((sum, e) => sum + (e.speed || 0), 0) / filtered.length, 2)
                      : '0'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-purple-500/10">
                  <TrendingUp className="w-6 h-6 text-purple-600" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-red-100 text-red-700 backdrop-blur-sm shadow-lg">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-red-500/10">
                <Filter className="w-5 h-5" />
              </div>
              <span>{String(error)}</span>
            </div>
          </div>
        )}

        {/* Employees Grid */}
        <div className="space-y-8">
          {(() => {
            // Вычисляем глобальную нумерацию: подсчитываем количество записей в предыдущих категориях
            let globalNumberCounter = 0;
            return TASK_BUCKETS.map((bucket) => {
              const items = groupedByTasks[bucket.key] || [];
              const isExpanded = expandedBuckets[bucket.key];
              
              if (items.length === 0) return null;
              
              // Сохраняем начальный номер для этой категории
              const categoryStartNumber = globalNumberCounter;
              // Обновляем счетчик после этой категории (для следующей итерации)
              globalNumberCounter += items.length;
              
              return (
                <div key={bucket.key} className="bg-white/50 backdrop-blur-sm rounded-3xl p-6 border border-slate-200/50 shadow-lg">
                  <button
                    onClick={() => toggleBucket(bucket.key)}
                    className="w-full mb-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-8 rounded-full ${bucket.color}`}></div>
                        <h2 className="text-xl font-bold text-slate-900">{bucket.label}</h2>
                        <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-sm font-medium">
                          {items.length} сотрудников
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                  </button>
                  
                  {isExpanded && (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
                      {items.map((e, index) => {
                        const theme = getCompanyTheme(e.company);
                        const name = (e.name || e.id || '').trim();
                        const company = (e.company || '—').trim() || '—';
                        const weightInTons = (e.weight ?? 0) / 1000;
                        const weight = fmtNum(weightInTons, 2);
                        const qty = fmtNum(e.qty ?? 0, 0);
                        const speed = fmtNum(e.speed ?? 0, 2);
                        const tasks = fmtNum(e.tasks ?? 0, 0);
                        const bg = photoMap[e.id] ? `url(${photoMap[e.id]})` : `url(/FotoIcon.jpg)`;
                        
                        // Определяем позицию в общем топе для кубков
                        const globalIndex = topLeaders.indexOf(e.id);
                        const isTop3 = globalIndex !== -1;
                        const trophyPosition = globalIndex === 0 ? 'gold' : globalIndex === 1 ? 'silver' : globalIndex === 2 ? 'bronze' : null;
                        // Глобальный номер (учитывает все предыдущие категории)
                        const categoryNumber = categoryStartNumber + index + 1;
                      
                      // Отладочная информация (можно удалить после проверки)
                      if (index === 0) {
                        console.log('ShowStats - Top leaders:', topLeaders);
                        console.log('ShowStats - First employee:', { id: e.id, name: e.name, tasks: e.tasks, trophyPosition });
                      }
                      
                      return (
                        <div 
                          key={e.id} 
                          className={`group relative rounded-2xl overflow-hidden border backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl ${theme.cardBg} ${theme.border} ${theme.shadow}`}
                        >
                          {/* Номер сотрудника - всегда в одном месте */}
                          <div 
                            className="absolute top-2 left-2 z-50 px-3 py-1.5 rounded-lg border-2 shadow-2xl"
                            style={{
                              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                              borderColor: '#60a5fa',
                              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.6)',
                              pointerEvents: 'auto'
                            }}
                          >
                            <span 
                              className="text-base font-black text-white leading-none"
                              style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}
                            >
                              #{categoryNumber}
                            </span>
                          </div>
                          {/* Кубок для топ-3 (общий рейтинг) - абсолютно позиционирован слева от номера */}
                          {trophyPosition && (
                            <div 
                              className={`absolute top-2 z-50 w-11 h-11 flex items-center justify-center rounded-full bg-white/20 backdrop-blur-sm ${trophyPosition === 'gold' ? 'animate-pulse' : ''}`}
                              title={trophyPosition === 'gold' ? '🥇 1 место (золото)' : trophyPosition === 'silver' ? '🥈 2 место (серебро)' : '🥉 3 место (бронза)'}
                              style={{ 
                                filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.8))',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                                left: '60px', // Позиционируем справа от номера
                                pointerEvents: 'auto'
                              }}
                            >
                              {trophyPosition === 'gold' && <span className="text-5xl">🥇</span>}
                              {trophyPosition === 'silver' && <span className="text-5xl">🥈</span>}
                              {trophyPosition === 'bronze' && <span className="text-5xl">🥉</span>}
                            </div>
                          )}
                          
                          {/* Company Badge */}
                          <div className={`absolute ${isTop3 ? 'top-14' : 'top-3'} right-3 z-10`}>
                            <div className={`px-3 py-1.5 rounded-full ${theme.badgeBg} backdrop-blur-sm border ${theme.badgeBorder} shadow-lg`}>
                              <div className="text-xs font-semibold text-white leading-none">{company}</div>
                            </div>
                          </div>
                          
                          {/* Tasks Badge */}
                          <div className={`absolute ${isTop3 ? 'top-24' : 'top-14'} right-3 z-10`}>
                            <div className="px-3 py-2 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 shadow-2xl">
                              <span className="text-xl font-bold text-white leading-none">{tasks}</span>
                              <span className="text-xs text-white/60 ml-1">задач</span>
                            </div>
                          </div>
                          
                          {/* Photo */}
                          <div 
                            className="relative h-48 overflow-hidden"
                            style={{
                              backgroundImage: bg,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              backgroundRepeat: 'no-repeat'
                            }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                            
                            {/* Upload Photo Button */}
                            {user?.role === 'admin' && (
                              <button
                                type="button"
                                onClick={() => triggerUploadPhoto(e.id)}
                                disabled={uploadingPhotoId === e.id}
                                className="absolute bottom-3 right-3 px-3 py-2 rounded-xl bg-black/60 backdrop-blur-md text-white border border-white/20 hover:bg-black/70 disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg"
                                title="Загрузить фото сотрудника"
                              >
                                {uploadingPhotoId === e.id ? (
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Camera className="w-4 h-4" />
                                )}
                                <span className="text-xs font-medium">Фото</span>
                              </button>
                            )}
                          </div>
                          
                          {/* Employee Info */}
                          <div className="p-4">
                            <h3 className="text-sm font-bold text-slate-900 truncate mb-2">{name}</h3>
                            
                            {/* Stats Grid */}
                            <div className="grid grid-cols-3 gap-2">
                              <div className="text-center p-2 rounded-lg bg-gradient-to-br from-slate-50 to-white border border-slate-100">
                                <div className="text-xs text-slate-600 mb-1">Вес (Т)</div>
                                <div className="text-sm font-bold text-slate-900">{weight}</div>
                              </div>
                              
                              <div className="text-center p-2 rounded-lg bg-gradient-to-br from-slate-50 to-white border border-slate-100">
                                <div className="text-xs text-slate-600 mb-1">Шт</div>
                                <div className="text-sm font-bold text-slate-900">{qty}</div>
                              </div>
                              
                              <div className="text-center p-2 rounded-lg bg-gradient-to-br from-slate-50 to-white border border-slate-100">
                                <div className="text-xs text-slate-600 mb-1">СЗ/М</div>
                                <div className="text-sm font-bold text-slate-900">{speed}</div>
                              </div>
                            </div>
                            
                            {/* Breaks */}
                            {e.breaks_total && e.breaks_total !== '00:00' && (
                              <div className="mt-3 pt-3 border-t border-slate-100">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-500">Перерывы:</span>
                                  <span className="font-semibold text-slate-700">{e.breaks_total}</span>
                                </div>
                              </div>
                            )}
                          </div>
                          
                          {/* Hover Overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/0 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
            }).filter(Boolean);
          })()}
        </div>

        {!loading && !error && filtered.length === 0 && (
          <div className="mt-12 text-center">
            <div className="inline-block p-8 rounded-3xl bg-gradient-to-br from-slate-50 to-white border border-slate-200/50 shadow-xl">
              <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-700 mb-2">Нет данных</h3>
              <p className="text-slate-500 max-w-md">
                За выбранный день статистика не найдена. Попробуйте обновить данные или выберите другой день.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}