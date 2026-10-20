import { Link, Outlet, useLocation } from 'react-router';
import { useRouteMatches } from '@cormijs/runtime';
import '../style.css';

export default function Shell() {
  const matches = useRouteMatches(), current = matches.at(-1), location = useLocation();
  return <div className="shell">
    <header>
      <span className="eyebrow">CORMI · CONFIG ROUTES</span>
      <h1>配置式嵌套路由</h1>
      <nav>
        <Link to="/">首页</Link>
        <Link to="/about">关于</Link>
        <Link to="/team">团队</Link>
        <Link to="/legacy/alpha">旧链接</Link>
        <Link to="/search?q=alpha#hits">保留查询</Link>
      </nav>
      <p className="route">{current?.id} · {String(current?.meta.title ?? '')}</p>
      <p className="location">{location.pathname}</p>
    </header>
    <main className="content"><Outlet /></main>
    <footer>声明来自 src/app-routes.ts；贡献由 routeConfigPlugin 通过原生 React 路由 hook 提供。</footer>
  </div>;
}
