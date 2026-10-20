import { Link, useRouteError } from 'react-router';

export default function MemberError() {
  const error = useRouteError();
  return <section role="alert">
    <h2>成员路由错误边界</h2>
    <p>{error instanceof Error ? error.message : '未知错误'}</p>
    <Link to="/team">返回团队</Link>
  </section>;
}
