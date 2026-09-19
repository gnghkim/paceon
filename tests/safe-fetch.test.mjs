import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PageFetchError, fetchPublicPage, guardedLookup, isPublicAddress, validateTargetUrl } from '../apps/web/src/lib/safe-fetch.ts';

const reasonOf = (work) => {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof PageFetchError, String(error));
    return error.reason;
  }
  return null;
};

test('ordinary public addresses are allowed', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '52.78.10.4', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])
    assert.equal(isPublicAddress(address), true, address);
});

test('every private, loopback, link-local and reserved IPv4 range is refused', () => {
  for (const address of [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.8.8.8',
    '100.64.0.1', '100.127.255.255', '169.254.169.254', '169.254.0.1',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
    '192.0.0.1', '192.0.2.5', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9',
    '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
  ])
    assert.equal(isPublicAddress(address), false, address);
});

test('the cloud metadata address is refused', () => {
  assert.equal(isPublicAddress('169.254.169.254', 4), false);
});

test('local IPv6 is refused, and an IPv4 address hidden inside IPv6 is judged as IPv4', () => {
  for (const address of [
    '::', '::1', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1',
    '64:ff9b::10.0.0.1', '64:ff9b::7f00:1', '::127.0.0.1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('::ffff:8.8.8.8'), true, 'a mapped public address is still public');
  assert.equal(isPublicAddress('64:ff9b::8.8.8.8'), true);
});

test('anything that cannot be understood is treated as not public', () => {
  for (const address of ['', 'localhost', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-4', ':::', '12345::1', 'gggg::1', '1:2:3:4:5:6:7:8:9', '1::2::3'])
    assert.equal(isPublicAddress(address), false, JSON.stringify(address));
  assert.equal(isPublicAddress('8.8.8.8', 6), false, 'a family that does not match is not trusted');
});

test('only plain https pages on the default port may be asked for', () => {
  assert.equal(validateTargetUrl(' https://www.inflearn.com/course/abc?cid=1 ').hostname, 'www.inflearn.com');
  assert.equal(validateTargetUrl('https://example-books.co.kr:443/item/1').port, '');
  assert.equal(reasonOf(() => validateTargetUrl('http://www.inflearn.com/')), 'NOT_HTTPS');
  assert.equal(reasonOf(() => validateTargetUrl('ftp://files.site.com/')), 'NOT_HTTPS');
  assert.equal(reasonOf(() => validateTargetUrl('file:///etc/passwd')), 'NOT_HTTPS');
  assert.equal(reasonOf(() => validateTargetUrl('https://user:pw@site.com/')), 'HAS_CREDENTIALS');
  assert.equal(reasonOf(() => validateTargetUrl('https://site.com:8443/')), 'BAD_PORT');
  assert.equal(reasonOf(() => validateTargetUrl('https://site.com:22/')), 'BAD_PORT');
  assert.equal(reasonOf(() => validateTargetUrl('not a url')), 'INVALID_URL');
  assert.equal(reasonOf(() => validateTargetUrl('')), 'INVALID_URL');
});

test('an address written as a number is refused in every spelling', () => {
  for (const url of [
    'https://127.0.0.1/', 'https://10.0.0.5/admin', 'https://169.254.169.254/latest/meta-data/', 'https://8.8.8.8/',
    'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/', 'https://127.1/',
    'https://[::1]/', 'https://[fe80::1]/', 'https://[::ffff:127.0.0.1]/',
  ])
    assert.equal(reasonOf(() => validateTargetUrl(url)), 'IP_LITERAL', url);
});

test('names that only mean something inside a network are refused', () => {
  for (const url of [
    'https://localhost/', 'https://LOCALHOST/', 'https://localhost./', 'https://intranet/', 'https://db/',
    'https://printer.local/', 'https://api.internal/', 'https://vault.corp/', 'https://router.lan/',
    'https://metadata.google.internal/', 'https://x.home.arpa/', 'https://a.localhost/',
  ])
    assert.equal(reasonOf(() => validateTargetUrl(url)), 'LOCAL_NAME', url);
});

const page = (body = '<html></html>') => ({ kind: 'page', contentType: 'text/html; charset=utf-8', body: Buffer.from(body) });

test('a redirect is followed, and the address is checked again at every step', async () => {
  const asked = [];
  const result = await fetchPublicPage('https://short.link/abc', async (url) => {
    asked.push(url.toString());
    return asked.length === 1 ? { kind: 'redirect', location: 'https://www.inflearn.com/course/abc' } : page('<html>ok</html>');
  });
  assert.deepEqual(asked, ['https://short.link/abc', 'https://www.inflearn.com/course/abc']);
  assert.equal(result.finalUrl, 'https://www.inflearn.com/course/abc');
  assert.equal(result.body.toString(), '<html>ok</html>');
});

test('a public page cannot bounce the server into a private place', async () => {
  for (const [location, reason] of [
    ['https://169.254.169.254/latest/meta-data/', 'IP_LITERAL'],
    ['http://www.site.com/', 'NOT_HTTPS'],
    ['https://localhost/admin', 'LOCAL_NAME'],
    ['//10.0.0.1/', 'IP_LITERAL'],
    ['https://site.com:8080/', 'BAD_PORT'],
  ]) {
    let calls = 0;
    await assert.rejects(
      fetchPublicPage('https://public.site.com/', async () => {
        calls++;
        return { kind: 'redirect', location };
      }),
      (error) => error instanceof PageFetchError && error.reason === reason,
      location,
    );
    assert.equal(calls, 1, 'the private target is never requested');
  }
});

test('a relative redirect stays on the same site', async () => {
  const asked = [];
  await fetchPublicPage('https://www.site.com/a/b', async (url) => {
    asked.push(url.toString());
    return asked.length === 1 ? { kind: 'redirect', location: '/login?next=1' } : page();
  });
  assert.equal(asked[1], 'https://www.site.com/login?next=1');
});

test('a redirect loop ends instead of running forever', async () => {
  let calls = 0;
  await assert.rejects(
    fetchPublicPage('https://www.site.com/', async () => {
      calls++;
      return { kind: 'redirect', location: `https://www.site.com/${calls}` };
    }),
    (error) => error.reason === 'TOO_MANY_REDIRECTS',
  );
  assert.equal(calls, 4, 'the first request and three hops');
});

test('the connection itself refuses a name that resolves to a private address', async () => {
  // localhost는 어느 환경에서든 루프백으로 풀린다. 이름 검사를 통과했더라도 여기서 막힌다.
  const error = await new Promise((resolve) => guardedLookup('localhost', { all: true }, (problem) => resolve(problem)));
  assert.equal(error?.message, 'PRIVATE_ADDRESS');
});
