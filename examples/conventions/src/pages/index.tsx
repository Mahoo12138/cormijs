import { Link } from 'react-router';

export default function Home() {
  return <main>
    <span className="eyebrow">CORMI · APPLICATION CONVENTIONS</span>
    <h1>约定式 404 与 loading</h1>
    <p>全局布局来自 <code>src/layouts/index.tsx</code>，未知路径来自 <code>src/pages/404.tsx</code>。</p>
    <nav><Link to="/slow">打开延迟页面</Link><Link to="/missing">打开未知路径</Link></nav>
  </main>;
}
