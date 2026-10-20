import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { htmlPlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [{
    id: 'html', plugin: htmlPlugin,
    options: {
      title: 'cormi HTML head',
      lang: 'zh-CN',
      favicon: '/html/favicon.svg',
      metas: [
        { name: 'description', content: '由 htmlPlugin 注入的页面描述' },
        { property: 'og:title', content: 'cormi HTML head' },
      ],
      links: [{ rel: 'canonical', href: '/html/' }],
    },
  }],
  app: { base: '/html/', server: { host: '127.0.0.1', port: 8016 } },
});
