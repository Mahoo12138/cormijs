import { mountApplication, type ApplicationHandle, type MountApplicationOptions } from './index.js';

export type MicroApplication = Omit<MountApplicationOptions, 'element'>;
export interface MicroAppOptions {
  /** Id of the mount element created inside the qiankun container; default `root`. */
  readonly mountId?: string;
  /** Override the application base for this micro-app mount. */
  readonly base?: string;
}
export interface MicroAppProps {
  /** qiankun passes its container as an Element; selectors are accepted for direct tests. */
  readonly container?: Element | string;
  /** Per-mount browser-history base; overrides the application/options base until the next unmount. */
  readonly base?: string;
}
export interface MicroAppLifecycles {
  bootstrap(): Promise<void>;
  mount(props?: MicroAppProps): Promise<void>;
  unmount(): Promise<void>;
  update(props?: MicroAppProps): Promise<void>;
}

/** qiankun-compatible sub-app lifecycles around one cormi application. */
export function createMicroApp(application: MicroApplication, options: MicroAppOptions = {}): MicroAppLifecycles {
  if (!application || typeof application !== 'object' || Array.isArray(application)) throw new TypeError('MICRO_APP_INVALID: application must be an object');
  if (!Array.isArray(application.routes)) throw new TypeError('MICRO_APP_INVALID: application.routes must be an array');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('MICRO_APP_INVALID: options must be an object');
  const mountId = options.mountId ?? 'root';
  if (typeof mountId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(mountId)) throw new TypeError('MICRO_APP_INVALID: invalid mountId');
  if (options.base !== undefined && (typeof options.base !== 'string' || !options.base.startsWith('/') || !options.base.endsWith('/'))) {
    throw new TypeError('MICRO_APP_INVALID: base must be an absolute path ending in /');
  }
  const base = options.base ?? application.base;
  let handle: ApplicationHandle | undefined, element: HTMLElement | undefined, created = false, mounting: Promise<void> | undefined;
  const resolveContainer = (props?: MicroAppProps): HTMLElement => {
    if (typeof document === 'undefined') throw new Error('MICRO_APP_INVALID: mount requires a browser document');
    const container = props?.container;
    const resolved = typeof container === 'string' ? document.querySelector(container) : container;
    if (!(resolved instanceof HTMLElement)) throw new Error('MICRO_APP_INVALID: container must be an Element or selector');
    return resolved;
  };
  const mount = async (props?: MicroAppProps): Promise<void> => {
    if (mounting) return mounting;
    if (handle) throw new Error('MICRO_APP_INVALID: application is already mounted');
    mounting = (async () => {
      const requested = props?.base;
      if (requested !== undefined && (typeof requested !== 'string' || !requested.startsWith('/') || !requested.endsWith('/'))) {
        throw new Error('MICRO_APP_INVALID: props.base must be an absolute path ending in /');
      }
      const effective = requested ?? base;
      const container = resolveContainer(props);
      const existing = container.querySelector<HTMLElement>(`#${mountId}`);
      element = existing ?? document.createElement('div');
      created = !existing;
      if (!existing) { element.id = mountId; container.appendChild(element); }
      try {
        handle = await mountApplication({ ...application, ...(effective === undefined ? {} : { base: effective }), element });
      } catch (error) {
        if (created) element.remove();
        element = undefined; created = false;
        throw error;
      }
    })();
    try { await mounting; }
    finally { mounting = undefined; }
  };
  const unmount = async (): Promise<void> => {
    if (mounting) await mounting.catch(() => {});
    if (!handle) return;
    const current = handle;
    handle = undefined;
    await current.dispose();
    if (created) element?.remove();
    element = undefined; created = false;
  };
  return Object.freeze({
    async bootstrap() {},
    mount,
    unmount,
    async update() {},
  });
}
