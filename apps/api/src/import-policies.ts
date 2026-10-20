import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IngestionService } from './modules/ingestion/services/ingestion.service';

/** HTTP 서버 없이 정책을 한 번 수집하고 성공(0)·실패(1)·중복 실행(2)을 반환한다. */
export async function importPolicies(): Promise<number> {
  let app: INestApplicationContext | undefined;
  let exitCode = 1;
  let message = '';

  try {
    // 웹 API와 같은 모듈을 사용하되 listen을 호출하지 않아 별도 포트를 열지 않는다.
    // NestJS의 초기화 오류 원문은 숨기고, 안전하게 가린 파일 로그의 대체 경고는 유지한다.
    app = await NestFactory.createApplicationContext(AppModule, {
      abortOnError: false,
      logger: ['warn'],
    });
    const result = await app.get(IngestionService).importPolicies();
    if (result.status === 'ALREADY_RUNNING') {
      exitCode = 2;
      message = '정책 수집이 이미 실행 중이므로 추가 실행을 건너뜁니다.';
    } else {
      exitCode = 0;
      const { NEW, CHANGED, UNCHANGED } = result.value;
      message = `정책 수집 완료: 신규 ${NEW}건, 변경 ${CHANGED}건, 동일 ${UNCHANGED}건.`;
    }
  } catch {
    // 예외 메시지·스택에는 인증키·접속 정보·SQL이 섞일 수 있어 그대로 출력하지 않는다.
    exitCode = 1;
    message = '정책 수집에 실패했습니다. 수집 로그와 환경변수·DB 설정을 확인하세요.';
  } finally {
    // 수집 서비스가 잠금·전용 연결을 반환한 뒤, CLI가 만든 DB 연결 풀까지 닫는다.
    if (app) {
      try {
        await app.close();
      } catch {
        exitCode = 1;
        message = '정책 수집 애플리케이션 자원 정리에 실패했습니다. 수집 로그와 DB 연결 상태를 확인하세요.';
      }
    }
  }

  // 연결 정리까지 끝난 후에만 최종 결과를 알린다. 정리 실패를 성공으로 표시하지 않는다.
  if (exitCode === 1) console.error(message);
  else console.log(message);
  return exitCode;
}

// 강제 종료 대신 종료 코드만 설정해 로그 출력과 남은 자원 정리를 마친다.
if (require.main === module) {
  void importPolicies().then((exitCode) => { process.exitCode = exitCode; });
}
