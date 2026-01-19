const ANALYZ_BASE_PATH =
  import.meta.env.VITE_ANALYZ_BASE_PATH?.replace(/\/$/, '') || '/integrations/analyz';

function DataAnalytics() {
  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow border border-slate-200 p-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Анализ данных</h1>
          <p className="text-slate-600">
            Ниже загружается полный интерфейс загрузки файлов, календаря и отчётов из Python-приложения
            `Analyz`. Мы показываем его внутри iframe, но запросы идут через backend-прокси, поэтому
            cookie и авторизация остаются в одном домене.
          </p>
        </div>
        <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
          <iframe
            src={ANALYZ_BASE_PATH || '/integrations/analyz'}
            title="Анализ данных"
            className="w-full"
            style={{ minHeight: '85vh' }}
          />
        </div>
      </div>
    </div>
  );
}

export default DataAnalytics;


