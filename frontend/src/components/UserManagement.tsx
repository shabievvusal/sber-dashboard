import { useState, useEffect } from 'react';
import axios from 'axios';

interface User {
  id: number;
  username: string;
  role: 'admin' | 'operator' | 'manager';
  company_id: number | null;
}

interface Company {
  id: number;
  name: string;
  is_active?: number;
}

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    role: 'manager' as 'admin' | 'operator' | 'manager',
    company_id: null as number | null
  });
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [showModulesModal, setShowModulesModal] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState<User | null>(null);
  const [operatorModules, setOperatorModules] = useState<Array<{ id: string; visible: boolean }>>([]);

  useEffect(() => {
    loadUsers();
    loadCompanies();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await axios.get('/api/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadCompanies = async () => {
    try {
      const response = await axios.get('/api/companies');
      setCompanies(response.data);
    } catch (error) {
      console.error('Error loading companies:', error);
    }
  };

  const handleCreate = () => {
    setEditingUser(null);
    setFormData({
      username: '',
      password: '',
      role: 'manager',
      company_id: null
    });
    setShowCreateCompany(false);
    setNewCompanyName('');
    setShowCreateModal(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '',
      role: user.role,
      company_id: user.company_id
    });
    setShowCreateCompany(false);
    setNewCompanyName('');
    setShowCreateModal(true);
  };

  const handleDelete = async (userId: number) => {
    if (!confirm('Вы уверены, что хотите удалить этого пользователя?')) return;

    try {
      await axios.delete(`/api/users/${userId}`);
      loadUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Ошибка при удалении пользователя');
    }
  };

  const handleCreateCompany = async () => {
    if (!newCompanyName.trim()) {
      alert('Введите название компании');
      return;
    }
    try {
      const response = await axios.post('/api/companies', {
        name: newCompanyName.trim()
      });
      await loadCompanies();
      setFormData({ ...formData, company_id: response.data.id });
      setNewCompanyName('');
      setShowCreateCompany(false);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Ошибка при создании компании');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await axios.put(`/api/users/${editingUser.id}`, formData);
      } else {
        await axios.post('/api/users', formData);
      }
      setShowCreateModal(false);
      setShowCreateCompany(false);
      setNewCompanyName('');
      loadUsers();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Ошибка при сохранении пользователя');
    }
  };

  const getCompanyName = (companyId: number | null) => {
    if (!companyId) return '-';
    const company = companies.find(c => c.id === companyId);
    return company?.name || '-';
  };

  const handleToggleCompanyActive = async (company: Company) => {
    const makeActive = !company.is_active || company.is_active === 0 ? 1 : 0;
    const actionText = makeActive ? 'показать' : 'скрыть';

    if (!confirm(`Вы уверены, что хотите ${actionText} компанию "${company.name}"?`)) return;

    try {
      await axios.patch(`/api/companies/${company.id}/active`, {
        is_active: makeActive,
      });
      await loadCompanies();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Ошибка при изменении компании');
    }
  };

  const handleManageModules = async (user: User) => {
    setSelectedOperator(user);
    try {
      const response = await axios.get(`/api/users/${user.id}/modules`);
      setOperatorModules(response.data.modules || []);
      setShowModulesModal(true);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Ошибка при загрузке настроек модулей');
    }
  };

  const handleToggleModule = (moduleId: string) => {
    setOperatorModules(prev => 
      prev.map(m => m.id === moduleId ? { ...m, visible: !m.visible } : m)
    );
  };

  const handleSaveModules = async () => {
    if (!selectedOperator) return;
    
    try {
      await axios.put(`/api/users/${selectedOperator.id}/modules`, {
        modules: operatorModules
      });
      setShowModulesModal(false);
      setSelectedOperator(null);
      alert('Настройки модулей сохранены');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Ошибка при сохранении настроек модулей');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Управление пользователями</h2>
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Создать пользователя
        </button>
      </div>
      <div className="bg-white rounded-lg shadow overflow-x-auto mb-8">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold">ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Логин</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Роль</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Компания</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map(user => (
              <tr key={user.id}>
                <td className="px-4 py-3 text-sm">{user.id}</td>
                <td className="px-4 py-3 text-sm">{user.username}</td>
                <td className="px-4 py-3 text-sm">{user.role}</td>
                <td className="px-4 py-3 text-sm">{getCompanyName(user.company_id)}</td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(user)}
                      className="text-blue-500 hover:text-blue-700"
                    >
                      Редактировать
                    </button>
                    {user.role === 'operator' && (
                      <button
                        onClick={() => handleManageModules(user)}
                        className="text-green-500 hover:text-green-700"
                      >
                        Модули
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      Удалить
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Управление компаниями */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-bold mb-4">Компании</h3>
        {companies.length === 0 ? (
          <div className="text-gray-500 text-sm">Компаний пока нет</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {companies.map(company => (
              <div key={company.id} className="flex items-center gap-1">
                <button
                  className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                  type="button"
                  title={company.name}
                >
                  {company.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleCompanyActive(company)}
                  className={`px-2 py-1 rounded text-xs ${
                    company.is_active === 0
                      ? 'bg-gray-300 text-gray-700'
                      : 'bg-green-500 text-white'
                  }`}
                  title={company.is_active === 0 ? 'Показать компанию' : 'Скрыть компанию'}
                >
                  {company.is_active === 0 ? '👁️‍🗨️' : '👁️'}
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500 mt-2">
          Скрытая компания автоматически исчезает из сводной таблицы и блоков с информацией по смене.
        </p>
      </div>
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingUser ? 'Редактировать пользователя' : 'Создать пользователя'}
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Логин
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Пароль {editingUser && '(оставьте пустым, чтобы не менять)'}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  required={!editingUser}
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Роль
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="admin">Администратор</option>
                  <option value="operator">Оператор</option>
                  <option value="manager">Менеджер</option>
                </select>
              </div>
              {formData.role === 'manager' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Компания
                  </label>
                  <select
                    value={showCreateCompany ? 'create_new' : (formData.company_id || '')}
                    onChange={(e) => {
                      if (e.target.value === 'create_new') {
                        setShowCreateCompany(true);
                        setFormData({ ...formData, company_id: null });
                      } else {
                        setShowCreateCompany(false);
                        setFormData({ ...formData, company_id: parseInt(e.target.value) || null });
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">Выберите компанию</option>
                    {companies.map(company => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                    <option value="create_new">Создать компанию</option>
                  </select>
                  {showCreateCompany && (
                    <div className="mt-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Название новой компании
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newCompanyName}
                          onChange={(e) => setNewCompanyName(e.target.value)}
                          placeholder="Введите название компании"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={handleCreateCompany}
                          className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                        >
                          Создать
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  {editingUser ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модальное окно управления модулями оператора */}
      {showModulesModal && selectedOperator && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              Управление модулями: {selectedOperator.username}
            </h2>
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-4">
                Выберите модули, которые будут видны оператору:
              </p>
              <div className="space-y-2">
                {operatorModules.map((module) => (
                  <label
                    key={module.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100"
                  >
                    <span className="font-medium">
                      {module.id === 'summary' && 'Сводная таблица'}
                      {module.id === 'analyz' && 'Аналитика (ТСД)'}
                      {module.id === 'reports' && 'Отчеты'}
                      {module.id === 'serviceNote' && 'Составление Служебных Записок'}
                    </span>
                    <input
                      type="checkbox"
                      checked={module.visible}
                      onChange={() => handleToggleModule(module.id)}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowModulesModal(false);
                  setSelectedOperator(null);
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSaveModules}
                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



