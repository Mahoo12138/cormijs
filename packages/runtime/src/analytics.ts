import type { RouteChangeEvent } from './app-config.js';

export interface AnalyticsOptions {
  /** When set, the runtime maintains the GA4 gtag queue and sends `page_view` events. */
  readonly measurementId?: string;
  /** GA4 event name; defaults to `page_view`. */
  readonly eventName?: string;
  /** Also dispatch a `cormi:pageview` CustomEvent for host analytics. */
  readonly dispatch?: boolean;
}
export interface PageViewEvent {
  readonly path: string;
  readonly search: string;
  readonly hash: string;
  readonly title: string;
  readonly referrer: string;
}
interface AnalyticsState { readonly options: AnalyticsOptions; previous: string }
const states = new WeakMap<AbortSignal, AnalyticsState>();

type Gtag = (...args: unknown[]) => void;
interface AnalyticsWindow extends Window { dataLayer?: unknown[]; gtag?: Gtag }

function ensureGtag(measurementId: string): AnalyticsWindow {
  const scope = window as AnalyticsWindow;
  scope.dataLayer ??= [];
  scope.gtag ??= function gtag(...args: unknown[]) { scope.dataLayer!.push(args); } as Gtag;
  scope.gtag('js', new Date());
  scope.gtag('config', measurementId, { send_page_view: false });
  return scope;
}

function currentLocation(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname + window.location.search + window.location.hash;
}

/** Runtime plugin: one page-view per route change, GA4-compatible and vendor-neutral. */
export const analyticsRuntime = {
  setup({ options, signal }: { readonly options: unknown; readonly signal: AbortSignal }) {
    const parsed = (options ?? {}) as AnalyticsOptions;
    if (typeof window === 'undefined') return;
    if (parsed.measurementId !== undefined) ensureGtag(parsed.measurementId);
    states.set(signal, { options: parsed, previous: currentLocation() });
    return () => { states.delete(signal); };
  },
  onRouteChange(location: Readonly<{ pathname: string; search: string; hash: string }>, _event: RouteChangeEvent,
    context?: { readonly signal: AbortSignal }) {
    const state = context && states.get(context.signal);
    if (!state || typeof window === 'undefined') return;
    const base = _event.basename;
    const served = base !== '/' && location.pathname.startsWith(base) ? '/' + location.pathname.slice(base.length) : location.pathname;
    const page: PageViewEvent = Object.freeze({
      path: served || '/', search: location.search, hash: location.hash,
      title: document.title, referrer: state.previous,
    });
    state.previous = location.pathname + location.search + location.hash;
    if (state.options.measurementId !== undefined) {
      (window as AnalyticsWindow).gtag?.('event', state.options.eventName ?? 'page_view', {
        // GA paths are relative to the host, so the served (basename-including) path is reported here.
        page_title: page.title, page_path: window.location.pathname + window.location.search,
        page_location: window.location.href, page_referrer: page.referrer,
      });
    }
    if (state.options.dispatch) window.dispatchEvent(new CustomEvent<PageViewEvent>('cormi:pageview', { detail: page }));
  },
};
