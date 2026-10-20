import { defineApp } from '@cormijs/runtime';
import { PreferencesContext, type Preferences } from './preferences';
import Help from './Help';
import './style.css';

// Each mount gets its own configuration closure; this is not a global user-state store.
export default defineApp(() => {
  let preferences: Preferences;
  return {
    async render(next, { signal }) {
      const response = await fetch(import.meta.env.BASE_URL + 'preferences.json', { signal });
      if (!response.ok) throw new Error('读取应用配置失败');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('title' in value) || typeof value.title !== 'string'
        || !('description' in value) || typeof value.description !== 'string') {
        throw new Error('应用配置格式不正确');
      }
      preferences = { title: value.title, description: value.description };
      await next();
    },
    patchClientRoutes({ routes }) {
      routes.push({ id: 'application:help', path: 'help', Component: Help });
    },
    rootContainer(container) {
      return <PreferencesContext.Provider value={preferences}>
        <div className="shell">
          <header><span className="eyebrow">CORMI · APPLICATION RUNTIME</span><h1>{preferences.title}</h1><p>{preferences.description}</p></header>
          {container}
          <footer>根容器与首屏初始化来自 src/app.tsx。路由、构建及服务仍由插件组合提供。</footer>
        </div>
      </PreferencesContext.Provider>;
    },
    onRouteChange({ location, action, isFirst }) {
      document.title = `${isFirst ? '首次进入' : '页面导航'} · ${action} · ${location.pathname}`;
    },
  };
});
