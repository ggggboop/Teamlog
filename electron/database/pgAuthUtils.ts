import crypto from 'crypto';

const PWD_SALT = 'teamlog';

export function hashTeamlogPassword(pw: string): string {
  return crypto.createHash('sha256').update(pw + PWD_SALT, 'utf8').digest('hex');
}
