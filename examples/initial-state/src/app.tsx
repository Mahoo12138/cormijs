import { defineApp } from '@cormijs/runtime';

let calls = 0;
export default defineApp({
  async getInitialState() {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 400));
    return { user: calls === 1 ? 'Ada' : 'Grace', call: calls };
  },
});
