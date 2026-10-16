module.exports = {
  testEnvironment: 'node',
  // DB 접속 실패도 드라이버의 5초 제한과 명확한 오류로 확인한다.
  testTimeout: 15000,
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
