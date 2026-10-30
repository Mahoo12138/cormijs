import React from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useAppData } from './appContext.ts'

export interface RouteComponentProps<T = ReturnType<typeof useParams>> {
  history: {
    back: () => void
    goBack: () => void
    location: ReturnType<typeof useLocation>
    push: (url: string, state?: any) => void
  }
  location: ReturnType<typeof useLocation>
  match: {
    params: T
  }
  params: T
  navigate: ReturnType<typeof useNavigate>
}

/** HOC injecting react-router 5 style props, for class components. */
export function withRouter<P extends RouteComponentProps>(Component: React.ComponentType<P>) {
  function ComponentWithRouterProp(props: Omit<P, keyof RouteComponentProps>) {
    const location = useLocation()
    const navigate = useNavigate()
    const params = useParams()
    const { history } = useAppData()
    const routerProps: RouteComponentProps = {
      history: {
        back: () => navigate(-1),
        goBack: () => navigate(-1),
        location,
        push: (url, state) => (history ? history.push(url, state) : navigate(url, { state })),
      },
      location,
      match: { params },
      params,
      navigate,
    }
    return <Component {...(props as P)} {...routerProps} />
  }
  return ComponentWithRouterProp
}
