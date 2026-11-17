// Publishes dist/ to the gh-pages branch of catcreature/fuse-web (GitHub Pages serves that branch).
// Run through `npm run deploy`, which tests and builds first. Node built-ins and git only.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REMOTE = 'https://github.com/catcreature/fuse-web.git';
const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/index.html is missing: run npm run build first');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const dir = mkdtempSync(join(tmpdir(), 'fuse-web-deploy-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' });
try {
  cpSync(dist, dir, { recursive: true });
  writeFileSync(join(dir, '.nojekyll'), '');
  git('init', '-q', '-b', 'gh-pages');
  git('add', '-A');
  git('commit', '-q', '-m', `Deploy ${version}`);
  git('push', '-f', REMOTE, 'gh-pages');
  console.log(`Deployed ${version} to gh-pages`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
