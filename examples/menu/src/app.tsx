import { defineApp } from '@cormijs/runtime';

export default defineApp({
  async getInitialState() {
    await new Promise(resolve => setTimeout(resolve, 60));
    return { role: 'user' };
  },
  access(state) {
    return { canAdmin: (state as { role?: string } | undefined)?.role === 'admin' };
  },
});
