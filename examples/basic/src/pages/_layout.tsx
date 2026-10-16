import { Link, Outlet } from 'react-router';

export default function Layout() {
  return <><header><Link className="brand" to="/">cormi<span> / development example</span></Link><nav aria-label="主导航"><Link to="/">首页</Link><Link to="/about">关于</Link><Link to="/users/42">动态路由</Link><Link to="/docs/getting-started">文档路径</Link></nav></header><main className="content"><Outlet /></main><footer>Plugins compose the application. The kernel stays small.</footer></>;
}
