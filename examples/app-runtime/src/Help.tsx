import { Link } from 'react-router';
import { usePreferences } from './preferences';

export default function Help() {
  const preferences = usePreferences();
  return <main>
    <h2>运行时添加的路由</h2>
    <p>此页面由 patchClientRoutes 加入，不在 src/pages 中；仍在同一个 Router 和根 Provider 内。</p>
    <p>共享的应用名称：{preferences.title}</p>
    <nav><Link to="/">返回首页</Link></nav>
  </main>;
}
