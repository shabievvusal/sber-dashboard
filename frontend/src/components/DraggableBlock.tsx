import { useDrag, useDrop } from 'react-dnd';

interface DraggableBlockProps {
  id: string;
  children: React.ReactNode;
  index: number;
  moveBlock: (dragIndex: number, hoverIndex: number) => void;
  isVisible: boolean;
  onToggleVisibility: (id: string) => void;
  canToggle?: boolean; // Может ли пользователь переключать видимость
}

export default function DraggableBlock({
  id,
  children,
  index,
  moveBlock,
  isVisible,
  onToggleVisibility,
  canToggle = true
}: DraggableBlockProps) {
  const [{ isDragging }, drag] = useDrag({
    type: 'block',
    item: { id, index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  });

  const [, drop] = useDrop({
    accept: 'block',
    hover: (draggedItem: { id: string; index: number }) => {
      if (draggedItem.index !== index) {
        moveBlock(draggedItem.index, index);
        draggedItem.index = index;
      }
    }
  });

  const opacity = isDragging ? 0.5 : 1;

  return (
    <div
      ref={canToggle ? (node) => drag(drop(node)) : undefined}
      style={{ opacity }}
      className={`mb-4 bg-white rounded-lg shadow p-4 border-2 border-dashed border-gray-300 ${
        canToggle ? 'hover:border-blue-500 cursor-move' : 'border-gray-200'
      }`}
    >
      {canToggle && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-500">Перетащите для изменения порядка</span>
          <button
            onClick={() => onToggleVisibility(id)}
            className="text-gray-500 hover:text-gray-700"
            title={isVisible ? 'Скрыть' : 'Показать'}
          >
            {isVisible ? '👁️' : '👁️‍🗨️'}
          </button>
        </div>
      )}
      {isVisible && <div>{children}</div>}
    </div>
  );
}





