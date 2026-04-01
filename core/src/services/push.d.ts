export function sendPushooMessage(options: {
  channel: string;
  endpoint?: string;
  token?: string;
  title: string;
  content: string;
  custom_headers?: string;
  custom_body?: string;
}): Promise<{ ok?: boolean; msg?: string } | null>;
