export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Bind a real transport to this token to send mail. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}
