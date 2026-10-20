import '../style.css';

interface Marks { __cormiHead?: string; __cormiMark?: string; __cormiBody?: string }
const marks = window as unknown as Marks;

export default function Home() {
  return <main className="shell">
    <span className="eyebrow">CORMI · HTML HEAD</span>
    <h1>配置式页面头部与脚本</h1>
    <p>标题、语言、meta、link 与 favicon 来自 cormi.config.ts 的 htmlPlugin 选项；<code>headScripts</code> 落在 <code>&lt;head&gt;</code> 末尾，<code>scripts</code> 落在 <code>&lt;/body&gt;</code> 之前。</p>
    <p data-scripts={[marks.__cormiHead ?? 'pending', marks.__cormiMark ?? 'pending', marks.__cormiBody ?? 'pending'].join(' / ')}></p>
    <p>index.html 仍归应用所有，插件只做注入与转义。</p>
  </main>;
}
