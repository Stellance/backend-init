import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type EnvVars, NodeEnv } from '../config/env.validation.js';
import type { MailMessage, Mailer } from './mailer.js';

/**
 * Default transport. Outside production it prints the message so links can be
 * followed locally. In production it drops the message: bodies carry bearer
 * tokens and must not reach logs.
 */
@Injectable()
export class LoggingMailer implements Mailer {
  private readonly logger = new Logger(LoggingMailer.name);
  private readonly production: boolean;

  constructor(config: ConfigService<EnvVars, true>) {
    this.production =
      config.get('NODE_ENV', { infer: true }) === NodeEnv.Production;
  }

  send(message: MailMessage): Promise<void> {
    if (this.production) {
      this.logger.error(
        `No mail transport configured; dropped "${message.subject}"`,
      );
    } else {
      this.logger.log(
        `mail to ${message.to}: ${message.subject}\n${message.text}`,
      );
    }
    return Promise.resolve();
  }
}
