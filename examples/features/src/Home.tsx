import { Link } from 'react-router';
export default function Home() {
  return <section><p className="eyebrow">Composable features</p><h1>功能由插件接入。</h1><p>这个应用只声明布局和首页。状态页面、公开元数据与根 Provider 都来自一个可独立启停的功能插件。</p><Link className="action" to="/status">查看插件页面</Link><p className="hint">在 cormi.config.ts 将 status-feature 的 enabled 改为 false，即可移除它贡献的路由和 runtime。</p></section>;
}
