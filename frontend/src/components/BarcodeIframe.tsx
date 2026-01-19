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
  // Всегда используем прокси через backend для единообразия и безопасности
  const iframeSrc = useMemo(() => {
    return `/integrations/analyz/barcode${compact ? '?compact=1' : ''}`;
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

