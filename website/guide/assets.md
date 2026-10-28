# 样式与静态资源

## `index.html` 与 `public/`

`index.html` 由应用维护，入口脚本指向 `/.cormi/app.tsx`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>cormi app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/.cormi/app.tsx"></script>
  </body>
</html>
```

`public/` 下的文件会原样复制到构建产物，开发期由 Vite 提供。需要构建后再复制的项目文件使用 `outputPlugin`，见[构建](/guide/build#输出策略)。

`index.html` 必须包含 `<meta charset>`；否则静态导出中的非 ASCII 标题可能按错误编码返回。

## 全局样式

全局样式需要显式启用 `globalStylePlugin`：

```ts
import { globalStylePlugin } from '@cormijs/plugin-react'

plugins: [{
  id: 'styles',
  plugin: globalStylePlugin,
  options: { id: 'app:styles' },
}]
```

默认候选：

```text
src/global.css
src/global.scss
src/global.sass
src/global.less
```

每个贡献取第一个存在的文件，可用 `options.files` 覆盖。生成入口 `.cormi/app.tsx` 会按 styles hook 顺序加入副作用导入：

```ts
import '../src/global.css'
```

开发期新建或删除该文件会触发生成更新。Less/Sass 由 Vite 原生处理，需要应用自行安装 `less` 或 `sass`。

页面局部样式仍由页面自己导入，不要把每个页面的样式都塞进全局文件。

## CSS Modules 与资源导入

```tsx
import styles from './page.module.css'
import mark from './mark.svg'

export default function Page() {
  return <img className={styles.mark} src={mark} alt="" />
}
```

创建器模板的 `src/assets.d.ts` 提供有限声明：

```ts
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
declare module '*.svg' {
  const url: string
  export default url
}
declare module '*.png' {
  const url: string
  export default url
}
```

这份文件必须是**没有顶层 import/export 的声明脚本**，否则 ambient module 会变成模块增强。不要用 `declare module '*'` 做全量 any 回退。

声明只说明模块形状，**不证明文件存在**。实际 build 和浏览器验收不能省略。

需要更完整的样式/资源类型时，启用 `styleTypesPlugin`：

```ts
import { styleTypesPlugin } from '@cormijs/plugin-react'

plugins: [{ id: 'style-types', plugin: styleTypesPlugin }]
```

它会生成 `.cormi/styles.d.ts`，覆盖：

- `*.module.{css,scss,sass,less}`
- 纯 CSS 副作用导入
- 常见图片与字体资源

类名是字符串索引，不解析具体选择器，也不支持 `?url` 等查询后缀。默认关闭，避免与应用自己的 `*.d.ts` 冲突。

## 路径别名

```ts
import { aliasPlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'alias',
  plugin: aliasPlugin,
  options: {
    aliases: {
      '@': 'src',
      '@shared': 'src/shared',
    },
  },
}]
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["./src/shared/*"]
    }
  }
}
```

- 别名值必须是项目内相对路径。
- 插件会把别名合并进 Vite 解析器，dev 与 build 一致。
- 插件不修改 `tsconfig.json`，TypeScript 侧需要自己对齐。
- `builtins: true` 会额外提供 `@` → `src`，但不会截获 `@scope/pkg` 形式的作用域包；显式同名别名优先。

```ts
plugins: [{
  id: 'alias',
  plugin: aliasPlugin,
  options: { builtins: true },
}]
```

## 编译期常量

```ts
import { definePlugin } from '@cormijs/plugin-react-vite'

plugins: [{
  id: 'define',
  plugin: definePlugin,
  options: {
    values: {
      APP_NAME: 'cormi define',
      APP_FLAGS: { beta: true, retries: 2 },
      'process.env.APP_MODE': 'example',
    },
  },
}]
```

值按 JSON 字面量替换，字符串会带引号；`process.env.X` 形式也可以使用。开发、构建与预览结果一致。

```ts
// src/defines.d.ts
declare const APP_NAME: string
declare const APP_FLAGS: { beta: boolean; retries: number }
```

约束：

- key 必须是合法的标识符路径，最多 256 字符。
- 禁止 `process`、`process.env`、`process.env.NODE_ENV`、`import.meta`、`import.meta.env` 以及以 `import.meta.` 开头的 key。
- 值必须可 JSON 序列化，最多 4096 字符。
- 不允许一个 key 是另一个 key 的点号前缀。
- 不能替换 `window`、`document`、`require`、`module` 等根标识符。

## 公开环境变量

只有 `CORMI_PUBLIC_` 前缀的变量会进入浏览器：

```ts
const title = import.meta.env.CORMI_PUBLIC_TITLE ?? 'cormi app'
```

```html
<title>%CORMI_PUBLIC_TITLE%</title>
```

- 未明确声明的公开值类型是 `string | undefined`。
- 值始终是字符串，不展开 `${...}`。
- 公开前缀是主动披露声明，不是脱敏。
- 私有值不要放进 runtime options、路由 meta 或日志。

环境文件优先级与 mode 规则见[配置参考](/reference/config#环境变量)。

## 样式与 SSR

SSR 构建会把客户端样式作为资源输出。不要依赖在模块顶层直接访问 `document` 的样式注入；需要浏览器 API 的组件用 `<ClientOnly>` 隔离，见[布局](/guide/layout#ssr-与浏览器-api)。

下一步：[Head 与 SEO](/guide/head)。
