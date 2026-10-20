import { FormattedMessage, useIntl } from '@cormijs/runtime';
import '../style.css';

export default function Home() {
  const { locale, setLocale, t } = useIntl();
  return <main className="shell">
    <span className="eyebrow">CORMI · LOCALE</span>
    <h1>{t('title')}</h1>
    <p className="hint">消息来自 src/app.tsx 的 locale 配置；切换语言会持久化到 localStorage，刷新后保留。</p>
    <section className="card">
      <p>locale：<code data-locale>{locale}</code></p>
      <p><strong data-greeting>{t('greeting', { name: 'Ada' })}</strong></p>
      <p data-formatted><FormattedMessage id="greeting" values={{ name: 'Grace' }} /></p>
      <p data-missing>{t('missing.key')}</p>
      <button onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>{t('switch')}</button>
    </section>
  </main>;
}
