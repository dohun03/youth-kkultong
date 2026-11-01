import crypto from 'node:crypto';
import { scryptSync } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { AdminCredentialsService, parseAdminCredentials, createAdminPasswordHash } from '../src/modules/admin/admin-credentials';
import { parseEnvironment } from '../src/common/environment';

const password = '  관리자 비밀번호 🔑  ';
const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
// 생성 함수와 독립적으로 Node 표준 함수에서 만든 고정 벡터를 사용
const stored = `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
const values = { ADMIN_USERNAME: 'reviewer', ADMIN_PASSWORD_HASH: stored };

describe('관리자 자격 설정과 비밀번호 확인', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['a', '관'.repeat(64)])('1~64자 계정을 허용하고 해시를 해석한다', (username) => {
    expect(parseAdminCredentials({ ...values, ADMIN_USERNAME: username })).toEqual({
      username, passwordHash: { salt, key: scryptSync(password, salt, 64) },
    });
  });

  it.each([undefined, null, 123, '', 'a'.repeat(65), ' reviewer', 'reviewer ', 're viewer', 're\tviewer', 're\nviewer', 're\u3000viewer'])
  ('잘못된 계정 설정은 값 노출 없이 거부한다 (%#)', (username) => {
    expect(() => parseAdminCredentials({ ...values, ADMIN_USERNAME: username }))
      .toThrow('ADMIN_USERNAME은 공백 없는 1~64자 식별자여야 합니다.');
  });

  it.each([
    undefined, null, 123, '', 'plain-secret', stored + '$extra', ` ${stored}`, stored + '\n',
    stored.replace('scrypt', 'argon2'), stored.replace('16384', '32768'), stored.replace('$8$', '$4$'),
    stored.replace('$1$', '$2$'), stored.replace('16384', '016384'), stored.replace(/=+$/, ''),
    `scrypt$16384$8$1$${Buffer.alloc(15).toString('base64')}$${Buffer.alloc(64).toString('base64')}`,
    `scrypt$16384$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(63).toString('base64')}`,
    stored.replace('ABEi', 'AB!i'), stored.replace(salt.toString('base64'), salt.toString('base64').slice(0, -3) + 'x=='),
  ])('비용이나 형식이 다른 해시는 값 노출 없이 거부한다 (%#)', (hash) => {
    expect(() => parseAdminCredentials({ ...values, ADMIN_PASSWORD_HASH: hash }))
      .toThrow('ADMIN_PASSWORD_HASH 형식이 올바르지 않습니다.');
  });

  it('다른 계정도 실제 비밀번호 계산과 고정 길이 비교를 수행한다', async () => {
    const scrypt = jest.spyOn(crypto, 'scrypt');
    const compare = jest.spyOn(crypto, 'timingSafeEqual');
    const service = new AdminCredentialsService(parseAdminCredentials(values));
    await expect(service.authenticate('unknown', password)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(scrypt).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith(expect.any(Buffer), expect.any(Buffer));
    expect(compare.mock.calls[0].map((value) => value.byteLength)).toEqual([64, 64]);
  });

  it('정상 자격은 관리자 식별자만 반환하고 공백을 그대로 비교한다', async () => {
    const service = new AdminCredentialsService(parseAdminCredentials(values));
    await expect(service.authenticate('reviewer', password)).resolves.toBe('reviewer');
    await expect(service.authenticate('reviewer', password.trim())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('계정과 비밀번호 오류는 같은 401 코드와 메시지를 반환한다', async () => {
    const service = new AdminCredentialsService(parseAdminCredentials(values));
    const responses = [];
    for (const [username, input] of [['unknown', password], ['reviewer', 'wrong'], ['unknown', 'wrong']]) {
      try { await service.authenticate(username, input); }
      catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        responses.push([(error as UnauthorizedException).getStatus(), (error as UnauthorizedException).getResponse()]);
      }
    }
    expect(responses).toEqual(Array(3).fill([401, { code: 'ADMIN_UNAUTHORIZED', message: '관리자 인증이 필요합니다.' }]));
  });

  it.each(['x', ' ', 'x'.repeat(256), '관'.repeat(256)])('비밀번호 길이 양 끝과 공백 및 한글을 허용한다 (%#)', async (input) => {
    const hash = await createAdminPasswordHash(input);
    const service = new AdminCredentialsService(parseAdminCredentials({ ...values, ADMIN_PASSWORD_HASH: hash }));
    await expect(service.authenticate('reviewer', input)).resolves.toBe('reviewer');
    await expect(service.authenticate('reviewer', input + '!')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each(['', 'x'.repeat(257)])('범위를 벗어난 비밀번호는 생성과 인증에서 거부한다 (%#)', async (input) => {
    await expect(createAdminPasswordHash(input)).rejects.toThrow('비밀번호는 1~256자여야 합니다.');
    const service = new AdminCredentialsService(parseAdminCredentials(values));
    await expect(service.authenticate('reviewer', input)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('같은 비밀번호라도 무작위 16바이트 salt로 다른 해시를 만든다', async () => {
    const hashes = await Promise.all([createAdminPasswordHash(password), createAdminPasswordHash(password)]);
    expect(hashes[0]).not.toBe(hashes[1]);
    for (const hash of hashes) {
      const credentials = parseAdminCredentials({ ...values, ADMIN_PASSWORD_HASH: hash });
      expect(credentials.passwordHash.salt.length).toBe(16);
      expect(credentials.passwordHash.key.length).toBe(64);
      await expect(new AdminCredentialsService(credentials).authenticate('reviewer', password)).resolves.toBe('reviewer');
    }
  });

  it('scrypt 내부 오류도 입력이나 설정 원문 없이 전파한다', async () => {
    jest.spyOn(crypto, 'scrypt').mockImplementation((...args: unknown[]) => {
      (args.at(-1) as (error: Error) => void)(new Error(`내부 오류 ${password} ${stored}`));
    });
    await expect(createAdminPasswordHash(password)).rejects.toThrow('관리자 비밀번호 계산에 실패했습니다.');
  });

  it('공통 환경 검증은 누락되거나 잘못된 관리자 설정을 요구하지 않는다', () => {
    const base = { DATABASE_URL: 'postgresql://tester@localhost/example' };
    const environment = parseEnvironment(base);
    expect(parseEnvironment({ ...base, ADMIN_USERNAME: '', ADMIN_PASSWORD_HASH: 'invalid' })).toEqual(environment);
    expect(environment).not.toHaveProperty('ADMIN_PASSWORD_HASH');
  });
});
