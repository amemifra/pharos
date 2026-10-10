'use strict';
// GHSA-86w9-cpqp-85rv local backport regression test.
// Exercises the INSTALLED dependency: package.json overrides node-forge to
// file:vendor/security-backports/node-forge-1.4.0.tgz (root regenerates the lockfile).
const assert = require('node:assert/strict');
const forge = require('node-forge');

const md = () => { const d = forge.md.sha256.create(); d.update('hello world!'); return d; };
const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 65537 });

// Valid RSA SHA256 signature is accepted.
const good = keys.privateKey.sign(md());
assert.equal(keys.publicKey.verify(md().digest().getBytes(), good), true);

// A changed message is rejected.
assert.equal(
  keys.publicKey.verify(forge.md.sha256.create().update('altered').digest().getBytes(), good),
  false
);

// Genuine signature over a malformed nested DigestInfo: the backport enforces
// exactly one DigestAlgorithm element with an empty (or absent) NULL parameter.
// This tests ASN.1 acceptance; it does NOT claim an attacker knows this private key.
const a = forge.asn1;
const seq = children => a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, children);
const oid = a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(forge.pki.oids.sha256).getBytes());
const nil = a.create(a.Class.UNIVERSAL, a.Type.NULL, false, '');
// Invalid NULL parameter: NULL with non-empty content.
const badNull = a.create(a.Class.UNIVERSAL, a.Type.NULL, false, '\u0001');
const octet = data => a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, data);
const digest = md().digest().getBytes();
const malformedAlgorithms = [
  [oid, nil, octet('garbage')], // extra element after NULL params
  [oid, octet('garbage')],      // extra non-NULL parameter element
  [oid, badNull],               // NULL parameter with invalid content
  [oid, nil, nil]               // extra NULL element
];
for (const algorithm of malformedAlgorithms) {
  const der = a.toDer(seq([seq(algorithm), octet(digest)])).getBytes();
  const malformed = keys.privateKey.sign(der, null);
  assert.throws(
    () => keys.publicKey.verify(digest, malformed),
    /valid RSASSA-PKCS1-v1_5 DigestInfo/,
    `malformed DigestAlgorithm not rejected: ${algorithm.length} elements`
  );
}

// Valid variants remain accepted: NULL optional (bare OID, or OID + empty NULL).
for (const algorithm of [[oid], [oid, nil]]) {
  const der = a.toDer(seq([seq(algorithm), octet(digest)])).getBytes();
  assert.equal(keys.publicKey.verify(digest, keys.privateKey.sign(der, null)), true);
}

console.log('forge DigestAlgorithm backport: valid SHA256/RSA accepted, changed message rejected, malformed DigestAlgorithm rejected');

