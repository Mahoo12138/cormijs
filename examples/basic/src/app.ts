export function onRouteChange({ location }: { location: { pathname: string } }) {
  document.title = `Cormi · ${location.pathname}`
}
