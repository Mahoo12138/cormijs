import { useInitialState } from '@cormijs/runtime';
import '../style.css';

export default function Home() {
  const { loading, error, data, refresh, setInitialState } = useInitialState<{ user: string; call: number }>();
  return <main className="shell">
    <span className="eyebrow">CORMI · INITIAL STATE</span>
    <h1>启动状态与刷新</h1>
    <p className="hint">getInitialState 在 app.tsx 中声明；状态通过 useInitialState 读取，refresh 重新请求，setInitialState 直接覆盖。</p>
    <section className="card">
      <p>loading：<code data-loading>{String(loading)}</code></p>
      <p>error：<code data-error>{error ? String(error) : 'none'}</code></p>
      <p>user：<strong data-user>{data?.user ?? '(loading)'}</strong></p>
      <p>call：<code data-call>{data?.call ?? 0}</code></p>
    </section>
    <div className="actions">
      <button onClick={() => setInitialState({ user: 'Bob', call: 9 })}>Set Bob</button>
      <button onClick={() => void refresh()}>Refresh</button>
    </div>
  </main>;
}
