export const OPERATIONS = [
  'Комплектация',
  'Размиксовка',
  'Уборка Холод',
  'Уборка Сухой',
  'Пресс',
  'Уборка Паллет',
  'Отгрузка паллет',
  'Подвоз РК',
  'Замотка РК'
];

export const COMPANIES = ['Мувинг', 'ЭСК', 'Градусы', '2колеса'];

// Дневной график: 10:00 - 21:00
export const DAY_HOURS = Array.from({ length: 12 }, (_, i) => {
  const hour = 10 + i;
  return `${hour.toString().padStart(2, '0')}:00`;
});

// Ночной график: 22:00, 23:00, 00:00, 01:00, ..., 09:00
export const NIGHT_HOURS = [
  ...Array.from({ length: 2 }, (_, i) => {
    const hour = 22 + i;
    return `${hour.toString().padStart(2, '0')}:00`;
  }),
  ...Array.from({ length: 10 }, (_, i) => {
    const hour = i;
    return `${hour.toString().padStart(2, '0')}:00`;
  })
];

// Функция для получения текущего графика часов
export function getCurrentHours(): string[] {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  
  // Если время >= 21:15, используем ночной график
  if (hours > 21 || (hours === 21 && minutes >= 15)) {
    return NIGHT_HOURS;
  }
  
  // Если время >= 9:15, используем дневной график
  if (hours > 9 || (hours === 9 && minutes >= 15)) {
    return DAY_HOURS;
  }
  
  // До 9:15 используем ночной график
  return NIGHT_HOURS;
}

// Для обратной совместимости
export const HOURS = DAY_HOURS;



