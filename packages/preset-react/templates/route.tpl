{{{ headerImports }}}

export async function getRoutes() {
  const routes: Record<string, any> = {{{ routes }}};
{{{ routesPatches }}}
  return {
    routes,
    routeComponents: {{{ routeComponents }}},
  };
}

