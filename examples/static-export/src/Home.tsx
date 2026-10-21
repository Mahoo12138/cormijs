export default function Home() {
  return <main>
    <h1>静态 HTML 外壳</h1>
    <p>构建后 <code>dist/index.html</code> 与 <code>dist/guide/index.html</code> 各自带有该路由的标题与 meta；页面内容仍由浏览器渲染，这不是预渲染。</p>
  </main>;
}
