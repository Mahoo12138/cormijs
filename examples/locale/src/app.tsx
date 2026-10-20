import { defineApp } from '@cormijs/runtime';

export default defineApp({
  locale: {
    default: 'zh',
    fallback: 'en',
    storageKey: 'cormi-example:locale',
    messages: {
      en: {
        title: 'Locale and messages',
        greeting: 'Hello, {name}',
        switch: '切换到中文',
      },
      zh: {
        title: '语言与消息',
        greeting: '你好，{name}',
        switch: 'Switch to English',
      },
    },
  },
});
