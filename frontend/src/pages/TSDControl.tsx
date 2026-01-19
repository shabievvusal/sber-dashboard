import { useState } from 'react';
import LogoutButton from '../components/LogoutButton';
import TSDIssueForm from '../components/TSDIssueForm';
import TSDReturnForm from '../components/TSDReturnForm';
import TSDLogTable from '../components/TSDLogTable';

type TabType = 'issue' | 'return' | 'log';

export default function TSDControl() {
  const [activeTab, setActiveTab] = useState<TabType>('issue');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSuccess = () => {
    // Обновляем журнал после успешной операции
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <LogoutButton />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Учет ТСД</h1>
          <p className="text-gray-600">Управление выдачей и возвратом терминалов сбора данных</p>
        </div>

        {/* Вкладки */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('issue')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'issue'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Выдать ТСД
            </button>
            <button
              onClick={() => setActiveTab('return')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'return'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Принять ТСД
            </button>
            <button
              onClick={() => setActiveTab('log')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'log'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Журнал операций
            </button>
          </nav>
        </div>

        {/* Контент вкладок */}
        <div className="mt-6">
          {activeTab === 'issue' && (
            <TSDIssueForm key={refreshKey} onSuccess={handleSuccess} />
          )}
          {activeTab === 'return' && (
            <TSDReturnForm key={refreshKey} onSuccess={handleSuccess} />
          )}
          {activeTab === 'log' && (
            <TSDLogTable key={refreshKey} />
          )}
        </div>
      </div>
    </div>
  );
}


