import { useContext, useState } from 'react';
import { useRouteMatches } from '@cormijs/runtime';
import { StatusContext } from './context';

export default function StatusPage() {
  const label = useContext(StatusContext), [count, setCount] = useState(0);
  const current = useRouteMatches().at(-1);
  return <section><p className="eyebrow">Plugin-owned page</p><h1>插件已经接入。</h1>
    <p>页面、根 Provider 与路由元数据来自同一个功能插件，而不是应用复制的模板。</p>
    <dl><dt>应用设置</dt><dd data-testid="feature-label">{label}</dd><dt>路由 ID</dt><dd>{current?.id}</dd><dt>路由元数据</dt><dd data-testid="feature-title">{String(current?.meta.title)}</dd></dl>
    <button onClick={() => setCount(value => value + 1)}>Count: {count}</button><p className="hint">修改这个页面的组件文案，可以验证 Fast Refresh；停用 Node 插件则使用配置重启。</p>
  </section>;
}
