import { Link, Outlet } from 'react-router';
import { useRouteMatches } from '@cormijs/runtime';
import './style.css';

export default function Layout() {
  const matches = useRouteMatches();
  return <div className="workspace">
    <header><Link className="brand" to="/">cormi <span>/ feature workspace</span></Link><nav aria-label="主导航"><Link to="/">概览</Link><Link to="/status">功能插件</Link></nav></header>
    <main><p className="breadcrumb" data-testid="breadcrumbs">{matches.map(match => String(match.meta.title ?? match.id)).join(' / ')}</p><Outlet /></main>
    <footer>应用选择功能，插件维护实现。内核不绑定 React 或 Vite。</footer>
  </div>;
}
