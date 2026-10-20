import { Link, useModel } from '@cormijs/runtime';
import '../style.css';

function CounterPanel() {
  const { count, increment } = useModel<{ count: number; increment: () => void }>('counter');
  return <section className="card" data-counter>
    <h2>counter 模型</h2>
    <p className="value">{count}</p>
    <button onClick={increment}>增加</button>
  </section>;
}

function SelectedCount() {
  const count = useModel('counter', (state: { count: number }) => state.count);
  return <p className="selected">selector 读取：{count}</p>;
}

function UserPanel() {
  const { name, rename } = useModel<{ name: string; rename: (value: string) => void }>('user');
  return <section className="card" data-user>
    <h2>user 模型</h2>
    <p className="value">{name}</p>
    <button onClick={() => rename('Grace')}>重命名</button>
  </section>;
}

export default function Home() {
  const count = useModel('counter', (state: { count: number }) => state.count);
  return <main className="shell">
    <span className="eyebrow">CORMI · MODELS</span>
    <h1>共享模型与 useModel</h1>
    <p className="hint">两个面板读取同一个 counter；导航到下一页后状态仍保留，刷新页面重新创建。</p>
    <div className="grid"><CounterPanel /><UserPanel /></div>
    <SelectedCount />
    <nav><Link to="/other">查看共享状态</Link></nav>
    <p className="route">当前计数：{count}</p>
  </main>;
}
