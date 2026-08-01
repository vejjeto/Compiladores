const http = require('http');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = process.env.FRONTEND_PORT || 8080;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);

  const resolvedPath = path.resolve(filePath);
  const rootPath = path.resolve(__dirname);
  if (!resolvedPath.startsWith(rootPath + path.sep) && resolvedPath !== rootPath) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
          if (e) {
            res.writeHead(500);
            res.end('Error del servidor');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(d);
        });
      } else {
        res.writeHead(500);
        res.end('Error del servidor');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const httpServer = http.createServer(serveStatic);
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Frontend HTTP → http://0.0.0.0:${HTTP_PORT}`);
  console.log(`Abra http://localhost:${HTTP_PORT} desde esta PC o http://IP_DE_ESTA_PC:${HTTP_PORT} desde otra`);
});
