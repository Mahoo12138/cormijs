import { Link, Outlet, useAccess, useActiveMenuKeys, useBreadcrumb, useInitialState, useMenu, type MenuItem } from '@cormijs/runtime';
import './style.css';

function MenuList({ items, active, level = 0 }: { readonly items: readonly MenuItem[]; readonly active: readonly string[]; readonly level?: number }) {
  return <ul className={`menu level-${level}`}>{items.map(item => <li key={item.key}>
    <Link to={item.path} data-active={active.includes(item.key) ? 'true' : undefined}>{item.title}</Link>
    {item.children.length ? <MenuList items={item.children} active={active} level={level + 1} /> : null}
  </li>)}</ul>;
}

export default function Shell() {
  const initial = useInitialState<{ role: string }>(), access = useAccess(), crumbs = useBreadcrumb(), active = useActiveMenuKeys();
  return <section className="shell">
    <header>
      <span className="eyebrow">CORMI · MENU</span>
      <h1>路由菜单与面包屑</h1>
      <nav data-menu><MenuList items={useMenu()} active={active} /></nav>
      <p className="crumbs" data-crumbs>{crumbs.map(item => item.title).join(' > ')}</p>
      <p className="hint">当前角色：{initial.data?.role ?? '(loading)'} · canAdmin：{String(access.canAdmin)}</p>
      <button data-promote onClick={() => initial.setInitialState({ role: 'admin' })}>升级为管理员</button>
    </header>
    <main><Outlet /></main>
  </section>;
}
