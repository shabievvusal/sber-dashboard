import { useAuth } from '../contexts/AuthContext';

export default function LogoutButton() {
  const { logout } = useAuth();

  const handleLogout = async () => {
    if (confirm('Вы уверены, что хотите выйти?')) {
      await logout();
    }
  };

  return (
    <button
      onClick={handleLogout}
      className="fixed top-4 right-4 opacity-30 hover:opacity-100 transition-opacity z-50 bg-gray-200 hover:bg-gray-300 rounded-full p-2 shadow-md"
      title="Выход"
    >
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    </button>
  );
}



