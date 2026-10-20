import { Link, Outlet, useLocation } from '@cormijs/runtime';
import '../style.css';

export default function Layout() {
  const location = useLocation();
  return <section className="shell" data-history-layout data-path={location.pathname}>
    <header>
      <span className="eyebrow">CORMI · HASH HISTORY</span>
      <h1>hash 路由与查询入口</h1>
      <nav>
        <Link to="/">首页</Link>
        <Link to="/about">关于</Link>
        <Link to="/query?tab=one">查询</Link>
      </nav>
      <p className="location">{location.pathname}{location.search}{location.hash}</p>
    </header>
    <main><Outlet /></main>
  </section>;
}
