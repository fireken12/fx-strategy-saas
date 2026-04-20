import React, { createContext, useCallback, useContext, useState } from "react";

type Variant = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  variant: Variant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: Variant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let nextId = 0;

  const showToast = useCallback((message: string, variant: Variant = "info") => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const variantStyle: Record<Variant, React.CSSProperties> = {
    success: { background: "#22c55e" },
    error: { background: "#ef4444" },
    warning: { background: "#f59e0b" },
    info: { background: "#3b82f6" },
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 8, zIndex: 9999 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: "12px 20px",
              borderRadius: 8,
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
              ...variantStyle[t.variant],
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
