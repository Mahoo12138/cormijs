import { Outlet } from 'react-router';

export default function Gate() {
  return <section className="wrapper-gate" data-wrapper="gate">
    <p>wrapper: gate</p>
    <Outlet />
  </section>;
}
