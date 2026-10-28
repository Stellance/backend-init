import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEndpoint } from '../common/api-endpoint.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import type { AuthUser } from './auth-user.js';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public } from './decorators.js';
import {
  AuthTokensDto,
  ForgotPasswordDto,
  LoginDto,
  MeDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';

// 5 attempts burst, then one every 12 seconds, per IP.
const CREDENTIAL_BUCKET = { capacity: 5, refillPerSec: 1 / 12 };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @ApiEndpoint({
    summary: 'Register an account',
    description:
      'Creates a user with the default role and returns a fresh token pair. Email is trimmed and lower-cased.',
    message: 'Registered',
    status: HttpStatus.CREATED,
    type: AuthTokensDto,
    errors: [
      HttpStatus.BAD_REQUEST,
      HttpStatus.CONFLICT,
      HttpStatus.TOO_MANY_REQUESTS,
    ],
  })
  @Public()
  @RateLimit(CREDENTIAL_BUCKET)
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthTokensDto> {
    return this.auth.register(dto);
  }

  @ApiEndpoint({
    summary: 'Log in',
    description:
      'Exchanges email and password for a token pair. Failures are audited and return the same error whether the email or the password was wrong.',
    message: 'Logged in',
    type: AuthTokensDto,
    errors: [
      HttpStatus.BAD_REQUEST,
      HttpStatus.UNAUTHORIZED,
      HttpStatus.TOO_MANY_REQUESTS,
    ],
  })
  @Public()
  @RateLimit(CREDENTIAL_BUCKET)
  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthTokensDto> {
    return this.auth.login(dto);
  }

  @ApiEndpoint({
    summary: 'Rotate tokens',
    description:
      'Exchanges a refresh token for a new pair and invalidates the old one. Reusing a rotated token revokes the whole token family.',
    message: 'Tokens refreshed',
    type: AuthTokensDto,
    errors: [
      HttpStatus.BAD_REQUEST,
      HttpStatus.UNAUTHORIZED,
      HttpStatus.TOO_MANY_REQUESTS,
    ],
  })
  @Public()
  @RateLimit({ capacity: 10, refillPerSec: 1 / 6 })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto): Promise<AuthTokensDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiEndpoint({
    summary: 'Log out',
    description:
      'Revokes the given refresh token. Succeeds even if the token is unknown. Access tokens of the session are revoked immediately.',
    message: 'Logged out',
    status: HttpStatus.NO_CONTENT,
    errors: [HttpStatus.BAD_REQUEST, HttpStatus.TOO_MANY_REQUESTS],
  })
  @Public()
  @RateLimit({ capacity: 10, refillPerSec: 1 / 6 })
  @Post('logout')
  logout(@Body() dto: RefreshDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiEndpoint({
    summary: 'Log out everywhere',
    description:
      'Revokes every refresh token of the caller and ends all their sessions, including the access token used for this call.',
    message: 'Logged out everywhere',
    status: HttpStatus.NO_CONTENT,
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS],
  })
  @ApiBearerAuth()
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.logoutAll(user.id);
  }

  @ApiEndpoint({
    summary: 'Request a password reset',
    description:
      'Emails a single-use reset link valid for 1 hour if the account exists. The response is identical either way.',
    message: 'If the account exists, a reset email has been sent',
    status: HttpStatus.ACCEPTED,
    errors: [HttpStatus.BAD_REQUEST, HttpStatus.TOO_MANY_REQUESTS],
  })
  @Public()
  @RateLimit(CREDENTIAL_BUCKET)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto): void {
    this.auth.requestPasswordReset(dto.email);
  }

  @ApiEndpoint({
    summary: 'Reset a password',
    description:
      'Sets a new password using the emailed token, then ends every session of the account. Tokens are single-use.',
    message: 'Password reset',
    errors: [HttpStatus.BAD_REQUEST, HttpStatus.TOO_MANY_REQUESTS],
  })
  @Public()
  @RateLimit(CREDENTIAL_BUCKET)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @ApiEndpoint({
    summary: 'Verify an email address',
    description: 'Confirms the address using the emailed single-use token.',
    message: 'Email verified',
    errors: [HttpStatus.BAD_REQUEST, HttpStatus.TOO_MANY_REQUESTS],
  })
  @Public()
  @RateLimit(CREDENTIAL_BUCKET)
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.auth.verifyEmail(dto.token);
  }

  @ApiEndpoint({
    summary: 'Resend the verification email',
    description:
      'Emails a fresh verification link, replacing any pending one. Does nothing if the address is already verified.',
    message: 'Verification email requested',
    status: HttpStatus.ACCEPTED,
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS],
  })
  @ApiBearerAuth()
  @RateLimit(CREDENTIAL_BUCKET)
  @Post('resend-verification')
  resendVerification(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.resendVerification(user.id);
  }

  @ApiEndpoint({
    summary: 'Get the current user',
    description:
      'Returns the profile of the caller identified by the bearer token.',
    message: 'Profile retrieved',
    type: MeDto,
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS],
  })
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }
}
