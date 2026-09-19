import { execFileSync } from 'node:child_process';

const DEVELOPMENT_VERSION = '개발 버전';

export function formatAppVersion(date, sha) {
  const compactDate = date.trim().replaceAll('-', '');
  const shortSha = sha.trim().slice(0, 7);

  if (!/^\d{8}$/.test(compactDate) || !/^[0-9a-f]{7}$/i.test(shortSha)) {
    return DEVELOPMENT_VERSION;
  }

  return `${compactDate}-${shortSha}`;
}

export function resolveAppVersion(
  env = process.env,
  runGit = (...args) => execFileSync('git', args, { encoding: 'utf8' }),
) {
  const explicitVersion = env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (explicitVersion) return explicitVersion;

  try {
    return formatAppVersion(
      runGit('log', '-1', '--format=%cs'),
      runGit('rev-parse', '--short=7', 'HEAD'),
    );
  } catch {
    return DEVELOPMENT_VERSION;
  }
}
