import { jest } from '@jest/globals';

// ---- fs をモック (security.js がモジュール読込時に readFileSync を呼ぶ) ----
// white-list : プライベート IP に加えて 203.0.113.0/24 を追加
// deny-domain: ads.example.com を追加
// deny-regex : -ad- を追加
jest.unstable_mockModule('fs', () => ({
  default: {
    readFileSync: jest.fn(path => {
      if (path === 'acl/white-list') return '203.0.113.0/24\n';
      if (path === 'acl/deny-domain') return 'ads.example.com\n';
      if (path === 'acl/deny-regex') return '-ad-\n';
      return '';
    }),
  },
}));

const { allowedIp, denyDomain } = await import('../app/security.js');

// =============================================================
describe('allowedIp', () => {
  // ---- プライベート IP (コード内 privateIp 固定) ----
  describe('プライベート IP は許可される', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['10.0.0.1', '10.x.x.x'],
      ['10.255.255.255', '10.x.x.x 末端'],
      ['172.16.0.1', '172.16.x.x'],
      ['172.31.255.255', '172.31.x.x 末端'],
      ['192.168.0.1', '192.168.x.x'],
      ['192.168.255.255', '192.168.x.x 末端'],
    ])('%s (%s)', ip => {
      expect(allowedIp(ip)).toBe(true);
    });
  });

  // ---- white-list に追加した CIDR ----
  describe('white-list の CIDR は許可される', () => {
    it.each([
      ['203.0.113.0', '先頭アドレス'],
      ['203.0.113.1', '中間アドレス'],
      ['203.0.113.254', '末端アドレス'],
    ])('%s (%s)', ip => {
      expect(allowedIp(ip)).toBe(true);
    });
  });

  // ---- 範囲外 ----
  describe('ホワイトリスト外の IP は拒否される', () => {
    it.each([
      ['8.8.8.8', 'Google DNS'],
      ['1.1.1.1', 'Cloudflare DNS'],
      ['203.0.112.255', '203.0.113/24 のひとつ前'],
      ['203.0.114.0', '203.0.113/24 のひとつ後'],
      ['172.15.255.255', '172.16/12 のひとつ前'],
      ['172.32.0.0', '172.16/12 のひとつ後'],
    ])('%s (%s)', ip => {
      expect(allowedIp(ip)).toBe(false);
    });
  });
});

// =============================================================
describe('denyDomain', () => {
  // ---- deny-domain (完全一致文字列) ----
  describe('deny-domain に登録されたドメインは拒否される', () => {
    it('ads.example.com は拒否', () => {
      expect(denyDomain('ads.example.com')).toBe(true);
    });
  });

  // ---- deny-regex (正規表現) ----
  describe('deny-regex にマッチするドメインは拒否される', () => {
    it.each([
      ['video-ad-server.example.com', '-ad- を含む'],
      ['my-ad-host.net', '-ad- を含む (別ドメイン)'],
    ])('%s (%s)', host => {
      expect(denyDomain(host)).toBe(true);
    });
  });

  // ---- 許可されるドメイン ----
  describe('リストに載っていないドメインは拒否されない', () => {
    it.each([
      ['example.com', '一般ドメイン'],
      ['www.example.com', 'サブドメイン'],
      ['app.internal.jsx.jp', '内部ドメイン'],
      ['google.com', 'Google'],
    ])('%s (%s)', host => {
      expect(denyDomain(host)).toBe(false);
    });
  });
});
