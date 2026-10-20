import { FormattedMessage, useIntl } from '@cormijs/runtime';
import '../style.css';

export default function Home() {
  const { locale, setLocale, t } = useIntl();
  return <main className="shell">
    <span className="eyebrow">CORMI · LOCALE CATALOG</span>
    <h1 data-title>{t('title')}</h1>
    <p>消息目录来自 <code>src/locales/&lt;locale&gt;.json</code>；<code>app.tsx</code> 中同名 key 仍然优先。</p>
    <p data-locale>{locale}</p>
    <p data-greeting><FormattedMessage id="greeting" values={{ name: 'Ada' }} /></p>
    <p data-catalog>{t('fromCatalog')}</p>
    <button data-switch onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}>切换语言</button>
  </main>;
}
