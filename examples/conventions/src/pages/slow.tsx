await new Promise(resolve => setTimeout(resolve, 800));

export default function Slow() {
  return <main>
    <span className="eyebrow">CORMI · LOADING</span>
    <h1>延迟页面已就绪</h1>
    <p>首次路由解析期间显示 <code>src/loading.tsx</code>；本页模块延迟 800ms 完成。</p>
  </main>;
}
