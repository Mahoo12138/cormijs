import { useNavigate, useSearchParams } from '@cormijs/runtime';

export default function Query() {
  const [params, setParams] = useSearchParams(), navigate = useNavigate();
  return <article>
    <h2>查询</h2>
    <p className="query" data-query>{params.get('tab') ?? ''}|{params.get('q') ?? ''}</p>
    <button onClick={() => setParams({ tab: 'two', q: 'value' })}>更新查询</button>
    <button onClick={() => navigate('/about')}>导航到关于</button>
  </article>;
}
