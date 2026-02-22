import net from 'net';
import { allowedIp, denyDomain } from './security.js';

const JEST_TEST = Object.keys(process.env).filter(v => v.toLowerCase().match('jest')).length;

const logger = new Proxy(console, {
  get(target, property) {
    return (...args) => target[property](`[${property.toUpperCase()}]`.padEnd(8, ' '), ...args);
  },
});

const cache = {
  access: new Map(),
  TTL: 90 * 24 * 60 * 60 * 1000,
  blocking: new Map(),
  QUIET: 60 * 60 * 1000,
};
const cleanCache = () => {
  const expired = Date.now() - cache.TTL;
  for (const [host, last] of cache.access.entries()) {
    if (last < expired) cache.access.delete(host);
  }
  const quiet = Date.now() - cache.QUIET;
  for (const [host, last] of cache.blocking.entries()) {
    if (last < quiet) cache.blocking.delete(host);
  }
};

// バイパス先の HTTP プロキシ
const FORWARD_PROXY_HOST = process.env.FORWARD_PROXY_HOST || 'n100.jsx.jp';
const FORWARD_PROXY_PORT = Number.parseInt(process.env.FORWARD_PROXY_PORT || 3128, 10);

const parseError = e => {
  const [error] = e?.errors ?? [];
  if (!error) return e.toString();
  const { code, address, port } = error;
  return `${code} ${address}:${port}`;
};
export const swallow = e => ['ECONNRESET', 'EPIPE']
.includes(e?.code) || logger.error(JSON.stringify({ ts: new Date(), 'Socket error:': parseError(e) }));

export const proxyConnect = (req, clientSocket, head) => {
  clientSocket.on('error', swallow);
  const [host, port] = req.url.split(':');
  const ip = clientSocket.remoteAddress.replace(/^::ffff:/, '');
  if (!cache.access.get(host)) logger.info(JSON.stringify({ ts: new Date(), host, access: ip }));
  // cache stock or refresh
  cache.access.set(host, Date.now());
  // cache clean - 暇なときに実施
  if (!JEST_TEST) {
    clearTimeout(cache.id);
    cache.id = setTimeout(cleanCache, 60_000);
  }

  // acl IP or ドメインを拒否
  if (!allowedIp(ip) || denyDomain(host)) {
    if (!cache.blocking.get(host)) logger.warn(JSON.stringify({ ts: new Date(), host, blocking: ip }));
    // cache stock or refresh
    cache.blocking.set(host, Date.now());
    clientSocket.write(
      'HTTP/1.1 403 Forbidden\r\n' +
      'Content-Length: 0\r\n' +
      'Connection: close\r\n' +
      '\r\n',
    );
    clientSocket.end();
    return;
  }

  // パススルー・ドメインをバイパス
  if (host.endsWith('.internal.jsx.jp')) {
    const forward = net.connect(FORWARD_PROXY_PORT, FORWARD_PROXY_HOST, () => {
      // 別プロキシへ CONNECT を送る
      forward.write(
        `CONNECT ${host}:${port} HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        '\r\n',
      );
      if (head?.length) forward.write(head);

      // 応答をそのままクライアントへ返す
      forward.pipe(clientSocket);
      clientSocket.pipe(forward);
    });

    forward.on('error', swallow);
    clientSocket.on('close', () => forward.end());
    forward.on('close', () => clientSocket.end());
    return;
  }

  // 通常の CONNECT 代行
  const serverSocket = net.connect(port, host, () => {
    clientSocket.write(
      'HTTP/1.1 200 Connection Established\r\n' +
      'Dispatcher: Nodejs26.x SecurityAgent\r\n' +
      'Policy: Since 2026-02\r\n' +
      '\r\n',
    );
    if (head?.length) serverSocket.write(head);
    clientSocket.pipe(serverSocket);
    serverSocket.pipe(clientSocket);
  });

  serverSocket.on('error', swallow);
  clientSocket.on('close', () => serverSocket.end());
  serverSocket.on('close', () => clientSocket.end());
};
