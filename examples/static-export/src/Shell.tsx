import { Link, Outlet } from '@cormijs/runtime';
import './style.css';

export default function Shell() {
  return <section className="shell">
    <header>
      <span className="eyebrow">CORMI · STATIC EXPORT</span>
      <nav><Link to="/">首页</Link><Link to="/guide">指南</Link></nav>
    </header>
    <Outlet />
  </section>;
}
