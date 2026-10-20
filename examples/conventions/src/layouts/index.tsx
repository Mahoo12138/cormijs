import { Outlet, useLocation } from 'react-router';
import '../style.css';

export default function GlobalLayout() {
  const location = useLocation();
  return <div className="app-shell" data-convention-layout data-convention-path={location.pathname}>
    <aside>全局布局 · src/layouts/index.tsx</aside>
    <Outlet />
  </div>;
}
