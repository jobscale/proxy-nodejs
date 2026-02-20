import http from 'http';
import https from 'https';
import fs from 'fs';
import { swallow, proxyConnect } from './app/index.js';

const BIND = process.env.BIND || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT, 10) || 3128;
const SPORT = Number.parseInt(process.env.SPORT, 10) || 3443;

const logger = console;

const httpServer = () => {
  const server = http.createServer();
  server.on('connection', socket => socket.on('error', swallow));
  server.on('connect', proxyConnect);
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
  server.listen(SPORT, BIND, () => {
    logger.info(`HTTPS CONNECT proxy running on ${BIND}:${SPORT}`);
  });
};

const main = async () => {
  httpServer();
  httpsServer();
};

export default main();
