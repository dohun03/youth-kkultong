import type { IncomingMessage, ServerResponse } from 'node:http';

/** API 프로세스가 접속 주소별로 기억하는 1분간의 요청 횟수. */
interface RequestWindow { count: number; expiresAt: number }

/** 외부 저장소 없이 단일 API의 과도한 요청을 막는 미들웨어를 만든다. */
export function createRequestProtection(now: () => number = Date.now) {
  const publicWindows = new Map<string, RequestWindow>();
  const adminWindows = new Map<string, RequestWindow>();
  const loginWindows = new Map<string, RequestWindow>();
  const duration = 60_000;
  const maxRequests = 120;
  const maxAddresses = 10_000;

  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    // 검색 결과나 오류 응답에 사용자 입력이 포함되더라도 중간 캐시에 남기지 않는다.
    res.setHeader('Cache-Control', 'no-store');
    const path = (req.url?.split('?')[0] ?? '').toLowerCase().replace(/\/+$/, '');
    // 컨테이너의 생존 확인은 사용자의 호출 제한과 무관하게 계속 응답한다.
    if (req.method === 'GET' && path === '/api/v1/health') { next(); return; }

    const time = now();
    // 공개 및 관리자 일반 한도는 분리하고 로그인 POST에는 별도 5회 한도를 함께 적용
    const isAdmin = path === '/api/v1/admin' || path.startsWith('/api/v1/admin/');
    const limits: [Map<string, RequestWindow>, number][] = [[isAdmin ? adminWindows : publicWindows, maxRequests]];
    if (req.method === 'POST' && path === '/api/v1/admin/auth/login') limits.push([loginWindows, 5]);

    // 요청 시 세 영역의 만료 항목을 정리해 오래된 접속 주소를 제거
    for (const windows of [publicWindows, adminWindows, loginWindows]) {
      for (const [address, window] of windows) {
        if (window.expiresAt <= time) windows.delete(address);
      }
    }
    // 위조 가능한 X-Forwarded-For 대신 실제 TCP 접속 주소만 신뢰한다.
    const address = req.socket.remoteAddress ?? 'unknown';
    for (const [windows, limit] of limits) {
      let window = windows.get(address);
      if (!window && windows.size < maxAddresses) {
        window = { count: 0, expiresAt: time + duration };
        windows.set(address, window);
      }
      // 영역별 주소 상한과 호출 한도를 확인하고 초과 시 재시도 시각 안내
      if (!window || window.count >= limit) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(((window?.expiresAt ?? time + duration) - time) / 1000))));
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ code: 'TOO_MANY_REQUESTS', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }));
        return;
      }
      window.count += 1;
    }

    // 검색과 관리자 상태 변경은 JSON 본문만 허용
    if (req.method === 'POST' && (path === '/api/v1/policies/search' || isAdmin)
      && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
      res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'JSON 형식으로 요청해 주세요.' }));
      return;
    }
    next();
  };
}
