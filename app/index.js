import net from 'net';
import { allowedIp, denyDomain } from './security.js';

const logger = console;

const cache = {
  hosts: new Map(),
  TTL: 90 * 24 * 60 * 60 * 1000,
};
const cleanCache = () => {
  const expired = Date.now() - cache.TTL;
  for (const [host, last] of cache.hosts.entries()) {
    if (last < expired) cache.hosts.delete(host);
  }
};

// バイパス先の HTTP プロキシ
const FORWARD_PROXY_HOST = process.env.FORWARD_PROXY_HOST || 'n100.jsx.jp';
const FORWARD_PROXY_PORT = Number.parseInt(process.env.FORWARD_PROXY_PORT || 3128, 10);

export const swallow = e => ['ECONNRESET', 'EPIPE']
.includes(e?.code) || logger.error('Socket error:', e);

export const proxyConnect = (req, clientSocket, head) => {
  clientSocket.on('error', swallow);
  const [host, port] = req.url.split(':');
  const ip = clientSocket.remoteAddress.replace(/^::ffff:/, '');
  const exist = cache.hosts.get(host);
  if (!exist) logger.info(JSON.stringify({ host, access: ip }));
  // cache stock or refresh
  cache.hosts.set(host, Date.now());
  // cache clean - 暇なときに実施
  clearTimeout(cache.id);
  cache.id = setTimeout(cleanCache, 10_000);

  // acl IP or ドメインを拒否
  if (!allowedIp(ip) || denyDomain(host)) {
    logger.info(JSON.stringify({ host, blocking: ip, timestamp: new Date() }));
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
