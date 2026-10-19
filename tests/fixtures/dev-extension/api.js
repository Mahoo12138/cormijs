export default {
  name: 'fixture:extension-api', inject: ['devApi'],
  apply(ctx, options = {}) {
    let active = 0, cancelled = 0;
    ctx.devApi.add('fixture:api', {
      mocks: [
        { method: 'GET', path: '/items', handle({ query }) {
          if (query.has('error')) throw new Error('CORMI_FIXTURE_PRIVATE_NODE_MARKER');
          return { body: query.has('empty') ? [] : [{ id: 1, title: 'cormi fixture' }] };
        } },
        { method: 'POST', path: '/echo', handle({ body, query }) { return { body: { body, tags: query.getAll('tag') } }; } },
        { method: 'GET', path: '/stats', handle() { return { body: { active, cancelled } }; } },
        { method: 'GET', path: '/slow', async handle({ signal }) {
          active++;
          try {
            await new Promise(resolve => {
              const abort = () => { cancelled++; resolve(); };
              signal.addEventListener('abort', abort, { once: true });
              if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
            });
            signal.throwIfAborted(); return { body: 'unreachable' };
          } finally { active--; }
        } },
      ],
      proxies: options.target ? [{ path: '/remote', target: options.target, stripPrefix: true }] : [],
    });
  },
};
