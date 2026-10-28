import { Global, Module } from '@nestjs/common';
import { LoggingMailer } from './logging.mailer.js';
import { Mailer } from './mailer.js';

@Global()
@Module({
  providers: [{ provide: Mailer, useClass: LoggingMailer }],
  exports: [Mailer],
})
export class MailModule {}
