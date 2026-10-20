import { Link, useModel } from '@cormijs/runtime';

export default function Other() {
  const count = useModel('counter', (state: { count: number }) => state.count);
  return <main className="shell">
    <span className="eyebrow">CORMI · MODELS</span>
    <h1>导航后的共享状态</h1>
    <p className="value">{count}</p>
    <p>模型 Provider 位于 Router 之上，因此路由切换不会重建模型。</p>
    <nav><Link to="/">返回首页</Link></nav>
  </main>;
}
