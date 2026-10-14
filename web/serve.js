/* 暴打土豆 · 本地静态服务器（零依赖，只为了让 iPhone 同 WiFi 能访问）
 *   node serve.js           默认 8765 端口
 *   $env:PORT=9000; node serve.js
 * 支持 Range 请求（iOS Safari 播音频会发 Range，不实现会偶发不出声）。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.wav':  'audio/wav',
  '.mp3':  'audio/mpeg',
  '.txt':  'text/plain; charset=utf-8'
};

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

const server = http.createServer(function (req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { return send(res, 400, 'text/plain; charset=utf-8', '400'); }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) return send(res, 403, 'text/plain; charset=utf-8', '403');

  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) {
      return send(res, 404, 'text/plain; charset=utf-8', '404 Not Found: ' + urlPath);
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;

    if (range && /^bytes=/.test(range)) {
      const parts = range.replace(/^bytes=/, '').split('-');
      let start = parts[0] ? parseInt(parts[0], 10) : 0;
      let end = parts[1] ? parseInt(parts[1], 10) : st.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      if (start > end) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start: start, end: end }).pipe(res);
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', function () {
  const addrs = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (name) {
    (ifs[name] || []).forEach(function (a) {
      if (a.family === 'IPv4' && !a.internal) addrs.push(a.address);
    });
  });
  console.log('');
  console.log('  暴打土豆 网页版 已启动');
  console.log('  ------------------------------------------------');
  console.log('  电脑自己试玩 :  http://localhost:' + PORT + '/');
  console.log('  自检页       :  http://localhost:' + PORT + '/devtools.html');
  addrs.forEach(function (ip) {
    console.log('  手机（同 WiFi）:  http://' + ip + ':' + PORT + '/');
  });
  if (!addrs.length) console.log('  （没检测到局域网 IP，手机可能连不上）');
  console.log('  ------------------------------------------------');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
