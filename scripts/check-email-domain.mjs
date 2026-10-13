import assert from "node:assert/strict";
import { isEmailDomainAllowed } from "../src/lib/util.ts";

// Bare name: any TLD under that name.
assert.equal(isEmailDomainAllowed("ana@acme.com", "acme"), true);
assert.equal(isEmailDomainAllowed("Ana@Acme.com.br", "acme"), true);
assert.equal(isEmailDomainAllowed("ana@gmail.com", "acme"), false);
assert.equal(isEmailDomainAllowed("ana@notacme.com", "acme"), false);
assert.equal(isEmailDomainAllowed("acme.com@gmail.com", "acme"), false);

// Full domain: exact match only.
assert.equal(isEmailDomainAllowed("ana@acme.com", "acme.com"), true);
assert.equal(isEmailDomainAllowed("ana@acme.com", "@acme.com"), true);
assert.equal(isEmailDomainAllowed("ana@acme.com.evil.io", "acme.com"), false);
assert.equal(isEmailDomainAllowed("ana@sub.acme.com", "acme.com"), false);

// Garbage in, rejected.
assert.equal(isEmailDomainAllowed("", "acme.com"), false);
assert.equal(isEmailDomainAllowed("ana@acme.com", ""), false);
assert.equal(isEmailDomainAllowed("no-at-sign", "acme"), false);

console.log("email-domain: ok");
