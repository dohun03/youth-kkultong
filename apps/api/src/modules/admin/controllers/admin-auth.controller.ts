import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AdminIdentity, AdminLoginRequest } from '@youth-kkultong/shared';
import { adminLoginSchema, adminLogoutSchema } from '@youth-kkultong/shared';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { AdminCredentialsService } from '../services/admin-credentials.service';
import { AdminCookieService } from '../services/admin-cookie.service';
import type { AdminRequest } from '../guards/admin.guard';

/** 관리자 로그인 -> 쿠키로 인증 확인 -> 로그아웃 시 쿠키 삭제 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @Inject(AdminCredentialsService) private readonly credentials: AdminCredentialsService,
    @Inject(AdminCookieService) private readonly cookies: AdminCookieService,
  ) {}

  /** 입력 검사 -> 계정과 비밀번호 확인 -> 인증 쿠키와 관리자 정보 반환 */
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(adminLoginSchema)) body: AdminLoginRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<AdminIdentity> {
    await this.credentials.authenticate(body.username, body.password);
    const issued = this.cookies.issue();
    response.setHeader('Set-Cookie', issued.cookie);
    return issued.identity;
  }

  /** Guard에서 쿠키 확인을 마친 관리자 정보를 반환 */
  @Get('me')
  me(@Req() request: AdminRequest): AdminIdentity {
    return request.admin!;
  }

  /** 빈 JSON 본문 확인 -> 브라우저 쿠키 삭제 (쿠키가 없어도 204) */
  @Post('logout')
  @HttpCode(204)
  logout(
    @Body(new ZodValidationPipe(adminLogoutSchema)) _body: Record<string, never>,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): void {
    // 파서가 빈 입력을 {}로 바꾼 경우도 본문 누락으로 거부
    if (!request.hasJsonBody) throw new BadRequestException();
    response.setHeader('Set-Cookie', this.cookies.clear());
  }
}
