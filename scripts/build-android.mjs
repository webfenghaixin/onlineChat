// 构建 Web 资源并同步到 Android 工程
// 用法: npm run build:android
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const API_BASE = process.env.VITE_API_BASE || 'https://www.lightchat.online';

function run(cmd, args, env) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`命令失败: ${cmd} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

console.log(`VITE_API_BASE = ${API_BASE}`);

// 1. 构建 Web 资源
run('npm', ['run', 'build'], { VITE_API_BASE: API_BASE });

// 2. 同步到 Android 工程
run('npx', ['cap', 'sync', 'android']);

console.log('\n✓ Web 资源已构建并同步到 Android 工程');
console.log('  接下来请用 Android Studio 打开 android/ 目录，或运行：');
console.log('  cd android && gradlew assembleDebug   (生成 debug APK)');
console.log('  cd android && gradlew assembleRelease (生成 release APK)');
