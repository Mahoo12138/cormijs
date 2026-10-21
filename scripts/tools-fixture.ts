import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const toolsConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { toolPlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'tools', plugin: toolPlugin, options: {
    lint: { bin: 'fake-lint' },
    format: { bin: 'fake-format', args: ['--write'] },
  } }],
  app: { base: '/', server: { port: 0 } },
});
`;

export async function writeToolsFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><meta charset="utf-8" /><title>cormi tools</title></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': toolsConfiguration,
    'src/pages/index.tsx': 'export default function Home(){return <main><h1>Tools home</h1></main>;}',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

const fake = (label: string) => `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nconsole.log('${label}:' + args.join(' '));\nif (args.includes('--fail')) process.exit(3);\n`;

/** The consumer installs no real linter; these stand in for the project's own binaries. */
export async function writeFakeTools(root: string) {
  await mkdir(join(root, 'node_modules/.bin'), { recursive: true });
  for (const [name, label] of [['fake-lint', 'lint'], ['fake-format', 'format']] as const) {
    const file = join(root, 'node_modules/.bin', name);
    await writeFile(file, fake(label));
    await chmod(file, 0o755);
  }
}
