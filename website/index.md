---
layout: home
pageClass: home
title: cormi
titleTemplate: false
hero:
  name: cormi
  text: 以插件为骨架的应用框架
  tagline: 用 Cordis 组合插件，用熟悉的路由、数据流与约定构建 React 应用。默认 React + Vite 由 preset 提供，core 不绑定任何渲染器。
  image:
    src: /hero.svg
    alt: cormi 应用由 Cordis 插件组合而成
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 为什么是 cormi
      link: /guide/
features:
  - icon:
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M9.8 9.8 6.4 6.4M14.2 9.8l3.4-3.4M9.8 14.2l-3.4 3.4M14.2 14.2l3.4 3.4"/></svg>'
    title: 原生 Cordis 插件
    details: 使用 Context、Service、Fiber 与 effect，不另建一套插件生命周期。能力可组合、可替换、可撤回。
  - icon:
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h6a4 4 0 0 1 4 4v8"/><path d="M7 5v9a3 3 0 0 0 3 3h7"/></svg>'
    title: 熟悉的路由体验
    details: 约定式页面与配置式嵌套路由并存，覆盖布局、重定向、wrappers、404、loader 与预取。
  - icon:
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg>'
    title: 数据流与请求
    details: Hook 模型、对象模型、初始状态、useRequest 的重试、轮询、分页与缓存，按需启用。
  - icon:
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="m7 9 3 3-3 3M12.5 15H17"/></svg>'
    title: 工程能力开箱
    details: TypeScript、Mock、API 路由、代理、别名、编译期常量、生成器与环境文件，保持同一套约定。
  - icon:
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>'
    title: 应用级能力
    details: locale 与 ICU 消息、access 路由守卫、菜单与面包屑、head 与 SEO、pageview 分析。
  - icon:
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5"/><path d="m4 16.5 8 4.5 8-4.5"/></svg>'
    title: 多种交付形态
    details: 单页应用、静态导出、预渲染、SSR、MPA、独立 serve，以及 qiankun 与 Module Federation。
---

<section class="home-section home-section--tight">
  <div class="home-split">
    <div>
      <p class="home-eyebrow">Composition</p>
      <h2 class="home-title">组合，而不是堆叠</h2>
      <p class="home-copy">
        preset 只是一份普通的 Cordis 插件清单。React、Vite、路由和类型检查各自声明
        <code>inject</code>，由 Context 组合；停用或替换某个提供者时，消费者不会依赖内核特判。
      </p>
      <ul class="home-checks">
        <li>默认 preset 可读、可审阅，也可以在配置里逐项替换</li>
        <li>只有浏览器生命周期的包不引入 Node 构建逻辑</li>
        <li>插件卸载时撤回路由、运行时与生成贡献</li>
      </ul>
    </div>
    <div class="home-file" aria-label="cormi preset 插件组成">
      <div class="home-file__bar"><span></span><span></span><span></span><code>@cormijs/preset-react-vite</code></div>
      <pre class="home-file__body"><code><span class="tok-key">preset</span> react-vite
<span class="tok-dim">├─</span> application-config   <span class="tok-muted">配置校验</span>
<span class="tok-dim">├─</span> web                  <span class="tok-muted">命令与生成队列</span>
<span class="tok-dim">├─</span> application-commands <span class="tok-muted">dev / build / preview</span>
<span class="tok-dim">├─</span> react                <span class="tok-muted">路由与运行时贡献</span>
<span class="tok-dim">├─</span> vite                 <span class="tok-muted">构建 provider</span>
<span class="tok-dim">├─</span> react-vite           <span class="tok-muted">客户端边界</span>
<span class="tok-dim">├─</span> inspect              <span class="tok-muted">生成结果快照</span>
<span class="tok-dim">└─</span> typescript           <span class="tok-muted">应用类型检查</span></code></pre>
    </div>
  </div>
</section>

<section class="home-section">
  <p class="home-eyebrow">Developer experience</p>
  <h2 class="home-title">为长期维护而设计</h2>
  <p class="home-copy">
    cormi 不隐藏构建器，也不假装一切都是热更新。每条捷径都有清晰的归属、失败边界和恢复方式。
  </p>
  <div class="home-cards">
    <div class="home-card">
      <span class="home-card__index">01 · TYPES</span>
      <h3 class="home-card__title">TypeScript 贯穿生成物</h3>
      <p class="home-card__copy">路由、loader 数据、locale key 与样式资源都有生成类型，业务代码不必退回到字符串约定。</p>
      <a class="home-card__link" href="/guide/project-structure">了解生成目录 →</a>
    </div>
    <div class="home-card">
      <span class="home-card__index">02 · LOOP</span>
      <h3 class="home-card__title">快而诚实的开发循环</h3>
      <p class="home-card__copy">组件修改交给 Fast Refresh；配置和 Node 插件变更重启 worker，并保留旧服务直到新代就绪。</p>
      <a class="home-card__link" href="/guide/getting-started">查看日常命令 →</a>
    </div>
    <div class="home-card">
      <span class="home-card__index">03 · OUTPUT</span>
      <h3 class="home-card__title">失败不覆盖有效产物</h3>
      <p class="home-card__copy">构建先写 staging，失败保留上一份成功结果；受管产物有归属检查，不会被静默清空。</p>
      <a class="home-card__link" href="/guide/build">阅读构建契约 →</a>
    </div>
  </div>
</section>

<section class="home-section">
  <p class="home-eyebrow">Delivery</p>
  <h2 class="home-title">从本地开发到独立运行</h2>
  <p class="home-copy">同一个应用模型，可以选择不同的渲染与交付方式。每种模式都单独启用，不在默认 preset 里偷偷发生。</p>
  <div class="home-delivery">
    <a class="home-delivery__item" href="/guide/build"><span class="home-delivery__name">单页应用</span><span class="home-delivery__desc">默认模式，浏览器挂载，Vite 提供开发与构建。</span></a>
    <a class="home-delivery__item" href="/guide/build"><span class="home-delivery__name">静态导出</span><span class="home-delivery__desc">为每个字面路由输出带 head 的 HTML 外壳。</span></a>
    <a class="home-delivery__item" href="/guide/build"><span class="home-delivery__name">预渲染 + sitemap</span><span class="home-delivery__desc">用同一 SSR bundle 渲染页面、写 hydration 与站点地图。</span></a>
    <a class="home-delivery__item" href="/guide/build"><span class="home-delivery__name">SSR 与流式渲染</span><span class="home-delivery__desc">服务端首屏、serverLoader、hydration 与 Suspense 流。</span></a>
    <a class="home-delivery__item" href="/guide/build"><span class="home-delivery__name">MPA</span><span class="home-delivery__desc">顶层目录生成独立 HTML 页面与 React 根。</span></a>
    <a class="home-delivery__item" href="/guide/microfrontend"><span class="home-delivery__name">微前端</span><span class="home-delivery__desc">qiankun 子应用、宿主路由与 Module Federation 远端。</span></a>
  </div>
</section>

<section class="home-section">
  <div class="home-cta">
    <h2>先把一个页面跑起来</h2>
    <p>
      仓库内置了从基础路由到 SSR、微前端的完整示例。当前通过仓库內构建与本地 kit 交付，尚未发布到公共 npm。
    </p>
    <div class="home-cta__actions">
      <a class="home-cta__button primary" href="/guide/getting-started">快速开始</a>
      <a class="home-cta__button" href="/about/roadmap">查看路线与状态</a>
    </div>
    <p class="home-note">Node.js ≥ 22.14 · pnpm 10.6 · React 19 · Vite 7</p>
  </div>
</section>
