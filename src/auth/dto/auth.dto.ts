import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;
}

export class LoginDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @ApiProperty({ minLength: 20, maxLength: 200 })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token from the reset email' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token from the verification email' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;
}

export class AuthTokensDto {
  @ApiProperty({ description: 'Short-lived JWT for the Authorization header' })
  accessToken: string;

  @ApiProperty({ description: 'Opaque single-use token for /auth/refresh' })
  refreshToken: string;

  @ApiProperty({ enum: ['Bearer'] })
  tokenType: 'Bearer';

  @ApiProperty({
    description: 'Access token lifetime in seconds',
    example: 900,
  })
  expiresIn: number;
}

export class MeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ enum: ['user', 'admin'] })
  role: string;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}
