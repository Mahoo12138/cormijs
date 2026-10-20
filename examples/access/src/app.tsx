import { defineApp } from '@cormijs/runtime';

export default defineApp({
  async getInitialState() {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { role: 'admin' };
  },
  access(state) {
    const user = state as { role?: string } | undefined;
    return { canAdmin: user?.role === 'admin', canRead: user !== undefined };
  },
});
