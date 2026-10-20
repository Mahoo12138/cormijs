import { Access, useAccess, useInitialState } from '@cormijs/runtime';
import '../style.css';

export default function Home() {
  const access = useAccess(), initial = useInitialState<{ role: string }>();
  return <main className="shell">
    <span className="eyebrow">CORMI · ACCESS</span>
    <h1>权限与初始状态</h1>
    <p className="hint">access 函数读取 getInitialState 的结果；setInitialState 改变角色后，useAccess 与 Access 立即重新计算。</p>
    <section className="card">
      <p>role：<code data-role>{initial.data?.role ?? '(loading)'}</code></p>
      <p>canAdmin：<code data-can-admin>{String(access.canAdmin)}</code></p>
      <p>canRead：<code data-can-read>{String(access.canRead)}</code></p>
    </section>
    <Access accessible={access.canAdmin} fallback={<p className="fallback" data-fallback>当前用户不是管理员</p>}>
      <section className="admin" data-admin-only>管理员面板：只有 canAdmin 为 true 时渲染。</section>
    </Access>
    <div className="actions">
      <button onClick={() => initial.setInitialState({ role: 'user' })}>降级为 user</button>
      <button onClick={() => initial.setInitialState({ role: 'admin' })}>升级为 admin</button>
    </div>
  </main>;
}
