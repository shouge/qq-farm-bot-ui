/**
 * QR Login Utilities
 */

// Module-level regex constants
const UIN_PREFIX_REGEX = /^o0*/;

interface CookieMap {
  [key: string]: string;
}

export class CookieUtils {
  static #keyRegexCache = new Map<string, RegExp>();

  static parse(cookieStr: string): CookieMap {
    if (!cookieStr) return {};
    return cookieStr.split(';').reduce((acc: CookieMap, curr) => {
      const [key, value] = curr.split('=');
      if (key) acc[key.trim()] = value ? value.trim() : '';
      return acc;
    }, {});
  }

  static getValue(cookies: string | string[] | null | undefined, key: string): string | null {
    if (!cookies) return null;
    let cookieStr: string;
    if (Array.isArray(cookies)) cookieStr = cookies.join('; ');
    else cookieStr = String(cookies);

    let regex = this.#keyRegexCache.get(key);
    if (!regex) {
      regex = new RegExp(`(^|;\\s*)${key}=([^;]*)`);
      this.#keyRegexCache.set(key, regex);
    }
    const match = cookieStr.match(regex);
    return match ? match[2] : null;
  }

  static getUin(cookies: string | string[] | null | undefined): string | null {
    const uin = this.getValue(cookies, 'wxuin') || this.getValue(cookies, 'uin') || this.getValue(cookies, 'ptui_loginuin');
    if (!uin) return null;
    return uin.replace(UIN_PREFIX_REGEX, '');
  }
}

export class HashUtils {
  static #djb2(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash >>> 0;
  }

  static hash(str: string): number {
    return this.#djb2(str) >>> 1;
  }

  static getGTk(pskey: string): number {
    return this.#djb2(pskey) >>> 0;
  }
}
