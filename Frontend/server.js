const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HTTP_PORT = 8080;
const HTTPS_PORT = 8443;
const MIME_TYPES = {
  '.html': 'text/html',
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
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);

  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(__dirname)) {
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
          res.writeHead(200, { 'Content-Type': 'text/html' });
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

// HTTP server
const httpServer = http.createServer(serveStatic);
httpServer.listen(HTTP_PORT, () => {
  console.log(`Frontend HTTP  → http://localhost:${HTTP_PORT}`);
});

// HTTPS server (solo si existen los certificados)
const certPath = path.join(__dirname, '..', 'certs', 'cert.pem');
const keyPath = path.join(__dirname, '..', 'certs', 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  const httpsServer = https.createServer(httpsOptions, serveStatic);
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`Frontend HTTPS → https://localhost:${HTTPS_PORT}`);
  });
} else {
  console.log('Certificados SSL no encontrados, solo se inició HTTP');
}
