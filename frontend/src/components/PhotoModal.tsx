import { useState, useRef } from 'react';
import axios from 'axios';

interface PhotoModalProps {
  task: any;
  photoUrl: string | null;
  onClose: () => void;
  onPhotoUploaded: () => void;
}

export default function PhotoModal({ task, photoUrl, onClose, onPhotoUploaded }: PhotoModalProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !task) return;

    // Проверка размера файла (10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Размер файла не должен превышать 10MB');
      return;
    }

    // Проверка типа файла
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      alert('Разрешены только изображения (JPEG, PNG, GIF)');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);

      const uploadResponse = await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000 // 30 секунд таймаут
      });

      if (!uploadResponse.data?.photo_url) {
        throw new Error('Сервер не вернул URL фото');
      }

      await axios.patch(`/api/tasks/${task.id}/photo`, {
        photo_url: uploadResponse.data.photo_url
      });

      onPhotoUploaded();
      onClose();
    } catch (error: any) {
      console.error('Error uploading photo:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Ошибка при загрузке фото';
      alert(errorMessage);
    } finally {
      setUploading(false);
      // Сброс input для возможности повторной загрузки того же файла
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (photoUrl) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-2xl">
          <h2 className="text-xl font-bold mb-4">Просмотр фото</h2>
          <img
            src={photoUrl}
            alt="Task photo"
            className="max-w-full h-auto rounded"
          />
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600"
          >
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Загрузить фото</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
        >
          {uploading ? 'Загрузка...' : 'Выбрать файл'}
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}





