import http from 'http';
import https from 'https';
import fs from 'fs';
import { swallow, proxyConnect } from './app/index.js';

const BIND = process.env.BIND || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT, 10) || 3128;
const SPORT = Number.parseInt(process.env.SPORT, 10) || 3443;

const logger = console;

const style = `<style>
:root {
  color-scheme: dark light;
}
body {
  display: grid;
  justify-content: center;
  align-items: center;
}
</style>`;

const router = (req, res) => {
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`${style}<main><h1>Special ECO System</h1></main>`);
  } else if (['/health'].includes(req.url) && ['GET', 'POST'].includes(req.method)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify('Healthy'));
  } else if (['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH'].includes(req.method)) {
    res.writeHead(405, {
      'Content-Type': 'text/html',
      'X-Method': req.method,
    });
    res.end(`${style}<main><h1>Method Not Allowed</h1></main>`);
  } else {
    res.writeHead(407, {
      'Content-Type': 'application/json',
      'X-Method': req.method,
      'Proxy-Authenticate': 'Ocean Authorizer realm="connect"',
    });
    res.end(JSON.stringify({
      code: 407, message: 'Proxy Authentication Required', method: req.method,
    }));
  }
};

const httpServer = () => {
  const server = http.createServer();
  server.on('connection', socket => socket.on('error', swallow));
  server.on('connect', proxyConnect);
  server.on('request', router);
  server.listen(PORT, BIND, () => {
    logger.info(`HTTP CONNECT proxy running on ${BIND}:${PORT}`);
  });
};

const httpsServer = () => {
  // skip https if not exists tls file
  if (!fs.existsSync('jsx.jp/privkey.pem')) return;
  const server = https.createServer({
    cert: fs.readFileSync('jsx.jp/fullchain.pem'),
    key: fs.readFileSync('jsx.jp/privkey.pem'),
    ALPNProtocols: ['http/1.1'],
  });
  server.on('connection', socket => socket.on('error', swallow));
  server.on('connect', proxyConnect);
  server.on('request', router);
  server.listen(SPORT, BIND, () => {
    logger.info(`HTTPS CONNECT proxy running on ${BIND}:${SPORT}`);
  });
};

const main = async () => {
  httpServer();
  httpsServer();
};

export default main();
