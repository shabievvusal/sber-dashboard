import { Link } from 'react-router-dom';

function StartPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="max-w-3xl w-full px-4 py-10">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Добро пожаловать в систему
          </h1>
          <p className="text-slate-600">
            Выберите, что вы хотите сделать: сгенерировать штрихкоды, проанализировать данные
            или войти в систему.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link
            to="/barcodes"
            className="group rounded-xl bg-white shadow hover:shadow-lg transition-shadow border border-slate-200 p-6 flex flex-col"
          >
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-slate-900 mb-2">
                Генерация штрихкодов
              </h2>
              <p className="text-sm text-slate-600">
                Перейти к инструменту печати и генерации штрихкодов.
              </p>
            </div>
            <span className="mt-4 text-sm font-medium text-blue-600 group-hover:text-blue-700">
              Открыть &rarr;
            </span>
          </Link>

          <Link
            to="/analytics"
            className="group rounded-xl bg-white shadow hover:shadow-lg transition-shadow border border-slate-200 p-6 flex flex-col"
          >
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-slate-900 mb-2">
                Анализ данных
              </h2>
              <p className="text-sm text-slate-600">
                Перейти к модулю анализа и визуализации производственных данных.
              </p>
            </div>
            <span className="mt-4 text-sm font-medium text-blue-600 group-hover:text-blue-700">
              Открыть &rarr;
            </span>
          </Link>

          <Link
            to="/tsd-control"
            className="group rounded-xl bg-white shadow hover:shadow-lg transition-shadow border border-slate-200 p-6 flex flex-col"
          >
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-slate-900 mb-2">
                Учет ТСД
              </h2>
              <p className="text-sm text-slate-600">
                Управление выдачей и возвратом терминалов сбора данных.
              </p>
            </div>
            <span className="mt-4 text-sm font-medium text-blue-600 group-hover:text-blue-700">
              Открыть &rarr;
            </span>
          </Link>

          <Link
            to="/login"
            className="group rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors text-white p-6 flex flex-col"
          >
            <div className="flex-1">
              <h2 className="text-xl font-semibold mb-2">Авторизация</h2>
              <p className="text-sm text-slate-200">
                Войти в систему для работы с операциями и задачами.
              </p>
            </div>
            <span className="mt-4 text-sm font-medium text-slate-100 group-hover:text-white">
              Войти &rarr;
            </span>
          </Link>

          <Link
            to="/showstats"
            className="group rounded-xl bg-white shadow hover:shadow-lg transition-shadow border border-slate-200 p-6 flex flex-col"
          >
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-slate-900 mb-2">
                Статистика сотрудников
              </h2>
              <p className="text-sm text-slate-600">
                Карточки сотрудников: задачи, вес, штук, скорость и перерывы за сегодня.
              </p>
            </div>
            <span className="mt-4 text-sm font-medium text-blue-600 group-hover:text-blue-700">
              Открыть &rarr;
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default StartPage;


