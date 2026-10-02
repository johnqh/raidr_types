import { describe, expect, it } from 'vitest';
import {
  cookieValue,
  extractCredential,
  isBridgeRequest,
  isBridgeResponse,
  matchesPathTemplate,
  RAIDR_BRIDGE_APP,
  RAIDR_BRIDGE_EXTENSION,
} from './index';

describe('extractCredential', () => {
  it('bearer: drops the prefix, any header case', () => {
    expect(
      extractCredential(
        { Authorization: 'Bearer eyJ.abc' },
        { style: 'bearer' }
      )
    ).toBe('eyJ.abc');
    expect(
      extractCredential(
        { authorization: 'bearer eyJ.abc' },
        { style: 'bearer' }
      )
    ).toBe('eyJ.abc');
    expect(
      extractCredential({ authorization: 'Basic x' }, { style: 'bearer' })
    ).toBeNull();
    expect(extractCredential({}, { style: 'bearer' })).toBeNull();
  });
  it('header: named header, optional prefix', () => {
    const auth = {
      style: 'header' as const,
      headerName: 'X-Auth-Token',
      tokenPrefix: 'Token ',
    };
    expect(extractCredential({ 'x-auth-token': 'Token t1' }, auth)).toBe('t1');
    expect(extractCredential({ 'x-auth-token': 't1' }, auth)).toBeNull();
  });
  it('cookie: one cookie out of the Cookie header', () => {
    const auth = { style: 'cookie' as const, cookieName: '__session' };
    expect(extractCredential({ cookie: 'a=1; __session=s.v; b=2' }, auth)).toBe(
      's.v'
    );
    expect(extractCredential({ cookie: 'a=1' }, auth)).toBeNull();
    expect(cookieValue('x=; y=2', 'x')).toBeNull();
  });
  it('never returns placeholders or anonymous values', () => {
    expect(
      extractCredential({ authorization: 'Bearer null' }, { style: 'bearer' })
    ).toBeNull();
    expect(
      extractCredential(
        { authorization: 'Bearer <JWT:a1b2>' },
        { style: 'bearer' }
      )
    ).toBeNull();
    expect(
      extractCredential({ authorization: 'Bearer x' }, { style: 'none' })
    ).toBeNull();
  });
});

describe('matchesPathTemplate', () => {
  it('matches params per segment, ignores query and trailing slash', () => {
    expect(
      matchesPathTemplate('/api/clip/{clip_id}', '/api/clip/abc?x=1')
    ).toBe(true);
    expect(matchesPathTemplate('/api/me/', '/api/me')).toBe(true);
    expect(
      matchesPathTemplate('/api/clip/{clip_id}', '/api/clip/abc/more')
    ).toBe(false);
    expect(matchesPathTemplate('/api/clip/{clip_id}', '/api/clips/abc')).toBe(
      false
    );
  });
});

describe('bridge guards', () => {
  it('tell the two directions apart', () => {
    const ping = { source: RAIDR_BRIDGE_APP, type: 'ping', id: '1' };
    const pong = {
      source: RAIDR_BRIDGE_EXTENSION,
      type: 'pong',
      id: '1',
      version: '1',
    };
    expect(isBridgeRequest(ping)).toBe(true);
    expect(isBridgeResponse(ping)).toBe(false);
    expect(isBridgeResponse(pong)).toBe(true);
    expect(isBridgeRequest(null)).toBe(false);
  });
});
