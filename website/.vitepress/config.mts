import { defineConfig } from 'vitepress'

const repoNote = 'cormi 当前以本地 kit 交付，尚未发布到公共 npm。'

export default defineConfig({
  lang: 'zh-CN',
  title: 'cormi',
  titleTemplate: ':title · cormi',
  description: '以 Cordis 为插件宿主、以 React + Vite 为默认体验的 TypeScript 应用框架。',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#0d9488' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'zh_CN' }],
    ['meta', { property: 'og:site_name', content: 'cormi' }],
    ['meta', { property: 'og:title', content: 'cormi — 以插件为骨架的应用框架' }],
    ['meta', { property: 'og:description', content: '用 Cordis 组合插件，用熟悉的路由、数据流与约定构建 React 应用。' }],
    ['meta', { name: 'description', content: 'cormi 是以 Cordis 为插件宿主、以 React + Vite 为默认体验的 TypeScript 应用框架。' }],
  ],
  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
  },
  themeConfig: {
    logo: { src: '/logo.svg', alt: 'cormi' },
    siteTitle: 'cormi',
    nav: [
      { text: '指南', link: '/guide/', activeMatch: '/guide/' },
      { text: '参考', link: '/reference/config', activeMatch: '/reference/' },
      { text: '插件', link: '/plugins/', activeMatch: '/plugins/' },
      {
        text: '更多',
        items: [
          { text: '设计原则', link: '/about/design' },
          { text: '与 Umi 的关系', link: '/about/umi' },
          { text: '路线与状态', link: '/about/roadmap' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: '介绍', link: '/guide/' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '项目结构', link: '/guide/project-structure' },
          ],
        },
        {
          text: '应用开发',
          items: [
            { text: '路由', link: '/guide/routing' },
            { text: '布局', link: '/guide/layout' },
            { text: '菜单与面包屑', link: '/guide/menu' },
            { text: '应用运行时', link: '/guide/app-runtime' },
            { text: '数据流', link: '/guide/data-flow' },
            { text: '请求', link: '/guide/request' },
            { text: '国际化', link: '/guide/i18n' },
            { text: '权限', link: '/guide/access' },
          ],
        },
        {
          text: '工程与交付',
          items: [
            { text: '样式与静态资源', link: '/guide/assets' },
            { text: 'Head 与 SEO', link: '/guide/head' },
            { text: 'Mock、API 与代理', link: '/guide/mock-api' },
            { text: '构建与部署', link: '/guide/build' },
            { text: '生成器', link: '/guide/generators' },
            { text: '微前端', link: '/guide/microfrontend' },
            { text: '生态集成', link: '/guide/integrations' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: '配置', link: '/reference/config' },
            { text: '命令行', link: '/reference/cli' },
            { text: 'Runtime API', link: '/reference/runtime' },
            { text: '包列表', link: '/reference/packages' },
          ],
        },
      ],
      '/plugins/': [
        {
          text: '插件',
          items: [
            { text: '总览', link: '/plugins/' },
            { text: '编写插件', link: '/plugins/authoring' },
          ],
        },
        {
          text: '官方包',
          items: [
            { text: '构建与运行时', link: '/plugins/framework' },
            { text: 'UI 与状态', link: '/plugins/ui' },
            { text: '微前端', link: '/plugins/microfrontend' },
          ],
        },
      ],
      '/about/': [
        {
          text: '更多',
          items: [
            { text: '设计原则', link: '/about/design' },
            { text: '与 Umi 的关系', link: '/about/umi' },
            { text: '路线与状态', link: '/about/roadmap' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清除条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新' },
    skipToContentLabel: '跳转到正文',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '文档目录',
    returnToTopLabel: '回到顶部',
    notFound: {
      title: '页面不存在',
      quote: '这个路径没有对应的文档，可能是链接过期或页面已移动。',
      linkLabel: '回到首页',
      linkText: '回到首页',
    },
    footer: {
      message: `基于 Cordis 构建 · ${repoNote}`,
      copyright: 'cormi 项目文档',
    },
  },
})
