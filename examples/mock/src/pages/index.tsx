import { useState } from 'react';
import '../style.css';

export default function Home() {
  const [users, setUsers] = useState<string[]>([]), [error, setError] = useState('');
  const load = async () => {
    try {
      const response = await fetch('/api/users');
      if (!response.ok) throw new Error(String(response.status));
      setUsers((await response.json()).users ?? []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return <main className="shell">
    <span className="eyebrow">CORMI · MOCK CONVENTION</span>
    <h1>Mock 目录约定</h1>
    <p>mock/users.ts 默认导出的 METHOD + 路径映射由开发期 DevApiService 提供；修改文件后自动重载，生产预览不提供 Mock。</p>
    <p>开发模式：<code data-dev>{String(import.meta.env.DEV)}</code></p>
    <p>用户：<strong data-users>{users.join(', ')}</strong></p>
    <p>错误：<code data-error>{error || 'none'}</code></p>
    <button onClick={() => void load()}>读取 Mock 用户</button>
  </main>;
}
