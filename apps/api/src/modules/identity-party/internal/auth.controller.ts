import { Body, Controller, Get, Ip, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RbacGuard } from '../../../common/authz/rbac.guard';
import { RequestContext } from '../../../common/request-context';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: { email: string; password: string; displayName: string }) {
    return this.auth.register(body.email, body.password, body.displayName);
  }

  @Post('login')
  login(@Body() body: { email: string; password: string; mfaCode?: string }, @Ip() ip: string) {
    return this.auth.login(body.email, body.password, body.mfaCode, ip);
  }

  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  logout(@Body() body: { refreshToken: string }) {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(RbacGuard)
  me() {
    return this.auth.me(RequestContext.get().userId!);
  }

  @Post('mfa/enroll')
  @UseGuards(RbacGuard)
  mfaEnroll() {
    return this.auth.mfaEnroll(RequestContext.get().userId!);
  }

  @Post('mfa/verify')
  @UseGuards(RbacGuard)
  mfaVerify(@Body() body: { code: string }) {
    return this.auth.mfaVerify(RequestContext.get().userId!, body.code);
  }
}
