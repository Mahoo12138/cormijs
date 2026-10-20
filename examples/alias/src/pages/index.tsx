import { greeting, sharedMessage } from '@shared/message';
import '../style.css';

export default function Home() {
  return <main className="shell">
    <span className="eyebrow">CORMI · ALIAS</span>
    <h1>路径别名</h1>
    <p>aliasPlugin 将 `@` 与 `@shared` 映射到 src 目录；TypeScript 侧通过 tsconfig paths 对齐。</p>
    <p data-alias>{sharedMessage}</p>
    <p>{greeting('Ada')}</p>
  </main>;
}
