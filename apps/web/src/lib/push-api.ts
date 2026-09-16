import { z } from 'zod';
import type { PushSubscriptionRow } from './workspace-types.ts';
import { ApiError, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';

/**
 * 브라우저가 준 구독 정보. endpoint는 기기·브라우저마다 하나이며 전역에서 유일하다.
 * 값의 형태만 확인하고 내용은 해석하지 않는다.
 */
const subscription = z
  .object({
    endpoint: z.string().min(20).max(2000).startsWith('https://'),
    keys: z
      .object({
        p256dh: z.string().min(20).max(200),
        auth: z.string().min(10).max(100),
      })
      .strict(),
    timezone: z.string().max(100).optional(),
  })
  .strict();

export function createPushHandlers(
  config: Config | undefined,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const storage = createWorkspaceHandlers(config, fetcher);
  return {
    /** 이 기기를 등록한다. 같은 주소로 다시 오면 키만 갱신한다. */
    async PUT(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const input = subscription.parse(await readBody(request));
        await storage.rest(
          auth,
          'push_subscriptions',
          { on_conflict: 'endpoint' },
          {
            user_id: auth.userId,
            endpoint: input.endpoint,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            timezone: input.timezone ?? null,
            failure_count: 0,
          },
          {
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          },
        );
        return json({ subscribed: true });
      } catch (error) {
        return fail(error, '알림 등록 정보를 확인해 주세요.');
      }
    },
    /** 이 기기의 등록을 지운다. 끄기는 언제나 성공해야 하므로 없는 주소도 정상으로 본다. */
    async DELETE(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const input = z
          .object({ endpoint: z.string().min(20).max(2000) })
          .strict()
          .parse(await readBody(request));
        await storage.rest(
          auth,
          'push_subscriptions',
          { endpoint: `eq.${input.endpoint}`, user_id: `eq.${auth.userId}` },
          undefined,
          { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
        );
        return json({ subscribed: false });
      } catch (error) {
        return fail(error, '알림 해제 정보를 확인해 주세요.');
      }
    },
    /** 이 계정에 등록된 기기 수. 화면이 켜짐·꺼짐을 판단하는 데 쓴다. */
    async GET(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const rows = await storage.rows<PushSubscriptionRow>(
          auth,
          'push_subscriptions',
        );
        return json({ devices: rows.length });
      } catch (error) {
        return fail(error, '알림 상태를 확인하지 못했어요.');
      }
    },
  };
}

function fail(error: unknown, invalid: string) {
  if (error instanceof z.ZodError) return json({ error: invalid }, 400);
  if (error instanceof ApiError)
    return json(
      {
        error: /[가-힣]/.test(error.message)
          ? error.message
          : '연결을 확인하고 다시 시도해 주세요.',
      },
      error.status,
    );
  return json({ error: '잠시 후 다시 시도해 주세요.' }, 503);
}
