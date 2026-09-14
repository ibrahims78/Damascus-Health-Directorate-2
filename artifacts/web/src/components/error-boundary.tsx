import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * يمنع "الشاشة الصامتة": إن انهار أي مكوّن أثناء العرض تظهر رسالة واضحة
 * مع زر إعادة تحميل بدلاً من اختفاء الواجهة بدون أي إشعار.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6" dir="rtl">
          <div className="max-w-md w-full bg-card border rounded-xl shadow-xl p-6 text-center space-y-4">
            <div className="text-4xl" aria-hidden="true">⚠️</div>
            <h1 className="text-xl font-bold">حدث خطأ غير متوقع</h1>
            <p className="text-sm text-muted-foreground">
              توقف عرض الواجهة بسبب خطأ داخلي. أعد تحميل الصفحة، وإذا تكررت المشكلة أعد تشغيل التطبيق.
            </p>
            <pre className="text-xs text-muted-foreground bg-muted border rounded p-2 overflow-auto max-h-24 text-start whitespace-pre-wrap">
              {error.message || String(error)}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
