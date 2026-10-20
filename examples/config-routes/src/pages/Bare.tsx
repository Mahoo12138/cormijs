export default function Bare() {
  return <main className="bare">
    <span className="eyebrow">CORMI · LAYOUT OPT-OUT</span>
    <h1>无全局布局</h1>
    <p>该顶层路由声明了 <code>layout: false</code>，因此不经过 src/layouts/index.tsx。</p>
  </main>;
}
