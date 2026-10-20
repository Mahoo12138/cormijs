import { defineApp } from '@cormijs/runtime';

function Forbidden() {
  return <main role="status"><h1>无权访问</h1><p>请联系管理员开通权限。</p></main>;
}

export default defineApp({
  async getInitialState() {
    await new Promise(resolve => setTimeout(resolve, 60));
    return { role: 'user' };
  },
  access(state) {
    return { canAdmin: (state as { role?: string } | undefined)?.role === 'admin' };
  },
  accessForbidden: Forbidden,
});
