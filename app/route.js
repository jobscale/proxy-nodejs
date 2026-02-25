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

export const router = (req, res) => {
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
