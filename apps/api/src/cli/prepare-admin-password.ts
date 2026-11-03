import { writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { TextDecoder } from 'node:util';
import { createAdminPasswordHash } from '../modules/admin/services/admin-credentials.service';

/** 비밀번호 입력 받기 -> (소유자 전용) 새 파일에 해시를 저장 */
export async function prepareAdminPassword(input: Readable, outputPath: string): Promise<void> {
  // 입력으로 받은 데이터 묶음들을 보관할 배열 
  const chunks: Buffer[] = [];
  // 입력받은 전체 바이트 수
  let size = 0;

  try {
    // 입력이 끝날 때까지 데이터 묶음을 하나씩 받음
    for await (const chunk of input) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      size += buffer.length;
      if (size > 1024) throw new Error('비밀번호 입력이 너무 깁니다.');
    }
    // 배열에 모은 입력 전체를 bytes에 저장
    const bytes = Buffer.concat(chunks);

    try {
      // 입력 전체를 UTF-8 문자열로 변환
      const password = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      // 비밀번호 문자열로 저장용 해시를 생성
      const hash = await createAdminPasswordHash(password);
      // 해시를 새 파일에 저장 (소유자만 읽기/쓰기)
      await writeFile(outputPath, `${hash}\n`, { flag: 'wx', mode: 0o600 });
    } finally {
      // 성공하거나 실패해도 합쳐 둔 입력 바이트를 0으로 덮어씀
      bytes.fill(0);
    }
  } finally {
    // 처음에 모아 둔 각 입력 묶음도 0으로 덮어씀
    for (const chunk of chunks) chunk.fill(0);
  }
}

// 이 파일을 직접 실행하면 아래 CLI 처리를 시작
if (require.main === module) {
  // 실행 명령에 지정한 해시 저장 경로를 가져옴
  const outputPath = process.argv[2];
  // 저장 경로 하나와 파이프로 전달한 입력이 있는지 확인
  if (process.argv.length !== 3 || !outputPath || process.stdin.isTTY) {
    process.stderr.write('사용법: 숨김 입력으로 비밀번호를 표준 입력에 전달하고 출력 파일 경로 하나를 지정하세요.\n');
    process.exitCode = 1;
  } else {
    // 표준 입력의 비밀번호를 읽어 지정한 파일에 해시 저장
    void prepareAdminPassword(process.stdin, outputPath).catch(() => {
      // 실패 이유를 안내하고 종료 코드를 1로 설정 (비밀값 대신 고정 문구 사용)
      process.stderr.write('해시 준비에 실패했습니다. 입력 길이와 새 파일의 저장 권한을 확인하세요.\n');
      process.exitCode = 1;
    });
  }
}
