import { Link, Outlet, useAppData } from 'cormi'
import './index.css'

export default function Layout() {
  const { routes } = useAppData()
  return (
    <div className="layout">
      <nav>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
        <Link to="/users">Users</Link>
        <span className="count">{Object.keys(routes).length} routes</span>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
