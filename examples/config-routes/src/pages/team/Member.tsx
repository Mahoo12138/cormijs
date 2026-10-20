import { Link, useParams } from 'react-router';

export default function Member() {
  const { id } = useParams();
  if (id === 'boom') throw new Error('成员页面主动抛错');
  return <section>
    <h2>成员 {id}</h2>
    <p>动态参数来自配置中的 :id 相对路径。</p>
    <Link to="/team">返回团队</Link>
  </section>;
}
