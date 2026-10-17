import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { packWorkspace, createReactConsumer } from './packaging.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const parsed = parseArgs({ strict: true, options: { out: { type: 'string' } } });
await mkdir(join(root, '.cache'), { recursive: true });
const destination = resolve(parsed.values.out ?? join(root, '.cache', 'cormi-kit-' + randomUUID()));
const kit = await packWorkspace(root, destination);
await createReactConsumer(root, kit, join(destination, 'app'));
await writeFile(join(destination, 'README.md'), `# cormi 本地试用包\n\n这不是 npm 发布或完全离线依赖镜像。必须把整个目录移动或复制到 cormi workspace 之外再安装；不要在原仓库的 .cache 中直接运行 pnpm install。\n\n进入 app，使用 Node 22.14+ 和 pnpm 10.6.3，先运行 pnpm install --ignore-scripts，再运行 pnpm exec cormi typecheck 和 pnpm dev。构建使用 pnpm build，预览使用 pnpm preview；同项目先关闭 dev 才能执行其他命令。\n\napp/package.json 的 file: overrides 只将尚未发布的内部包指向本地 tgz，不将它们全部添加为顶层依赖。Cordis RC.11 的声明兼容补丁必须由消费者根 patchedDependencies 显式启用。补丁和上游 LICENSE 在 compatibility；不修改 Cordis JavaScript，不运行 postinstall 补丁，不提供自己的 Context 副本。\n\nmanifest.json 记录每个 tgz 与补丁的 SHA-256。普通无补丁 NodeNext 消费尚不能通过；不是任意 npm/yarn/pnpm 安装形态都已验证。项目许可、公开包名归属、平台矩阵和发布审批仍未完成，所有包保持 private。\n`);
console.log(JSON.stringify({ destination, packages: kit.packages.length, publicationEligible: false }, null, 2));
