import React, { type PropsWithChildren, useLayoutEffect } from 'react'
import { Link, type LinkProps } from 'react-router'
import { useAppData } from './appContext.ts'

export type PrefetchMode = 'intent' | 'render' | 'viewport' | 'none'

export type LinkWithPrefetchProps = PropsWithChildren<Omit<LinkProps, 'prefetch'> & {
  /** preload the route's component (and loaders): on hover (`intent`), on render, or when visible */
  prefetch?: boolean | PrefetchMode
  prefetchTimeout?: number
}>

function useIntersectionObserver(
  ref: React.RefObject<Element | null>,
  callback: (entry: IntersectionObserverEntry | undefined) => void,
  disabled: boolean,
) {
  React.useEffect(() => {
    if (disabled || !ref.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => callback(entry), { rootMargin: '100px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [disabled, ref.current])
}

/** react-router's `<Link>` with route prefetching. */
export const LinkWithPrefetch = React.forwardRef<HTMLAnchorElement, LinkWithPrefetchProps>((props, forwardedRef) => {
  const { prefetch: prefetchProp, prefetchTimeout, ...linkProps } = props
  const defaults = (typeof window !== 'undefined' && window.__CORMI_ROUTE_PREFETCH__) || {}
  const defaultPrefetch = (defaults.defaultPrefetch ?? 'none') as PrefetchMode
  const defaultPrefetchTimeout = defaults.defaultPrefetchTimeout ?? 50
  const prefetch: PrefetchMode = (prefetchProp === true ? 'intent' : prefetchProp === false ? 'none' : prefetchProp) || defaultPrefetch
  if (!['intent', 'render', 'viewport', 'none'].includes(prefetch)) {
    throw new Error(`Invalid prefetch value ${prefetch} found in Link component`)
  }
  const appData = useAppData()
  const to = typeof props.to === 'string' ? props.to : props.to?.pathname
  const hasRenderFetched = React.useRef(false)
  const innerRef = React.useRef<HTMLAnchorElement>(null)
  React.useImperativeHandle(forwardedRef, () => innerRef.current!)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)

  const handleMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    linkProps.onMouseEnter?.(e)
    if (prefetch !== 'intent' || timer.current) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      appData.preloadRoute?.(to!)
    }, prefetchTimeout || defaultPrefetchTimeout)
  }
  const handleMouseLeave = (e: React.MouseEvent<HTMLAnchorElement>) => {
    linkProps.onMouseLeave?.(e)
    clearTimeout(timer.current)
    timer.current = undefined
  }

  useLayoutEffect(() => {
    if (prefetch === 'render' && !hasRenderFetched.current) {
      appData.preloadRoute?.(to!)
      hasRenderFetched.current = true
    }
  }, [prefetch, to])

  useIntersectionObserver(innerRef, (entry) => {
    if (entry?.isIntersecting) appData.preloadRoute?.(to!)
  }, prefetch !== 'viewport')

  if (!to) return null
  return (
    <Link {...linkProps} ref={innerRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {props.children}
    </Link>
  )
})

LinkWithPrefetch.displayName = 'Link'
