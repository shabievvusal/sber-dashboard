const ANALYZ_BASE_PATH =
  import.meta.env.VITE_ANALYZ_BASE_PATH?.replace(/\/$/, '') || '/integrations/analyz';

function BarcodeGenerator() {
  const iframeSrc = `${ANALYZ_BASE_PATH}/barcode`;

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow border border-slate-200 p-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Генерация и печать штрихкодов
          </h1>
          <p className="text-slate-600">
            Ниже встроен готовый инструмент из каталога `Analyz`. Он загружается через защищённый
            прокси `/integrations/analyz`, поэтому остаётся в рамках одного домена.
          </p>
        </div>
        <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
          <iframe
            src={iframeSrc}
            title="ШК Генератор"
            className="w-full"
            style={{ minHeight: '80vh' }}
          />
        </div>
      </div>
    </div>
  );
}

export default BarcodeGenerator;


