import { createBrowserHistory, createHashHistory, createMemoryHistory, type History } from '{{{ historyPath }}}';

export type CormiHistory = History & {
{{#reactRouter5Compat}}
  goBack: () => void;
{{/reactRouter5Compat}}
};

let history: CormiHistory;
let basename = '/';

export function createHistory(opts: any) {
  let h: any;
  if (opts.type === 'hash') {
    h = createHashHistory();
  } else if (opts.type === 'memory') {
    h = createMemoryHistory(opts);
  } else {
    h = createBrowserHistory();
  }
  if (opts.basename) {
    basename = opts.basename;
  }
{{#reactRouter5Compat}}
  h.goBack = function () {
    h.back();
  };
{{/reactRouter5Compat}}
  history = {
    ...h,
    push(to: any, state?: any) {
      h.push(patchTo(to, h), state);
    },
    replace(to: any, state?: any) {
      h.replace(patchTo(to, h), state);
    },
    get location() {
      return h.location;
    },
    get action() {
      return h.action;
    },
  };
  return h;
}

export function setHistory(h: CormiHistory) {
  if (h) history = h;
}

// `to` is relative to the basename
function patchTo(to: any, h: History) {
  if (typeof to === 'string') {
    return `${stripLastSlash(basename)}${to}`;
  } else if (typeof to === 'object') {
    const currentPathname = h.location.pathname;
    return {
      ...to,
      pathname: to.pathname ? `${stripLastSlash(basename)}${to.pathname}` : currentPathname,
    };
  }
  throw new Error(`Unexpected to: ${to}`);
}

function stripLastSlash(path: string) {
  return path.slice(-1) === '/' ? path.slice(0, -1) : path;
}

export { history };
