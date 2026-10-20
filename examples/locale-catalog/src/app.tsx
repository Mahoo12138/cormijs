import { defineApp } from '@cormijs/runtime';

export default defineApp({
  locale: {
    default: 'en',
    fallback: 'en',
    storageKey: 'example:locale-catalog',
    messages: { en: { title: 'Configured title' } },
  },
});
