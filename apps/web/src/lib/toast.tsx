import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react';

interface ToastItem {
  id: number;
  message: string;
}

interface ToastState {
  toast(message: string): void;
}

const ToastContext = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string): void => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fs-toast-host" aria-live="polite" role="status" data-testid="toast-host">
        {items.map((t) => (
          <div key={t.id} className="fs-toast" data-testid="toast-message">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast outside provider');
  }
  return ctx;
}
