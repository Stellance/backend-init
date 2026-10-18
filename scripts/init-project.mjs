// One-shot: names the project, regenerates migrations from scratch and
// creates .env. Deletes itself afterwards so it cannot wipe real migrations.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

const TEMPLATE_NAME = 'api-template';
const name = process.argv[2];

if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('Usage: pnpm init-project <kebab-case-name>');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.name !== TEMPLATE_NAME) {
  console.error(`package.json name is "${pkg.name}": already initialised.`);
  process.exit(1);
}
if (!existsSync('node_modules/.bin/drizzle-kit')) {
  console.error('Run `pnpm install` first.');
  process.exit(1);
}

pkg.name = name;
delete pkg.scripts['init-project'];
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);

rmSync('drizzle', { recursive: true, force: true });
const generate = (...args) =>
  execFileSync('node_modules/.bin/drizzle-kit', ['generate', ...args], {
    stdio: 'inherit',
  });
generate('--name=init');
generate('--custom', '--name=audit_log_append_only');
const custom = readdirSync('drizzle').find((f) =>
  f.endsWith('_audit_log_append_only.sql'),
);
copyFileSync('scripts/sql/audit_log_append_only.sql', `drizzle/${custom}`);

if (!existsSync('.env')) {
  const env = readFileSync('.env.example', 'utf8')
    .replace(/^APP_NAME=.*$/m, `APP_NAME=${name}`)
    .replace(/\/api$/m, `/${name.replaceAll('-', '_')}`)
    .replace(
      /^JWT_ACCESS_SECRET=.*$/m,
      `JWT_ACCESS_SECRET=${randomBytes(48).toString('base64')}`,
    );
  writeFileSync('.env', env);
}

const readme = readFileSync('README.md', 'utf8')
  .replace(/^# .*$/m, `# ${name}`)
  .replace(/## Using this template[\s\S]*?(?=\n## )/, '');
writeFileSync('README.md', readme);

rmSync('scripts', { recursive: true, force: true });
console.log(`\nInitialised ${name}. Next: pnpm build && pnpm db:migrate`);
