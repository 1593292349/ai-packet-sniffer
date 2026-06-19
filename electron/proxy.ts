/**
 * MITM HTTP/HTTPS 代理服务器
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { ensureCA, signLeafCert, CAStore } from './ca';

export interface CaptureContext {
  url: string;
  method: string;
  reqHeaders: any;
  reqBody: string;
  respStatus: number | null;
  respHeaders: any;
  respBody: string;
  respCT: string | null;
  startedAt: number;
  endedAt: number;
  clientAddr: string | null;
}

export type CaptureHandler = (ctx: CaptureContext) => void;

export class MitmProxy {
  private port: number;
  public ca: CAStore;
  private userDataDir: string;
  private server: http.Server | null = null;
  private httpsServers: https.Server[] = [];
  private handler: CaptureHandler | null = null;
  private maxBodyBytes = 50 * 1024 * 1024;

  constructor(userDataDir: string, port = 7890) {
    this.userDataDir = userDataDir;
    this.port = port;
    this.ca = ensureCA(userDataDir);
  }

  getPort() {
    return this.port;
  }

  getCaCertPath() {
    return `${this.ca.dir}\\ca.crt.pem`.replace(/\\/g, '/');
  }

  getCaPem() {
    return this.ca.certPem;
  }

  setHandler(h: CaptureHandler) {
    this.handler = h;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer();
      this.server.on('request', (req, res) => this.handleHttp(req, res));
      this.server.on('connect', (req, socket: any, head) => this.handleConnect(req, socket, head));
      this.server.on('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server!.address();
        const p = typeof addr === 'object' && addr ? addr.port : this.port;
        this.port = p;
        resolve(p);
      });
    });
  }

  async stop() {
    if (this.server) {
      await new Promise<void>((r) => this.server!.close(() => r()));
      this.server = null;
    }
    for (const srv of this.httpsServers) {
      await new Promise<void>((r) => srv.close(() => r()));
    }
    this.httpsServers = [];
  }

  // ---------- HTTP ----------
  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const startedAt = Date.now();
    const fullUrl =
      req.url && /^https?:\/\//i.test(req.url) ? req.url : `http://${req.headers.host}${req.url}`;
    const reqBody = await readBody(req, this.maxBodyBytes);

    let parsed: URL | null = null;
    try {
      parsed = new URL(fullUrl);
    } catch {
      res.statusCode = 400;
      res.end('Bad URL');
      return;
    }

    const upstreamHeaders = filterHopByHopHeaders(req.headers);

    const capture: CaptureContext = {
      url: fullUrl,
      method: req.method || 'GET',
      reqHeaders: upstreamHeaders,
      reqBody,
      respStatus: null,
      respHeaders: {},
      respBody: '',
      respCT: null,
      startedAt,
      endedAt: startedAt,
      clientAddr: req.socket.remoteAddress || null,
    };

    try {
      const upReq = http.request(
        {
          method: req.method,
          hostname: parsed.hostname,
          port: parsed.port || 80,
          path: parsed.pathname + parsed.search,
          headers: upstreamHeaders,
        },
        (upRes) => {
          capture.respStatus = upRes.statusCode || 0;
          capture.respHeaders = normalizeHeaders(upRes.headers);
          capture.respCT = (upRes.headers['content-type'] as string) || null;
          res.writeHead(upRes.statusCode || 502, upRes.headers);
          const chunks: Buffer[] = [];
          upRes.on('data', (c) => {
            chunks.push(c);
            res.write(c);
          });
          upRes.on('end', () => {
            capture.respBody = Buffer.concat(chunks).toString('utf8');
            capture.endedAt = Date.now();
            res.end();
            this.emitCapture(capture);
          });
        },
      );
      upReq.on('error', (err) => {
        capture.respStatus = 502;
        capture.respBody = 'Upstream error: ' + err.message;
        capture.endedAt = Date.now();
        res.statusCode = 502;
        res.end(capture.respBody);
        this.emitCapture(capture);
      });
      if (reqBody) upReq.write(reqBody);
      upReq.end();
    } catch (e: any) {
      capture.respStatus = 502;
      capture.respBody = 'Proxy error: ' + (e?.message || String(e));
      capture.endedAt = Date.now();
      res.statusCode = 502;
      res.end(capture.respBody);
      this.emitCapture(capture);
    }
  }

  // ---------- HTTPS CONNECT ----------
  private handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) {
    const [host, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr || '443', 10);
    const hostname = host;
    if (!hostname) {
      clientSocket.destroy();
      return;
    }

    const leaf = signLeafCert(this.ca, hostname);
    const tlsOpts: tls.TlsOptions = {
      cert: leaf.cert,
      key: leaf.key,
      SNICallback: (servername, cb) => {
        try {
          const lf = signLeafCert(this.ca, servername || hostname);
          const sni = tls.createSecureContext({ cert: lf.cert, key: lf.key });
          cb(null, sni);
        } catch (e) {
          cb(e as Error, undefined);
        }
      },
    };

    const httpsSrv = https.createServer(tlsOpts, (req, res) =>
      this.handleHttps(req, res, hostname, port),
    );

    httpsSrv.on('error', () => {
      try {
        clientSocket.destroy();
      } catch {}
    });

    httpsSrv.listen(0, '127.0.0.1', () => {
      const addr = httpsSrv.address();
      const upPort = typeof addr === 'object' && addr ? addr.port : 0;
      clientSocket.write(`HTTP/1.1 200 Connection Established\r\n\r\n`);
      const upstream = net.connect(upPort, '127.0.0.1', () => {
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket as any);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    });

    this.httpsServers.push(httpsSrv);
  }

  private async handleHttps(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    hostname: string,
    port: number,
  ) {
    const startedAt = Date.now();
    const fullUrl = `https://${hostname}:${port}${req.url}`;
    const reqBody = await readBody(req, this.maxBodyBytes);
    const upstreamHeaders = filterHopByHopHeaders(req.headers);
    upstreamHeaders['host'] = `${hostname}:${port}`;

    const capture: CaptureContext = {
      url: fullUrl,
      method: req.method || 'GET',
      reqHeaders: upstreamHeaders,
      reqBody,
      respStatus: null,
      respHeaders: {},
      respBody: '',
      respCT: null,
      startedAt,
      endedAt: startedAt,
      clientAddr: req.socket.remoteAddress || null,
    };

    const upReq = https.request(
      {
        method: req.method,
        hostname,
        port,
        path: req.url,
        headers: upstreamHeaders,
        servername: hostname,
      },
      (upRes) => {
        capture.respStatus = upRes.statusCode || 0;
        capture.respHeaders = normalizeHeaders(upRes.headers);
        capture.respCT = (upRes.headers['content-type'] as string) || null;
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        const chunks: Buffer[] = [];
        upRes.on('data', (c) => {
          chunks.push(c);
          res.write(c);
        });
        upRes.on('end', () => {
          capture.respBody = Buffer.concat(chunks).toString('utf8');
          capture.endedAt = Date.now();
          res.end();
          this.emitCapture(capture);
        });
      },
    );
    upReq.on('error', (err) => {
      capture.respStatus = 502;
      capture.respBody = 'Upstream error: ' + err.message;
      capture.endedAt = Date.now();
      res.statusCode = 502;
      res.end(capture.respBody);
      this.emitCapture(capture);
    });
    if (reqBody) upReq.write(reqBody);
    upReq.end();
  }

  private emitCapture(ctx: CaptureContext) {
    if (this.handler) {
      try {
        this.handler(ctx);
      } catch (e) {
        console.error('capture handler error:', e);
      }
    }
  }
}

function filterHopByHopHeaders(h: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const hop = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'proxy-connection',
  ]);
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(h)) {
    if (hop.has(k.toLowerCase())) continue;
    out[k] = v as any;
  }
  return out;
}

function normalizeHeaders(h: http.IncomingHttpHeaders): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v == null) out[k] = undefined;
    else if (Array.isArray(v)) out[k] = v.map(String);
    else if (typeof v === 'number') out[k] = String(v);
    else out[k] = String(v);
  }
  return out;
}

function readBody(stream: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    stream.on('data', (c: Buffer) => {
      total += c.length;
      if (total > max) {
        const allowed = c.length - (total - max);
        if (allowed > 0) chunks.push(c.slice(0, allowed));
        truncated = true;
      } else {
        chunks.push(c);
      }
    });
    stream.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      resolve(truncated ? s + '\n[... truncated ...]' : s);
    });
    stream.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}