import { jest } from '@jest/globals';

const logger = console;

// ---- net モジュールをモック ----
// コールバックは setImmediate で遅延させることで const 変数の TDZ を回避する
const makeSocketMock = () => ({
  write: jest.fn(),
  pipe: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
});

let mockForwardSocket;
let mockServerSocket;

jest.unstable_mockModule('net', () => ({
  default: {
    connect: jest.fn((port, host, cb) => {
      // ソケットを先に返してから cb を実行
      setImmediate(cb);
      return mockForwardSocket ?? mockServerSocket;
    }),
  },
}));

// ---- security.js をモック ----
jest.unstable_mockModule('../app/security.js', () => ({
  allowedIp: jest.fn(),
  denyDomain: jest.fn(),
}));

// dynamic import (モック後に読み込む)
const { default: net } = await import('net');
const { allowedIp, denyDomain } = await import('../app/security.js');
const { swallow, proxyConnect } = await import('../app/index.js');

// ---- ヘルパー ----
const makeClient = (remoteAddress = '10.0.0.1') => ({
  remoteAddress,
  write: jest.fn(),
  end: jest.fn(),
  pipe: jest.fn(),
  on: jest.fn(),
});
const makeReq = (url = 'example.com:443') => ({ url });

// =============================================================
describe('swallow', () => {
  beforeEach(() => jest.spyOn(logger, 'error').mockImplementation(() => { }));
  afterEach(() => jest.restoreAllMocks());

  it('ECONNRESET は黙殺して true を返す', () => {
    expect(swallow({ code: 'ECONNRESET' })).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('EPIPE は黙殺して true を返す', () => {
    expect(swallow({ code: 'EPIPE' })).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('その他のエラーは logger.error を呼ぶ', () => {
    swallow({ code: 'ECONNREFUSED', toString: () => 'ECONNREFUSED' });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('errors 配列があれば code/address/port を含む文字列を出力', () => {
    swallow({
      code: 'ENOENT',
      errors: [{ code: 'ENOENT', address: '1.2.3.4', port: 80 }],
      toString: () => 'ENOENT',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const arg = logger.error.mock.calls[0][1];
    expect(arg).toMatch('ENOENT');
  });
});

// =============================================================
describe('proxyConnect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockForwardSocket = makeSocketMock();
    mockServerSocket = makeSocketMock();
    allowedIp.mockReturnValue(true);
    denyDomain.mockReturnValue(false);
  });

  // ---- ACL 拒否 ----
  describe('ACL ブロック', () => {
    it('IP が許可されていない場合は 403 を返してソケットを閉じる', () => {
      allowedIp.mockReturnValue(false);
      const client = makeClient('8.8.8.8');
      proxyConnect(makeReq(), client, null);

      expect(client.write).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));
      expect(client.end).toHaveBeenCalled();
    });

    it('ドメインが拒否リストにある場合は 403 を返してソケットを閉じる', () => {
      denyDomain.mockReturnValue(true);
      const client = makeClient('10.0.0.1');
      proxyConnect(makeReq('blocked.example.com:443'), client, null);

      expect(client.write).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));
      expect(client.end).toHaveBeenCalled();
    });

    it('403 応答後に net.connect は呼ばれない', () => {
      allowedIp.mockReturnValue(false);
      proxyConnect(makeReq(), makeClient('8.8.8.8'), null);
      expect(net.connect).not.toHaveBeenCalled();
    });
  });

  // ---- フォワードプロキシ (.internal.jsx.jp) ----
  describe('フォワードプロキシ経由 (.internal.jsx.jp)', () => {
    beforeEach(() => {
      // フォワードプロキシ用: connect が mockForwardSocket を返すように設定
      net.connect.mockImplementation((port, host, cb) => {
        setImmediate(cb);
        return mockForwardSocket;
      });
    });

    it('別プロキシへ CONNECT リクエストを転送する', async () => {
      const client = makeClient('10.0.0.1');
      proxyConnect(makeReq('app.internal.jsx.jp:443'), client, null);

      await new Promise(r => { setImmediate(r); });

      expect(mockForwardSocket.write).toHaveBeenCalledWith(
        expect.stringContaining('CONNECT app.internal.jsx.jp:443 HTTP/1.1'),
      );
    });

    it('head があれば転送ソケットへ書き込む', async () => {
      const client = makeClient('10.0.0.1');
      const head = Buffer.from('HEAD');
      proxyConnect(makeReq('app.internal.jsx.jp:443'), client, head);

      await new Promise(r => { setImmediate(r); });

      expect(mockForwardSocket.write).toHaveBeenCalledWith(head);
    });

    it('head が空の場合は Buffer を追加 write しない', async () => {
      const client = makeClient('10.0.0.1');
      proxyConnect(makeReq('app.internal.jsx.jp:443'), client, null);

      await new Promise(r => { setImmediate(r); });

      // write の呼び出しはすべて文字列のみ（Buffer の呼び出しはない）
      const bufferCalls = mockForwardSocket.write.mock.calls.filter(([v]) => Buffer.isBuffer(v));
      expect(bufferCalls).toHaveLength(0);
    });

    it('pipe でデータを双方向に中継する', async () => {
      const client = makeClient('10.0.0.1');
      proxyConnect(makeReq('app.internal.jsx.jp:443'), client, null);

      await new Promise(r => { setImmediate(r); });

      expect(mockForwardSocket.pipe).toHaveBeenCalledWith(client);
      expect(client.pipe).toHaveBeenCalledWith(mockForwardSocket);
    });

    it('net.connect はフォワードプロキシのホスト/ポートで呼ばれる', () => {
      proxyConnect(makeReq('app.internal.jsx.jp:443'), makeClient(), null);
      expect(net.connect).toHaveBeenCalledWith(
        expect.anything(), // FORWARD_PROXY_PORT
        expect.anything(), // FORWARD_PROXY_HOST
        expect.any(Function),
      );
    });
  });

  // ---- 通常の CONNECT 代行 ----
  describe('通常の CONNECT 代行', () => {
    beforeEach(() => {
      net.connect.mockImplementation((port, host, cb) => {
        setImmediate(cb);
        return mockServerSocket;
      });
    });

    it('200 Connection Established をクライアントへ送信', async () => {
      const client = makeClient('10.0.0.1');
      proxyConnect(makeReq('example.com:443'), client, null);

      await new Promise(r => { setImmediate(r); });

      expect(client.write).toHaveBeenCalledWith(
        expect.stringContaining('200 Connection Established'),
      );
    });

    it('head があればサーバーソケットへ書き込む', async () => {
      const client = makeClient('10.0.0.1');
      const head = Buffer.from('HEAD');
      proxyConnect(makeReq('example.com:443'), client, head);

      await new Promise(r => { setImmediate(r); });

      expect(mockServerSocket.write).toHaveBeenCalledWith(head);
    });

    it('head が空の場合はサーバーソケットへ write しない', async () => {
      const client = makeClient('10.0.0.1');
      proxyConnect(makeReq('example.com:443'), client, null);

      await new Promise(r => { setImmediate(r); });

      expect(mockServerSocket.write).not.toHaveBeenCalled();
    });

    it('pipe でデータを双方向に中継する', async () => {
      const client = makeClient('10.0.0.1');
      proxyConnect(makeReq('example.com:443'), client, null);

      await new Promise(r => { setImmediate(r); });

      expect(client.pipe).toHaveBeenCalledWith(mockServerSocket);
      expect(mockServerSocket.pipe).toHaveBeenCalledWith(client);
    });

    it('接続先ポートとホストが正しく net.connect に渡される', () => {
      proxyConnect(makeReq('target.example.com:8443'), makeClient(), null);
      expect(net.connect).toHaveBeenCalledWith('8443', 'target.example.com', expect.any(Function));
    });

    it('レスポンスヘッダに Dispatcher と Policy が含まれる', async () => {
      const client = makeClient();
      proxyConnect(makeReq('example.com:443'), client, null);

      await new Promise(r => { setImmediate(r); });

      const written = client.write.mock.calls[0][0];
      expect(written).toMatch('Dispatcher: Nodejs26.x SecurityAgent');
      expect(written).toMatch('Policy: Since 2026-02');
    });
  });

  // ---- キャッシュ ----
  describe('キャッシュ', () => {
    beforeEach(() => {
      net.connect.mockImplementation((port, host, cb) => {
        setImmediate(cb);
        return mockServerSocket;
      });
    });

    it('初回アクセス時はアクセスログを出力する', () => {
      jest.spyOn(logger, 'info').mockImplementation(() => { });
      proxyConnect(makeReq('new-unique-host-xyz.example.com:443'), makeClient(), null);
      expect(logger.info).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();
    });

    it('2 回目のアクセスではログを出力しない', () => {
      jest.spyOn(logger, 'info').mockImplementation(() => { });
      const host = 'cached-unique-host-xyz.example.com:443';
      proxyConnect(makeReq(host), makeClient(), null);
      proxyConnect(makeReq(host), makeClient(), null);
      // 1 回目のみログ出力
      expect(logger.info).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();
    });
  });
});
