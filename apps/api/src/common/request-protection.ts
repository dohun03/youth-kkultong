import type { IncomingMessage, ServerResponse } from 'node:http';

/** API 프로세스가 접속 주소별로 기억하는 1분간의 요청 횟수. */
interface RequestWindow { count: number; expiresAt: number }

/** 외부 저장소 없이 단일 API의 과도한 요청을 막는 미들웨어를 만든다. */
export function createRequestProtection(now: () => number = Date.now) {
  const windows = new Map<string, RequestWindow>();
  const duration = 60_000;
  const maxRequests = 120;
  const maxAddresses = 10_000;

  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    // 검색 결과나 오류 응답에 사용자 입력이 포함되더라도 중간 캐시에 남기지 않는다.
    res.setHeader('Cache-Control', 'no-store');
    const path = req.url?.split('?')[0];
    // 컨테이너의 생존 확인은 사용자의 호출 제한과 무관하게 계속 응답한다.
    if (req.method === 'GET' && path === '/api/v1/health') { next(); return; }

    const time = now();
    // 요청 시 만료 항목을 제거한다. 별도 타이머나 영구 IP 저장은 사용하지 않는다.
    for (const [address, window] of windows) {
      if (window.expiresAt <= time) windows.delete(address);
    }
    // 위조 가능한 X-Forwarded-For 대신 실제 TCP 접속 주소만 신뢰한다.
    const address = req.socket.remoteAddress ?? 'unknown';
    let window = windows.get(address);
    if (!window && windows.size < maxAddresses) {
      window = { count: 0, expiresAt: time + duration };
      windows.set(address, window);
    }
    // 주소가 너무 많으면 기존 항목을 지워 제한을 우회시키지 않고 새 요청을 거부한다.
    if (!window || window.count >= maxRequests) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(((window?.expiresAt ?? time + duration) - time) / 1000))));
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 'TOO_MANY_REQUESTS', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }));
      return;
    }
    window.count += 1;

    // 검색은 JSON만 받는다. 폼·텍스트 본문이 빈 검색 요청으로 처리되는 것을 막는다.
    if (req.method === 'POST' && path === '/api/v1/policies/search'
      && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
      res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'JSON 형식으로 요청해 주세요.' }));
      return;
    }
    next();
  };
}
