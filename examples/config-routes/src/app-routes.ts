import type { ConfigRoute } from '@cormijs/plugin-react';

export const routes: readonly ConfigRoute[] = [{
  path: 'bare', component: './src/pages/Bare.tsx', layout: false,
}, {
  id: 'shell', path: '/', component: './src/layouts/Shell.tsx', routes: [
    { index: true, component: './src/pages/Home.tsx', meta: { title: '首页' } },
    { path: 'about', component: './src/pages/About.tsx', meta: { title: '关于' }, wrappers: ['./src/wrappers/Trace.tsx', './src/wrappers/Gate.tsx'] },
    { path: 'legacy/:id', redirect: '/team/:id' },
    { path: 'search', redirect: '/about', keepQuery: true },
    { id: 'team', path: 'team', component: './src/pages/team/TeamLayout.tsx', routes: [
      { index: true, component: './src/pages/team/TeamIndex.tsx', meta: { title: '团队' } },
      { path: ':id', component: './src/pages/team/Member.tsx', errorBoundary: './src/pages/team/MemberError.tsx', wrappers: ['./src/wrappers/Trace.tsx'], meta: { title: '成员' } },
    ] },
  ],
}];
