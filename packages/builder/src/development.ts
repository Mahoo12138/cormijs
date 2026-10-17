/** Pure development protocol; no Cordis, Node, or backend-specific imports. */
export interface DevelopmentDiagnostic {
  readonly code: string;
  readonly phase: string;
  readonly message: string;
  readonly files: readonly string[];
  readonly pluginId?: string;
  readonly hookId?: string;
}
export interface DevelopmentState {
  readonly revision: number;
  readonly status: 'ready' | 'error';
  /** True only after this compiler session has published a valid application. */
  readonly hasOutput: boolean;
  readonly diagnostic?: DevelopmentDiagnostic;
}
export interface DevelopmentPlan {
  readonly entry: string;
  readonly initial: DevelopmentState;
}
