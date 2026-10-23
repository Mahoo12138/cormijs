import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientOnly } from '@cormijs/runtime';

test('ClientOnly renders the fallback on the server and withholds children', () => {
  const html = renderToStaticMarkup(createElement(ClientOnly, { fallback: createElement('p', { 'data-fallback': true }, 'loading') },
    createElement('canvas', { 'data-chart': true })));
  assert.equal(html, '<p data-fallback="true">loading</p>');
  assert.equal(renderToStaticMarkup(createElement(ClientOnly, null, 'child')), '');
});
