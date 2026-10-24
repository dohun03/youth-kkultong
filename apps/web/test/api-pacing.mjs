import { setTimeout } from 'node:timers/promises';

// 전체 검증은 --test-isolation=none --test-concurrency=1로 실행해 이 대기열을 공유한다.
// 실제 서버의 분당 120회 제한을 유지하면서 브라우저와 기대값 조회를 합쳐 약 100회로 제한한다.
let nextRequestAt = 0;
let queue = Promise.resolve();

/** 실제 API를 호출하기 전에 다음 요청 순서까지 기다린다. */
function waitForApiTurn(isActive = () => true) {
  const turn = queue.then(async () => {
    // 응답을 대체한 짧은 테스트가 탭을 닫으면, 남아 있던 메타 요청은 순번을 소비하지 않는다.
    if (!isActive()) return false;
    await setTimeout(Math.max(0, nextRequestAt - Date.now()));
    if (!isActive()) return false;
    nextRequestAt = Date.now() + 600;
    return true;
  });
  queue = turn.then(() => {}, () => {});
  return turn;
}

/** 기대값을 얻는 서버 요청도 브라우저와 같은 요청 간격을 따른다. */
export async function pacedFetch(...args) {
  await waitForApiTurn();
  return globalThis.fetch(...args);
}

/** 실제 서버로 전달하는 브라우저 API 요청에만 간격을 적용한다. 응답은 바꾸지 않는다. */
export async function paceBrowserContext(context) {
  await context.route('**/api/v1/**', async (route) => {
    const active = await waitForApiTurn(() => !route.request().failure()
      && context.pages().some((page) => !page.isClosed()));
    try {
      if (active) await route.continue();
      else await route.abort();
    }
    catch (error) {
      // 테스트가 먼저 탭을 닫은 경우에는 전송할 대상이 없으므로 대기를 끝낸다.
      if (context.pages().some((page) => !page.isClosed())) throw error;
    }
  });
}
