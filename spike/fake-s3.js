// THROWAWAY fs-backed S3 wire shim for the spike. Speaks just enough of the S3 REST
// subset that the UNMODIFIED StorageService/StorageClientProvider exercise, so we can
// observe exactly which S3 operations the blob seam must cover. Signatures are ignored;
// objects live as plain files under ROOT. Path-style only (forcePathStyle=true).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'blobs');
const META = new Map(); // key -> { contentType, size }

function keyPath(key) {
  const p = path.join(ROOT, key);
  if (!path.resolve(p).startsWith(path.resolve(ROOT))) throw new Error('traversal');
  return p;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// URL: /{bucket}/{key...}. Bucket-only path (no key) is a bucket op.
function parse(reqUrl) {
  const u = new URL(reqUrl, 'http://placeholder');
  const parts = u.pathname.replace(/^\/+/, '').split('/');
  const bucket = parts.shift();
  const key = parts.join('/');
  return { bucket, key };
}

const server = http.createServer(async (req, res) => {
  const { key } = parse(req.url);
  const ops = [];
  try {
    if (!key) {
      // Bucket-level: HEAD (exists) / PUT (create). Always succeed.
      ops.push(`${req.method} bucket`);
      res.writeHead(200).end();
      return;
    }
    const file = keyPath(key);
    if (req.method === 'PUT') {
      const body = await readBody(req);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      META.set(key, {
        contentType: req.headers['content-type'] || 'application/octet-stream',
        size: body.length,
      });
      ops.push(`PUT ${key} (${body.length}b, ${req.headers['content-type']})`);
      res.writeHead(200, { ETag: '"spike"' }).end();
      return;
    }
    if (req.method === 'HEAD' || req.method === 'GET') {
      if (!fs.existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      const meta = META.get(key) || { contentType: 'application/octet-stream', size: fs.statSync(file).size };
      const range = req.headers['range'];
      let buf = fs.readFileSync(file);
      let status = 200;
      const headers = { 'content-type': meta.contentType };
      if (range) {
        const m = /bytes=(\d+)-(\d+)?/.exec(range);
        const start = Number(m[1]);
        const end = m[2] !== undefined ? Number(m[2]) : buf.length - 1;
        buf = buf.subarray(start, end + 1);
        status = 206;
        headers['content-range'] = `bytes ${start}-${end}/${meta.size}`;
      }
      headers['content-length'] = String(buf.length);
      ops.push(`${req.method} ${key}${range ? ' ' + range : ''}`);
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : buf);
      return;
    }
    if (req.method === 'DELETE') {
      fs.rmSync(file, { force: true });
      META.delete(key);
      ops.push(`DELETE ${key}`);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405).end();
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  } finally {
    if (ops.length) process.stdout.write(`[fake-s3] ${ops.join(', ')}\n`);
  }
});

function start(port) {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2] || 9000)).then(() => console.log('fake-s3 up'));
