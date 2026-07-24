// Spike driver: exercise create-screenplay / edit-autosave / upload-PDF / export
// against the running spike API, with a manual cookie jar + CSRF handling.
const path = require('node:path');
const apiRequire = require('node:module').createRequire(
  path.join(__dirname, '..', 'apps', 'api', 'package.json'),
);
const { PDFDocument } = apiRequire('pdf-lib');

const BASE = 'http://localhost:3000';
const jar = new Map();
function setCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function call(method, url, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (jar.size) headers['cookie'] = cookieHeader();
  const csrf = jar.get('coda_csrf');
  if (csrf && !['GET', 'HEAD'].includes(method)) headers['x-coda-csrf'] = csrf;
  if (body !== undefined && !(body instanceof Buffer)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${url}`, { method, headers, body });
  setCookies(res);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function main() {
  // 0. setup owner (bypassing the token ceremony with a known static SETUP_TOKEN)
  let r = await call('POST', '/api/v1/setup/owner',
    { displayName: 'Spike Owner', email: 'director@spike.local', password: 'ZephyrCitadel2026!' },
    { 'x-coda-setup-token': 'spike-setup-token-0000000000000000' });
  record('setup owner + session', r.status === 201 || r.status === 200, `HTTP ${r.status}`);
  if (!(r.status === 200 || r.status === 201)) return finish(JSON.stringify(r.json));

  // 1. create screenplay
  r = await call('POST', '/api/v1/screenplays', { title: 'Spike Screenplay', sourceText: 'INT. ROOM - DAY\n\nA test.' });
  const sp = r.json.data;
  record('create screenplay', r.status === 201 && !!sp?.id, `id=${sp?.id} v=${sp?.version}`);

  // 2. edit / autosave (PATCH with optimistic version)
  r = await call('PATCH', `/api/v1/screenplays/${sp.id}`,
    { sourceText: 'INT. ROOM - DAY\n\nAUTOSAVED revision.\n\n= a note', version: sp.version });
  record('edit/autosave screenplay', r.status === 200, `HTTP ${r.status} newV=${r.json?.data?.version}`);

  // 3. export .fountain
  r = await call('GET', `/api/v1/screenplays/${sp.id}/export.fountain`);
  const exported = typeof r.json === 'string' ? r.json : JSON.stringify(r.json);
  record('export screenplay .fountain', r.status === 200 && exported.includes('AUTOSAVED'),
    `${exported.length} bytes`);

  // 4. PDF upload flow — needs a project
  r = await call('POST', '/api/v1/projects', { name: 'Spike Project' });
  const project = r.json.data;
  record('create project', r.status === 201 && !!project?.id, `id=${project?.id}`);

  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]).drawText('Spike source doc');
  const pdfBytes = Buffer.from(await pdf.save());

  r = await call('POST', '/api/v1/uploads', {
    kind: 'source_document', filename: 'spike.pdf', mimeType: 'application/pdf',
    sizeBytes: pdfBytes.length, projectId: project.id,
  });
  const upload = r.json.data;
  record('createUpload (presign)', r.status === 201 && !!upload?.uploadUrl,
    `key implied, url host=${upload?.uploadUrl ? new URL(upload.uploadUrl).host : 'n/a'}`);
  if (!upload?.uploadUrl) return finish(JSON.stringify(r.json));

  // 5. direct PUT to the presigned URL (this is what the browser does)
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT', headers: { 'content-type': 'application/pdf', 'if-none-match': '*' }, body: pdfBytes,
  });
  record('direct PUT to presigned URL', put.ok, `HTTP ${put.status}`);

  // 6. complete upload (server HEADs the object + checks PDF signature)
  r = await call('POST', `/api/v1/projects/${project.id}/uploads/${upload.id}/complete`, { version: upload.version });
  record('completeUpload (HEAD + %PDF- check)', r.status === 201, `HTTP ${r.status} status=${r.json?.data?.status}`);

  // 7. register source document (triggers PDF page-count worker reading the object)
  r = await call('POST', `/api/v1/projects/${project.id}/source-documents`, { storageObjectId: upload.id, title: 'Spike Doc' });
  record('create source-document (page count)', r.status === 201, `HTTP ${r.status} pages=${r.json?.data?.pageCount}`);

  // 8. read-back signed URL + GET the bytes
  r = await call('GET', `/api/v1/projects/${project.id}/storage-objects/${upload.id}/content`);
  const readUrl = r.json?.data?.url;
  let getOk = false;
  if (readUrl) { const g = await fetch(readUrl); getOk = g.ok; }
  record('readUrl + GET object bytes', getOk, readUrl ? `host=${new URL(readUrl).host}` : 'no url');

  finish();
}

function finish(err) {
  if (err) console.log('ABORTED:', err);
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n==== ${pass}/${results.length} steps passed ====`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
