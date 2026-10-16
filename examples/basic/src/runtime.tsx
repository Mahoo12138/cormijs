import type { RuntimePlugin } from '@cormijs/runtime';
import type { PropsWithChildren } from 'react';
import './style.css';

function ExampleProvider({ children }: PropsWithChildren<{ options: unknown }>) {
  return <div className="workspace" data-provider="example">{children}</div>;
}
export default { Provider: ExampleProvider } satisfies RuntimePlugin;
