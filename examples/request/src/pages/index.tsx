import { useRequest } from '@cormijs/runtime';
import '../style.css';

export default function Home() {
  const success = useRequest<{ message: string; source: string }>(
    (client, signal) => client.get('data.json', { signal }),
  );
  const failure = useRequest<{ message: string }>(
    (client, signal) => client.get('missing.json', { signal }),
    { manual: true },
  );
  return <main className="shell">
    <span className="eyebrow">CORMI · REQUEST</span>
    <h1>请求客户端与 useRequest</h1>
    <p className="hint">请求配置来自 src/app.tsx 的 request key；useRequest 自动执行首次请求，并提供 loading、refresh、错误与取消。</p>
    <section className="card">
      <h2>自动请求</h2>
      <p>loading：<code data-loading>{String(success.loading)}</code></p>
      <p>message：<strong data-message>{success.data?.message ?? '(waiting)'}</strong></p>
      <p>error：<code data-error>{success.error ? String(success.error) : 'none'}</code></p>
      <button onClick={() => void success.refresh()}>刷新</button>
    </section>
    <section className="card">
      <h2>手动请求与错误</h2>
      <p>loading：<code data-failure-loading>{String(failure.loading)}</code></p>
      <p>message：<code data-failure-message>{failure.data?.message ?? '(none)'}</code></p>
      <p>error：<code data-failure>{failure.error instanceof Error ? failure.error.message : 'none'}</code></p>
      <button onClick={() => void failure.run()}>请求缺失文件</button>
      <button onClick={failure.cancel}>取消</button>
    </section>
  </main>;
}
