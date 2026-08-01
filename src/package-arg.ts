/**
 * Registry-only replacement for npm-package-arg, adapted from get-npm-meta's
 * npa.ts (https://github.com/jinghaihan/get-npm-meta): non-registry specs
 * (git / url / file / npm alias / local paths) are rejected outright with
 * clear errors instead of being classified, since this server can only serve
 * the npm registry. Names are validated with the same validate-npm-package-name
 * package npm-package-arg itself uses.
 *
 * Registry specs keep npm-package-arg's behavior exactly — version / range /
 * tag classification via loose semver, npa's invalid-name and invalid-tag
 * error messages, and the nameless fallback for bare range-like specs (so
 * `<3.0.0` still reports "Invalid package specifier") — because all of these
 * surface verbatim in API responses.
 */
import validateNpmPackageName from 'validate-npm-package-name';
import { clean as semverClean, isValidRange } from 'verkit';

export type SpecType = 'version' | 'range' | 'tag';

export interface ParsedSpec {
  type: SpecType,
  raw: string,
  name: string | null,
  escapedName: string | null,
  scope: string | null,
  rawSpec: string,
  fetchSpec: string
}

const FILE_PROTOCOL_RE = /^file:/i;
const ALIAS_PROTOCOL_RE = /^npm:/i;
const URL_SPEC_RE = /^(?:git\+)?[a-z]+:/i;
const GIT_SSH_SPEC_RE = /^[^@]+@[^:.]+\.[^:]+:.+$/;
const LOCAL_PATH_RE = /^(?:\.{1,2}(?:[/\\]|$)|[/\\]|~[/\\]|[a-z]:[/\\])/i;

export function parsePackageArg(raw: string): ParsedSpec {
  const spec = raw.trim();

  if (!spec) {
    throw createSpecError('Package spec must be a non-empty string.', 'EINVALIDPACKAGESPEC');
  }

  assertSupportedSpec(spec);

  const { name, rawSpec } = spec[0] === '@'
    ? parseScopedPackageSpec(spec)
    : parseUnscopedPackageSpec(spec);

  if (name !== null) {
    // a version part that is itself a file / alias / url spec (pkg@file:…,
    // pkg@npm:…, pkg@https:…) is not a registry spec either
    assertSupportedSpec(rawSpec);
    validatePackageName(name, spec);
  }

  return fromRegistry({
    type: 'range',
    raw: spec,
    name,
    escapedName: name === null ? null : name.replace('/', '%2f'),
    scope: name !== null && name[0] === '@' ? name.slice(0, name.indexOf('/')) : null,
    rawSpec,
    fetchSpec: rawSpec.trim() || '*'
  });
}

function assertSupportedSpec(spec: string): void {
  if (FILE_PROTOCOL_RE.test(spec)) {
    throw createUnsupportedSpecError(spec, 'file');
  }
  if (ALIAS_PROTOCOL_RE.test(spec)) {
    throw createUnsupportedSpecError(spec, 'npm alias');
  }
  if (LOCAL_PATH_RE.test(spec)) {
    throw createUnsupportedSpecError(spec, 'local path');
  }
  if (GIT_SSH_SPEC_RE.test(spec)) {
    throw createUnsupportedSpecError(spec, 'git');
  }
  if (URL_SPEC_RE.test(spec)) {
    throw createUnsupportedSpecError(spec, 'url');
  }
}

function parseScopedPackageSpec(spec: string): { name: string | null, rawSpec: string } {
  const slashIndex = spec.indexOf('/');
  if (slashIndex <= 1 || slashIndex === spec.length - 1) {
    throw createSpecError(`Invalid scoped package spec "${spec}".`, 'EINVALIDPACKAGESPEC');
  }

  const versionSeparatorIndex = spec.indexOf('@', slashIndex + 1);
  if (versionSeparatorIndex === -1) {
    return { name: spec, rawSpec: '' };
  }

  return {
    name: spec.slice(0, versionSeparatorIndex),
    rawSpec: spec.slice(versionSeparatorIndex + 1)
  };
}

function parseUnscopedPackageSpec(spec: string): { name: string | null, rawSpec: string } {
  const versionSeparatorIndex = spec.indexOf('@');
  if (versionSeparatorIndex === -1) {
    // npm-package-arg parity: a bare spec that is not a valid package name
    // (e.g. "<3.0.0", "-") is a nameless registry spec — the server then
    // rejects it with "Invalid package specifier"
    if (validateNpmPackageName(spec).validForOldPackages) {
      return { name: spec, rawSpec: '' };
    }
    if (spec.includes('/')) {
      throw createUnsupportedSpecError(spec, 'local path');
    }
    return { name: null, rawSpec: spec };
  }

  return {
    name: spec.slice(0, versionSeparatorIndex),
    rawSpec: spec.slice(versionSeparatorIndex + 1)
  };
}

function validatePackageName(name: string, raw: string): void {
  if (name.includes('/') && name[0] !== '@') {
    throw createUnsupportedSpecError(raw, 'local path');
  }

  const valid = validateNpmPackageName(name);
  if (!valid.validForOldPackages) {
    // npm-package-arg's exact message, built from the same validator
    throw createSpecError(
      `Invalid package name "${name}" of package "${raw}": ${valid.errors.join('; ')}.`,
      'EINVALIDPACKAGENAME'
    );
  }
}

function fromRegistry(result: ParsedSpec): ParsedSpec {
  const spec = result.fetchSpec;

  // npa uses semver.valid(spec, true) — verkit has no loose mode, but its
  // loose clean() accepts the same inputs (leading '=' / 'v', whitespace)
  if (semverClean(spec, { loose: true }) !== null) {
    result.type = 'version';
  } else if (isValidRange(spec)) {
    result.type = 'range';
  } else {
    if (encodeURIComponent(spec) !== spec) {
      throw createSpecError(
        `Invalid tag name "${spec}" of package "${result.raw}": Tags may not have any characters that encodeURIComponent encodes.`,
        'EINVALIDTAGNAME'
      );
    }
    result.type = 'tag';
  }
  return result;
}

function createUnsupportedSpecError(spec: string, kind: string): Error {
  return createSpecError(
    `Unsupported ${kind} package spec "${spec}".`,
    'EUNSUPPORTEDPACKAGESPEC'
  );
}

function createSpecError(message: string, code: string): Error {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  return error;
}
