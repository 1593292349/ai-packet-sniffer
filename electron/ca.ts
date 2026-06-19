/**
 * CA 证书模块
 * 启动时在 userData/ca/ 下生成或加载根证书，用于签发叶子证书做 HTTPS MITM。
 */
import * as forge from 'node-forge';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CAStore {
  certPem: string;
  keyPem: string;
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
  dir: string;
}

export function getCaDir(userDataDir: string): string {
  return path.join(userDataDir, 'ca');
}

export function getCaPaths(userDataDir: string) {
  const dir = getCaDir(userDataDir);
  return {
    dir,
    cert: path.join(dir, 'ca.crt.pem'),
    key: path.join(dir, 'ca.key.pem'),
  };
}

/**
 * 加载已有 CA，不存在则生成新的自签根证书。
 */
export function ensureCA(userDataDir: string): CAStore {
  const paths = getCaPaths(userDataDir);
  fs.mkdirSync(paths.dir, { recursive: true });

  if (fs.existsSync(paths.cert) && fs.existsSync(paths.key)) {
    const certPem = fs.readFileSync(paths.cert, 'utf8');
    const keyPem = fs.readFileSync(paths.key, 'utf8');
    const cert = forge.pki.certificateFromPem(certPem);
    const caKey = forge.pki.privateKeyFromPem(keyPem);
    return { certPem, keyPem, cert, key: caKey, dir: paths.dir };
  }

  const pair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  cert.serialNumber = '01' + Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);

  const attrs = [
    { name: 'commonName', value: 'AI Packet Sniffer Root CA' },
    { name: 'countryName', value: 'CN' },
    { name: 'organizationName', value: 'AI Packet Sniffer' },
    { name: 'organizationalUnitName', value: 'MITM Proxy' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
      digitalSignature: true,
      critical: true,
    },
    { name: 'subjectKeyIdentifier' },
  ]);

  cert.sign(pair.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(pair.privateKey);

  fs.writeFileSync(paths.cert, certPem);
  fs.writeFileSync(paths.key, keyPem);

  return { certPem, keyPem, cert, key: pair.privateKey, dir: paths.dir };
}

/**
 * 为目标主机签发短期叶子证书。
 */
export function signLeafCert(ca: CAStore, hostname: string): { cert: string; key: string } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02' + Date.now().toString(16) + Math.floor(Math.random() * 1e6).toString(16);
  cert.validity.notBefore = new Date(Date.now() - 60 * 1000);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  cert.setSubject([
    { name: 'commonName', value: hostname },
    { name: 'countryName', value: 'CN' },
    { name: 'organizationName', value: 'AI Packet Sniffer Leaf' },
  ]);
  cert.setIssuer(ca.cert.subject.attributes);

  const altNames: { type: number; value: string }[] = [{ type: 2, value: hostname }];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) === false) {
    altNames.push({ type: 2, value: '*.' + hostname });
  }
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
      critical: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
      clientAuth: true,
    },
    { name: 'subjectAltName', altNames },
    { name: 'subjectKeyIdentifier' },
  ]);

  cert.sign(ca.key, forge.md.sha256.create());
  return {
    cert: forge.pki.certificateToPem(cert),
    key: forge.pki.privateKeyToPem(keys.privateKey),
  };
}