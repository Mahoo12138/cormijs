import { useState } from 'react';
import { usePrefetch } from '@cormijs/runtime';

export default function Home() {
  const { ids, prefetch } = usePrefetch();
  const [result, setResult] = useState('尚未预取');
  return <main>
    <h1>路由预取</h1>
    <p>本示例以 <code>mode: 'idle'</code> 在首屏空闲时预热全部路由；也可用 <code>usePrefetch()</code> 按需加载。</p>
    <p>可预取路由：<code>{ids.join(', ')}</code></p>
    <button onClick={() => { void prefetch('config:guide').then(ok => setResult(ok ? '指南模块已预取' : '未找到模块')); }}>预取指南</button>
    <p data-result>{result}</p>
  </main>;
}
