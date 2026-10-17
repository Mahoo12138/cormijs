import type { DevelopmentState } from '@cormijs/builder/development';

interface HotChannel {
  on(event: string, callback: (data: any) => void): void;
  off(event: string, callback: (data: any) => void): void;
  send(event: string): void;
  dispose(callback: () => void): void;
}
/** Serialized as a standalone dev-only virtual module. Keep it free of module-scope dependencies. */
export function developmentClient(hot: HotChannel, initial: DevelopmentState): void {
  let current = initial, connected = true, dismissed = false;
  const host = document.createElement('cormi-development-overlay');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;font:15px/1.6 system-ui,sans-serif;color:#e8edf2}*{box-sizing:border-box}.shade{position:absolute;inset:0;background:#10151cbd;display:grid;place-items:start center;padding:8vh 20px;overflow:auto;pointer-events:auto}.panel{width:min(760px,100%);background:#161d28;border:1px solid #526079;border-top:4px solid #e9aa65;border-radius:8px;box-shadow:0 18px 70px #0008;padding:26px}.top{display:flex;justify-content:space-between;gap:18px;align-items:center}.brand{letter-spacing:.12em;color:#b8c7df;font-size:12px}h2{font-size:24px;line-height:1.3;margin:18px 0 8px}p{margin:10px 0}pre{font:13px/1.7 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#0e1420;padding:14px;border-radius:4px}button{font:inherit;background:#243145;color:#f0f4fa;border:1px solid #60718b;border-radius:5px;padding:6px 12px;cursor:pointer}button:focus-visible{outline:3px solid #b9daff}.hint{color:#b8c7df;font-size:13px}.badge{position:absolute;right:18px;bottom:18px;pointer-events:auto} @media(max-width:480px){.shade{padding:18px 10px}.panel{padding:18px}h2{font-size:21px}}`;
  shadow.append(style);
  let display: HTMLElement | undefined;
  function render(): void {
    display?.remove(); display = undefined;
    if (current.status === 'ready' && connected) { host.remove(); return; }
    if (!host.isConnected) document.documentElement.append(host);
    if (dismissed) {
      const button = document.createElement('button'); button.className = 'badge';
      button.textContent = connected ? 'cormi: compilation error' : 'cormi: disconnected';
      button.onclick = () => { dismissed = false; render(); }; shadow.append(button); display = button; return;
    }
    const shade = document.createElement('section'); shade.className = 'shade';
    const panel = document.createElement('div'); panel.className = 'panel'; panel.setAttribute('role', 'alert');
    panel.setAttribute('aria-label', 'cormi compilation diagnostic');
    const top = document.createElement('div'); top.className = 'top';
    const brand = document.createElement('span'); brand.className = 'brand'; brand.textContent = 'cormi / DEVELOPMENT';
    const dismiss = document.createElement('button'); dismiss.textContent = 'Minimize'; dismiss.onclick = () => { dismissed = true; render(); };
    top.append(brand, dismiss);
    const title = document.createElement('h2'); title.textContent = connected ? 'Application compilation failed' : 'Development connection lost';
    const diagnostic = current.diagnostic;
    const description = document.createElement('p'); description.textContent = connected
      ? diagnostic?.message ?? 'Waiting for the application to compile.'
      : 'This diagnostic may be stale. Reconnecting to the development server…';
    const detail = document.createElement('pre');
    detail.textContent = [diagnostic?.code, diagnostic ? `Phase: ${diagnostic.phase}` : '',
      diagnostic?.pluginId ? `Plugin: ${diagnostic.pluginId}` : '', diagnostic?.hookId ? `Hook: ${diagnostic.hookId}` : '',
      ...(diagnostic?.files ?? [])].filter(Boolean).join('\n');
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = current.hasOutput
      ? 'The last generated entry is preserved; edited source files may still fail. Fix the input to recover automatically.'
      : 'The development server is running, but this session has no valid application yet. Fix the input; no manual restart is required.';
    panel.append(top, title, description, detail, hint); shade.append(panel); shadow.append(shade); display = shade;
  }
  const update = (value: DevelopmentState) => {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < current.revision
      || !['ready', 'error'].includes(value.status)) return;
    if (value.revision !== current.revision) dismissed = false;
    current = value; render();
  };
  const reconnect = () => { connected = true; hot.send('cormi:development:request'); render(); };
  const disconnect = () => { connected = false; dismissed = false; render(); };
  hot.on('cormi:development:state', update);
  hot.on('vite:ws:connect', reconnect); hot.on('vite:ws:disconnect', disconnect);
  hot.dispose(() => {
    hot.off('cormi:development:state', update);
    hot.off('vite:ws:connect', reconnect); hot.off('vite:ws:disconnect', disconnect); host.remove();
  });
  render(); hot.send('cormi:development:request');
}
