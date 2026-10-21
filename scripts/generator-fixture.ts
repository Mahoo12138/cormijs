import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const generatorConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { generatorPlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'generator', plugin: generatorPlugin, options: { id: 'app:generator' } }],
  app: { base: '/', server: { port: 0 } },
});
`;

export async function writeGeneratorFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi generator</title></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': generatorConfiguration,
    'src/pages/index.tsx': 'export default function Home(){return <main><h1>Generator home</h1></main>;}',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}
