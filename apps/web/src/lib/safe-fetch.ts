import https from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

/**
 * 사용자가 준 주소의 공개 웹 페이지 하나를 읽는다.
 *
 * 서버가 남이 준 주소를 여는 일은 위험하다. 주소가 내부망을 가리키면 서버가 공격자의
 * 손이 되어 밖에서는 닿지 않는 곳을 읽어 준다(SSRF). 그래서 다음을 지킨다.
 *
 * - https만, 기본 포트만, 계정 정보 없는 주소만, IP를 직접 적은 주소는 거절.
 * - 이름을 풀어 나온 **모든** 주소가 공개 주소여야 한다. 하나라도 사설이면 거절한다.
 * - 검사와 접속 사이에 이름이 다른 곳으로 바뀌는 것(DNS rebinding)을 막기 위해,
 *   검사를 접속에 쓰이는 lookup 안에서 한다. 검사한 주소가 곧 접속하는 주소다.
 * - 리다이렉트는 따라가되 걸음마다 같은 검사를 다시 하고, 세 번까지만 간다.
 * - 크기와 시간에 상한을 둔다. HTML이 아니면 읽지 않는다.
 */

export type UnsafeReason =
  | 'INVALID_URL'
  | 'NOT_HTTPS'
  | 'HAS_CREDENTIALS'
  | 'BAD_PORT'
  | 'IP_LITERAL'
  | 'LOCAL_NAME'
  | 'PRIVATE_ADDRESS'
  | 'TOO_MANY_REDIRECTS'
  | 'NOT_HTML'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'NETWORK';

export class PageFetchError extends Error {
  readonly reason: UnsafeReason;
  constructor(reason: UnsafeReason) {
    super(reason);
    this.reason = reason;
  }
}

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

function ipv4Octets(address: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function isPublicIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false; // 이 네트워크, 사설, 루프백
  if (a === 100 && b >= 64 && b <= 127) return false; // 통신사 NAT
  if (a === 169 && b === 254) return false; // 링크 로컬. 클라우드 메타데이터가 여기 있다
  if (a === 172 && b >= 16 && b <= 31) return false; // 사설
  if (a === 192 && b === 168) return false; // 사설
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // 프로토콜 할당, 문서용
  if (a === 198 && (b === 18 || b === 19)) return false; // 벤치마크
  if (a === 198 && b === 51 && c === 100) return false; // 문서용
  if (a === 203 && b === 0 && c === 113) return false; // 문서용
  if (a >= 224) return false; // 멀티캐스트, 예약, 브로드캐스트
  return true;
}

