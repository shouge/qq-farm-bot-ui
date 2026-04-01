export class MiniProgramLoginSession {
  static requestLoginCode(options?: { apiDomain?: string }): Promise<any>;
  static queryStatus(code: string, options?: { apiDomain?: string }): Promise<any>;
  static getAuthCode(ticket: string, appid: string, options?: { apiDomain?: string }): Promise<string>;
}
