export default function Home() {
  return <main>
    <h1>路由级页面头部</h1>
    <p>切换页面时，标题、description 与 canonical 由该路由的 <code>meta.head</code> 同步到 document；插件卸载后恢复进入前的标题。</p>
  </main>;
}