/** IPv6 주소를 16비트 8묶음으로 편다. 끝의 IPv4 표기도 받는다. 모양이 틀리면 null. */
function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  let tailGroups: number[] = [];
  if (tail) {
    const octets = ipv4Octets(tail[2]!);
    if (!octets) return null;
    tailGroups = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    text = tail[1]!.endsWith('::') ? tail[1]! : tail[1]!.slice(0, -1);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(':') : []);
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const groups = [...head, ...rest];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const missing = 8 - tailGroups.length - groups.length;
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null;
  return [
    ...head.map((group) => parseInt(group, 16)),
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => 0),
    ...rest.map((group) => parseInt(group, 16)),
    ...tailGroups,
  ];
}

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups || groups.length !== 8) return false;
  const embedded = () => `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  const leadingZero = groups.slice(0, 5).every((group) => group === 0);
  // IPv4를 품은 주소는 품은 주소로 판단한다. ::ffff:127.0.0.1은 루프백이다.
  if (leadingZero && groups[5] === 0xffff) return isPublicIpv4(embedded());
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0))
    return isPublicIpv4(embedded()); // NAT64
  if (leadingZero && groups[5] === 0) return false; // ::, ::1, 옛 IPv4 호환 주소
  if ((groups[0]! & 0xfe00) === 0xfc00) return false; // 고유 로컬 fc00::/7
  if ((groups[0]! & 0xffc0) === 0xfe80) return false; // 링크 로컬 fe80::/10
  if ((groups[0]! & 0xff00) === 0xff00) return false; // 멀티캐스트
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false; // 문서용
  return true;
}

/** 밖에서 닿을 수 있는 공개 주소인가. 판단할 수 없으면 공개가 아니라고 본다. */
export function isPublicAddress(address: string, family?: number): boolean {
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return address.includes(':') ? isPublicIpv6(address) : isPublicIpv4(address);
}

const LOCAL_SUFFIXES = ['.local', '.localhost', '.internal', '.intranet', '.lan', '.home', '.corp', '.home.arpa', '.test', '.invalid', '.example'];

/** 열어도 되는 주소인지 이름 단계에서 거른다. 통과해도 접속할 때 주소를 다시 검사한다. */
export function validateTargetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PageFetchError('INVALID_URL');
  }
  if (url.protocol !== 'https:') throw new PageFetchError('NOT_HTTPS');
  if (url.username || url.password) throw new PageFetchError('HAS_CREDENTIALS');
  if (url.port && url.port !== '443') throw new PageFetchError('BAD_PORT');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // URL 해석기가 2130706433이나 0x7f.1 같은 표기도 점 찍은 IPv4로 바꿔 준다. 여기서 함께 걸린다.
  if (host.startsWith('[') || ipv4Octets(host)) throw new PageFetchError('IP_LITERAL');
  if (!host.includes('.') || host.length > 253 || host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix)))
    throw new PageFetchError('LOCAL_NAME');
  if (!/^[a-z0-9.-]+$/.test(host)) throw new PageFetchError('INVALID_URL');
  return url;
}

/**
 * 접속에 쓰이는 이름 풀이. 나온 주소가 하나라도 공개가 아니면 접속 자체가 일어나지 않는다.
 * 검사와 접속이 같은 풀이 결과를 쓰므로 그 사이에 이름이 바뀔 틈이 없다.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  const wantsAll = typeof options === 'object' && options !== null && options.all === true;
  dnsLookup(hostname, { ...(typeof options === 'object' ? options : {}), all: true }, (error, addresses) => {
    if (error) return callback(error, '', 4);
    const list = (Array.isArray(addresses) ? addresses : []) as LookupAddress[];
    if (!list.length || list.some((entry) => !isPublicAddress(entry.address, entry.family)))
      return callback(Object.assign(new Error('PRIVATE_ADDRESS'), { code: 'EPRIVATE' }), '', 4);
    if (wantsAll) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    else callback(null, list[0]!.address, list[0]!.family);
  });
};

export interface FetchedPage {
  finalUrl: string;
  contentType: string;
  body: Buffer;
}

export type PageRequester = (url: URL) => Promise<
  | { kind: 'redirect'; location: string }
  | { kind: 'page'; contentType: string; body: Buffer }
>;

/** 한 걸음. 리다이렉트면 어디로 가라는지만 돌려주고 따라가지 않는다. */
export const requestOnce: PageRequester = (url) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          // 압축을 풀 일을 만들지 않는다. 읽는 크기의 상한이 곧 받는 크기의 상한이 된다.
          'Accept-Encoding': 'identity',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ko,en;q=0.8',
          'User-Agent': 'PaceOn/1.0 (+https://paceon-green.vercel.app; syllabus import at the owner\'s request)',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.resume();
          return resolve({ kind: 'redirect', location: response.headers.location });
        }
        if (status < 200 || status >= 300) {
          response.resume();
          return reject(new PageFetchError('HTTP_ERROR'));
        }
        const contentType = String(response.headers['content-type'] ?? '');
        if (!/^(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
          response.destroy();
          return reject(new PageFetchError('NOT_HTML'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            response.destroy();
            return reject(new PageFetchError('TOO_LARGE'));
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ kind: 'page', contentType, body: Buffer.concat(chunks) }));
        response.on('error', () => reject(new PageFetchError('NETWORK')));
      },
    );
    request.on('timeout', () => request.destroy(new PageFetchError('TIMEOUT')));
    request.on('error', (error: Error & { code?: string }) =>
      reject(error instanceof PageFetchError ? error : new PageFetchError(error.code === 'EPRIVATE' ? 'PRIVATE_ADDRESS' : 'NETWORK')),
    );
    request.end();
  });

/** 공개 페이지 하나를 읽는다. 리다이렉트의 걸음마다 주소를 다시 검사한다. */
export async function fetchPublicPage(raw: string, requester: PageRequester = requestOnce): Promise<FetchedPage> {
  let url = validateTargetUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await requester(url);
    if (result.kind === 'page') return { finalUrl: url.toString(), contentType: result.contentType, body: result.body };
    let next: URL;
    try {
      next = new URL(result.location, url);
    } catch {
      throw new PageFetchError('INVALID_URL');
    }
    url = validateTargetUrl(next.toString());
  }
  throw new PageFetchError('TOO_MANY_REDIRECTS');
}
