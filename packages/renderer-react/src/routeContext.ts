import React from 'react'
import type { IRoute } from './types.ts'

export interface RouteContextValue {
  route: IRoute
}

export const RouteContext = React.createContext<RouteContextValue | undefined>(undefined)

/** The route that renders the calling component. */
export function useRouteData() {
  return React.useContext(RouteContext)!
}
