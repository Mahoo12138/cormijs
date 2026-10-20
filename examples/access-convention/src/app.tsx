import { defineApp } from '@cormijs/runtime';

export default defineApp({
  async getInitialState() {
    await new Promise(resolve => setTimeout(resolve, 80));
    return { role: 'admin' as 'admin' | 'user' };
  },
});
