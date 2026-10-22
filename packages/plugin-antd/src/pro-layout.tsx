import { ProLayout, type MenuDataItem } from '@ant-design/pro-layout';
import { useMemo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { toLayoutRoutes, useMenu, useMenuCollapse } from '@cormijs/runtime';

export interface ProLayoutShellProps {
  readonly title?: string;
  readonly logo?: ReactNode | string;
  readonly layout?: 'side' | 'top' | 'mix';
  readonly fixedHeader?: boolean;
  readonly siderWidth?: number;
  /** Disabled by default: antd Sider otherwise forces expansion at desktop widths and drops the persisted state. */
  readonly breakpoint?: false | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  readonly children?: ReactNode;
}

/**
 * ProLayout chrome for the application's global layout (`src/layouts/index.*`).
 * Mount menuPlugin and antdPlugin first; this component owns no plugin resources.
 */
export function ProLayoutShell({ title, logo, layout = 'side', fixedHeader = true, siderWidth = 208, breakpoint = false, children }: ProLayoutShellProps) {
  const menu = useMenu();
  const { pathname } = useLocation();
  const { collapsed, setCollapsed } = useMenuCollapse();
  const route = useMemo(() => ({ path: '/', routes: toLayoutRoutes(menu) as unknown as MenuDataItem[] }), [menu]);
  return (
    <ProLayout
      title={title}
      logo={logo}
      layout={layout}
      fixedHeader={fixedHeader}
      siderWidth={siderWidth}
      breakpoint={breakpoint}
      location={{ pathname }}
      route={route}
      collapsed={collapsed}
      onCollapse={value => setCollapsed(value)}
      menuItemRender={(item, dom) => item.path ? <Link to={item.path}>{dom}</Link> : dom}
    >
      {children}
    </ProLayout>
  );
}
