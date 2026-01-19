import { useMemo, forwardRef } from 'react';

interface BarcodeIframeProps {
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

const BarcodeIframe = forwardRef<HTMLIFrameElement, BarcodeIframeProps>(({ 
  compact = false, 
  className = "w-full", 
  style,
  title = "Генерация штрихкодов"
}, ref) => {
  // Определяем URL для iframe
  // Сначала пробуем через прокси, если не работает - используем прямой доступ
  const iframeSrc = useMemo(() => {
    // Если мы на сервере (не localhost), используем прямой доступ к Analyz
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    
    if (isLocalhost) {
      // Локально используем прокси
      return `/integrations/analyz/barcode${compact ? '?compact=1' : ''}`;
    } else {
      // На сервере используем прямой доступ к Analyz
      const protocol = window.location.protocol;
      // Для Analyz используем порт 5050
      return `${protocol}//${hostname}:5050/barcode${compact ? '?compact=1' : ''}`;
    }
  }, [compact]);

  const defaultStyle: React.CSSProperties = {
    border: '0',
    ...style
  };

  return (
    <iframe
      ref={ref}
      src={iframeSrc}
      title={title}
      className={className}
      style={defaultStyle}
      scrolling="no"
    />
  );
});

BarcodeIframe.displayName = 'BarcodeIframe';

export default BarcodeIframe;

