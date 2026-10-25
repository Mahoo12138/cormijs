declare module 'dva-core' {
  export function create(options?: Record<string, unknown>, config?: Record<string, unknown>): {
    model(model: Record<string, unknown>): void;
    start(): void;
    _store: { dispatch(action: unknown): unknown; getState(): unknown; subscribe(listener: () => void): () => void };
  };
}
