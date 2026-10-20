export default function Home() {
  return <main className="shell">
    <span className="eyebrow">CORMI · GLOBAL STYLE</span>
    <h1>全局样式约定</h1>
    <p>生成入口自动导入 <code>src/global.css</code>；页面组件仍各自导入自己的样式或 CSS Module。</p>
    <p data-global-band>这条色带来自 src/global.css</p>
  </main>;
}
