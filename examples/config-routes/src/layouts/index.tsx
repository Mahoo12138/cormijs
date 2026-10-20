import { Outlet, useLocation } from 'react-router';

export default function GlobalLayout() {
  const location = useLocation();
  return <div className="global-layout" data-global-layout data-global-path={location.pathname}>
    <aside>全局布局 · src/layouts/index.tsx</aside>
    <Outlet />
  </div>;
}
