import { useState } from 'react';

export default function Home() {
  const [count, setCount] = useState(0);
  return <section><p className="eyebrow">P1b · React application</p><h1>cormi is running.</h1><p>页面由约定式路由发现，入口由 React 插件生成，构建由可替换的 Vite 插件执行。</p><button onClick={() => setCount(value => value + 1)}>Count: {count}</button><p className="hint">修改此组件，检查热更新是否保留计数；添加 src/pages 下的新文件，检查路由是否重新生成。</p></section>;
}
