// 本地验证腾讯云 COS 凭据与桶连通性。仅用于排障，不入库、不上传。
// 用法：先设置环境变量，然后运行
//   COS_SECRET_ID=xxx COS_SECRET_KEY=yyy COS_BUCKET=lightchat-1258967442 COS_REGION=ap-beijing node scripts/test-cos.mjs
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const id = process.env.COS_SECRET_ID || '';
const key = process.env.COS_SECRET_KEY || '';
const bucket = process.env.COS_BUCKET || '';
const region = process.env.COS_REGION || '';

if (!id || !key) {
  console.error('缺少 COS_SECRET_ID / COS_SECRET_KEY 环境变量');
  process.exit(1);
}
if (!bucket || !region) {
  console.error('缺少 COS_BUCKET / COS_REGION 环境变量');
  process.exit(1);
}

console.log('密钥前缀(前8位):', id.slice(0, 8) + '...');
console.log('桶:', bucket, ' 地域:', region);

const COS = require('cos-nodejs-sdk-v5');
const cos = new COS({ SecretId: id, SecretKey: key });

const keyName = `_cos_test_${Date.now()}.txt`;

function head() {
  return new Promise((resolve, reject) => {
    cos.headBucket({ Bucket: bucket, Region: region }, (err) => {
      if (err) return reject(err);
      resolve('headBucket OK');
    });
  });
}

function put() {
  return new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket: bucket,
        Region: region,
        Key: keyName,
        Body: Buffer.from('cos-test'),
        ContentType: 'text/plain',
      },
      (err, data) => (err ? reject(err) : resolve('putObject OK -> ' + JSON.stringify(data))),
    );
  });
}

function del() {
  return new Promise((resolve, reject) => {
    cos.deleteObject({ Bucket: bucket, Region: region, Key: keyName }, (err) =>
      err ? reject(err) : resolve('deleteObject OK'),
    );
  });
}

async function run() {
  console.log('\n[1] 检查桶可达性:');
  try { console.log('   ', await head()); }
  catch (e) { console.error('   失败:', e.message); }

  console.log('[2] 测试写入+删除:');
  try {
    console.log('   ', await put());
    console.log('   ', await del());
  } catch (e) {
    console.error('   失败:', e.message);
  }
}

run();