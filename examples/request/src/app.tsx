import { defineApp } from '@cormijs/runtime';

export default defineApp({
  request: {
    baseURL: '/request/',
    headers: { 'x-application': 'cormi-example' },
    timeout: 5000,
  },
});
