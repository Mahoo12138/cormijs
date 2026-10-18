import type { PropsWithChildren } from 'react';
import type { RuntimePlugin } from '@cormijs/runtime';
import { StatusContext } from './context';

function StatusProvider({ children, options }: PropsWithChildren<{ options: unknown }>) {
  const label = options && typeof options === 'object' && 'label' in options && typeof options.label === 'string' ? options.label : '未配置';
  return <StatusContext.Provider value={label}><div data-status-provider="true">{children}</div></StatusContext.Provider>;
}
export default { Provider: StatusProvider } satisfies RuntimePlugin;
