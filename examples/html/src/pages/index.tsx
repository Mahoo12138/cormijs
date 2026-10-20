export default function Home() {
  return <main className="shell">
    <span className="eyebrow">CORMI · HTML HEAD</span>
    <h1>配置式页面头部</h1>
    <p>标题、语言、meta、link 与 favicon 来自 cormi.config.ts 的 htmlPlugin 选项；开发者仍拥有 index.html。</p>
  </main>;
}
