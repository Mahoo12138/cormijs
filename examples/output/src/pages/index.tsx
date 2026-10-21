import '../style.css';

export default function Home() {
  return <main className="shell">
    <span className="eyebrow">CORMI · OUTPUT</span>
    <h1>输出与静态资源策略</h1>
    <p><code>outputPlugin</code> 在构建后把 <code>static/</code> 复制到 <code>dist/extras/</code> 与 <code>dist/robots.txt</code>，并用 <code>hash: false</code> 生成稳定文件名。</p>
    <p>执行 <code>pnpm cormi build --root examples/output</code> 后检查 <code>dist/</code>；开发服务器不执行复制。</p>
  </main>;
}
