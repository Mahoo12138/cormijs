import { useLocation } from '@cormijs/runtime';
import { builtinLabel } from '@/labels';
import '../style.css';

export default function Home() {
  const location = useLocation();
  return <main className="shell">
    <span className="eyebrow">CORMI · DEFINE</span>
    <h1>编译期常量与内置别名</h1>
    <p>definePlugin 在开发与构建阶段替换同名标识符；aliasPlugin 的 <code>builtins</code> 让 <code>@</code> 指向 src。</p>
    <p data-define>{[APP_NAME, JSON.stringify(APP_FLAGS), process.env.APP_MODE ?? 'missing'].join(' | ')}</p>
    <p data-builtin>{builtinLabel}</p>
    <p data-runtime>运行时路径 {location.pathname}（来自作用域包 @cormijs/runtime）</p>
  </main>;
}
