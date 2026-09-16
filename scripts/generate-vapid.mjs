// 알림에 쓸 VAPID 키 한 쌍을 만든다. 저장하지 않고 화면에만 찍는다.
//
//   node scripts/generate-vapid.mjs
//
// 공개키는 웹의 NEXT_PUBLIC_VAPID_PUBLIC_KEY로, 비밀키는 Worker의 VAPID_PRIVATE_KEY로 넣는다.
// 비밀키는 저장소에 올리지 않는다. 키를 바꾸면 기존 구독은 모두 무효가 되므로,
// 사용자는 기기마다 알림을 다시 켜야 한다.
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const base64url = (buffer) => buffer.toString('base64url');

// 웹 푸시는 압축하지 않은 P-256 공개점(0x04 || X || Y) 65바이트를 쓴다.
const spki = publicKey.export({ type: 'spki', format: 'der' });
const point = base64url(spki.subarray(spki.length - 65));

// 비밀키는 32바이트 스칼라다. JWK의 d가 이미 base64url이다.
const secret = privateKey.export({ format: 'jwk' }).d;

if (Buffer.from(point, 'base64url').length !== 65 || Buffer.from(secret, 'base64url').length !== 32) {
  console.error('키 길이가 예상과 다릅니다. Node 버전을 확인해 주세요.');
  process.exit(1);
}

console.log('apps/web/.env.local 그리고 Vercel 환경변수:');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${point}`);
console.log('');
console.log('Worker의 .env (VPS의 /opt/paceon-deploy/.env):');
console.log(`VAPID_PUBLIC_KEY=${point}`);
console.log(`VAPID_PRIVATE_KEY=${secret}`);
console.log(`VAPID_SUBJECT=mailto:your-address@example.com`);
console.log('');
console.log('비밀키는 저장소에 올리지 마세요.');
