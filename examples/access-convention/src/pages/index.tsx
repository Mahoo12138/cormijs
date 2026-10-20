import { Access, useAccess, useInitialState } from '@cormijs/runtime';
import '../style.css';

export default function Home() {
  const access = useAccess(), initial = useInitialState<{ role: string }>();
  return <main className="shell">
    <span className="eyebrow">CORMI · ACCESS CONVENTION</span>
    <h1>src/access.ts 约定</h1>
    <p>权限函数来自约定文件而不是 app.tsx；app.tsx 若显式提供 <code>access</code> 仍然优先。</p>
    <p data-role>{initial.data?.role ?? '(loading)'}</p>
    <Access accessible={Boolean(access.canAdmin)} fallback={<p data-fallback>非管理员不可见</p>}><p data-admin-only>管理面板</p></Access>
    <div className="actions">
      <button onClick={() => initial.setInitialState({ role: 'user' })}>降为普通用户</button>
      <button onClick={() => initial.setInitialState({ role: 'admin' })}>恢复管理员</button>
    </div>
  </main>;
}
