import { Outlet, useLocation, useParams } from 'react-router';

export default function Trace() {
  const params = useParams(), location = useLocation();
  return <section className="wrapper-trace" data-wrapper="trace" data-wrapper-param={String(params.id ?? '')} data-wrapper-search={location.search}>
    <p>wrapper: trace</p>
    <Outlet />
  </section>;
}
