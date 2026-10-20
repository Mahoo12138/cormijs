import { useState } from 'react';
import { Link } from 'react-router';
import { usePreferences } from '../preferences';

export default function Home() {
  const [count, setCount] = useState(0);
  const preferences = usePreferences();
  return <main>
    <h2>应用已经准备就绪</h2>
    <p>这份页面通过 Context 读取首屏渲染前加载的配置：<strong>{preferences.title}</strong>。</p>
    <button onClick={() => setCount(value => value + 1)}>计数：{count}</button>
    <nav><Link to="/help?from=home">进入动态加入的帮助页</Link></nav>
    <p className="note">点击导航或使用浏览器后退，标签页标题会显示本次路由事件的 action 和路径。</p>
  </main>;
}
