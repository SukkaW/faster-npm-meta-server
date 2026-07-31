/**
 * Pure re-implementation of the npm-package-arg@14 subset this server needs,
 * free of Node.js-only dependencies (node:path, node:os, hosted-git-info,
 * proc-log).
 *
 * Registry specs (version / range / tag) are parsed with full fidelity,
 * including npa's exact error messages, because those surface verbatim in
 * API responses. Non-registry specs (git / file / directory / remote /
 * alias) are only classified so route handlers can reject them — their
 * fetchSpec / saveSpec are not resolved against the filesystem like npa
 * does (upstream embeds server-local paths there, so exact parity is
 * impossible anyway).
 */
import { clean as semverClean, isValidRange } from 'verkit';

export type SpecType =
  | 'version'
  | 'range'
  | 'tag'
  | 'alias'
  | 'git'
  | 'file'
  | 'directory'
  | 'remote';

export interface ParsedSpec {
  type: SpecType,
  registry: boolean,
  raw: string,
  name: string | null,
  escapedName: string | null,
  scope: string | null,
  rawSpec: string,
  saveSpec: string | null,
  fetchSpec: string | null,
  gitRange?: string | null,
  gitCommittish?: string | null,
  gitSubdir?: string | null,
  subSpec?: ParsedSpec
}

const IS_URL_RE = /^(?:git\+)?[a-z]+:/i;
const IS_GIT_RE = /^[^@]+@[^:.]+\.[^:]+:.+$/;
const IS_FILE_TYPE_RE = /\.(?:tgz|tar\.gz|tar)$/i;
const IS_POSIX_FILE_RE = /^(?:\.|~\/|\/|[a-z]:)/i;
const IS_PORT_NUMBER_RE = /:\d+(?:\/|$)/;
const GIT_SCP_RE = /^git\+ssh:\/\/([^:#]+:[^#]+)(?:#(.*))?$/i;
const SCOPED_PACKAGE_RE = /^(?:@([^/]+)\/)?([^/]+)$/;
const WHITESPACE_CHAR_RE = /\s/;
const URL_PROTOCOL_RE = /^([a-z][\d+.a-z-]*:)/i;
const GIT_PROTOCOLS = new Set([
  'git:', 'git+http:', 'git+https:', 'git+rsync:', 'git+ftp:', 'git+file:', 'git+ssh:'
]);
const GIT_HOST_SHORTCUTS = new Set([
  'github:', 'gist:', 'gitlab:', 'bitbucket:', 'sourcehut:'
]);

export function parsePackageArg(arg: string): ParsedSpec {
  let name: string | undefined;
  let spec: string | undefined;

  const nameEndsAt = arg.indexOf('@', 1); // skip possible leading @
  const namePart = nameEndsAt > 0 ? arg.slice(0, nameEndsAt) : arg;
  if (IS_URL_RE.test(arg)) {
    spec = arg;
  } else if (IS_GIT_RE.test(arg)) {
    spec = `git+ssh://${arg}`;
  } else if (
    namePart[0] !== '@'
    && (namePart.includes('/') || IS_FILE_TYPE_RE.test(namePart))
  ) {
    spec = arg;
  } else if (nameEndsAt > 0) {
    name = namePart;
    spec = arg.slice(nameEndsAt + 1) || '*';
  } else if (validatePackageName(arg).length === 0) {
    name = arg;
    spec = '*';
  } else {
    spec = arg;
  }

  return resolveSpec(name, spec, arg);
}

function resolveSpec(
  name: string | undefined,
  spec: string | undefined,
  raw: string
): ParsedSpec {
  const rawSpec = spec ?? '';
  const result: ParsedSpec = {
    type: 'range',
    registry: false,
    raw,
    name: null,
    escapedName: null,
    scope: null,
    rawSpec,
    saveSpec: null,
    fetchSpec: null
  };

  if (name !== undefined) {
    setName(result, name);
  }

  if (isFileSpec(rawSpec)) {
    return fromFile(result);
  }
  if (rawSpec.toLowerCase().startsWith('npm:')) {
    return fromAlias(result);
  }

  if (isHostedGitSpec(rawSpec)) {
    result.type = 'git';
    return result;
  }
  if (rawSpec && IS_URL_RE.test(rawSpec)) {
    return fromURL(result);
  }
  if (rawSpec && (rawSpec.includes('/') || IS_FILE_TYPE_RE.test(rawSpec))) {
    return fromFile(result);
  }
  return fromRegistry(result);
}

function fromRegistry(result: ParsedSpec): ParsedSpec {
  result.registry = true;
  const spec = result.rawSpec.trim();
  result.saveSpec = null;
  result.fetchSpec = spec;

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

function fromFile(result: ParsedSpec): ParsedSpec {
  // classification only; npa would resolve fetchSpec/saveSpec against the
  // server's own filesystem here, which is meaningless for this service
  result.type = IS_FILE_TYPE_RE.test(result.rawSpec) ? 'file' : 'directory';
  return result;
}

function fromAlias(result: ParsedSpec): ParsedSpec {
  const subSpec = parsePackageArg(result.rawSpec.slice(4));
  if (subSpec.type === 'alias') {
    throw createSpecError('nested aliases not supported', 'EINVALIDSPEC');
  }
  if (!subSpec.registry) {
    throw createSpecError('aliases only work for registry deps', 'EINVALIDSPEC');
  }
  if (!subSpec.name) {
    throw createSpecError('aliases must have a name', 'EINVALIDSPEC');
  }

  result.subSpec = subSpec;
  result.registry = true;
  result.type = 'alias';
  result.saveSpec = null;
  result.fetchSpec = null;
  return result;
}

function fromURL(result: ParsedSpec): ParsedSpec {
  const rawSpec = result.rawSpec;
  result.saveSpec = rawSpec;

  if (rawSpec.toLowerCase().startsWith('git+ssh:')) {
    // scp-style git specifiers are not true URIs
    const matched = GIT_SCP_RE.exec(rawSpec);
    if (matched && !IS_PORT_NUMBER_RE.test(matched[1])) {
      result.type = 'git';
      setGitAttrs(result, matched[2]);
      result.fetchSpec = matched[1];
      return result;
    }
  }

  const protocol = URL_PROTOCOL_RE.exec(rawSpec)?.[1].toLowerCase();
  if (protocol && GIT_PROTOCOLS.has(protocol)) {
    result.type = 'git';
    const hashIndex = rawSpec.indexOf('#');
    setGitAttrs(result, hashIndex === -1 ? undefined : rawSpec.slice(hashIndex + 1));
    return result;
  }
  if (protocol === 'http:' || protocol === 'https:') {
    result.type = 'remote';
    result.fetchSpec = result.saveSpec;
    return result;
  }

  throw createSpecError(
    `Unsupported URL Type "${protocol ?? ''}": ${rawSpec}`,
    'EUNSUPPORTEDPROTOCOL'
  );
}

function setGitAttrs(result: ParsedSpec, committish: string | undefined): void {
  if (!committish) {
    result.gitCommittish = null;
    return;
  }
  for (const part of committish.split('::')) {
    if (!part.includes(':')) {
      if (result.gitRange) {
        throw createSpecError('cannot override existing semver range with a committish', 'EINVALIDSPEC');
      }
      if (result.gitCommittish) {
        throw createSpecError('cannot override existing committish with a second committish', 'EINVALIDSPEC');
      }
      result.gitCommittish = part;
      continue;
    }
    const [attribute, value] = part.split(':', 2);
    if (attribute === 'semver') {
      if (result.gitCommittish) {
        throw createSpecError('cannot override existing committish with a semver range', 'EINVALIDSPEC');
      }
      if (result.gitRange) {
        throw createSpecError('cannot override existing semver range with a second semver range', 'EINVALIDSPEC');
      }
      result.gitRange = decodeURIComponent(value);
      continue;
    }
    if (attribute === 'path') {
      if (result.gitSubdir) {
        throw createSpecError('cannot override existing path with a second path', 'EINVALIDSPEC');
      }
      result.gitSubdir = `/${value}`;
    }
  }
}

function setName(result: ParsedSpec, name: string): void {
  const errors = validatePackageName(name);
  if (errors.length > 0) {
    throw createSpecError(
      `Invalid package name "${name}" of package "${result.raw}": ${errors.join('; ')}.`,
      'EINVALIDPACKAGENAME'
    );
  }
  result.name = name;
  result.scope = name[0] === '@' ? name.slice(0, name.indexOf('/')) : null;
  // scoped packages in couch must have slash url-encoded, e.g. @foo%2Fbar
  result.escapedName = name.replace('/', '%2f');
}

function isFileSpec(spec: string): boolean {
  if (!spec) {
    return false;
  }
  if (spec.toLowerCase().startsWith('file:')) {
    return true;
  }
  return IS_POSIX_FILE_RE.test(spec);
}

// approximates hosted-git-info: git host shortcut protocols plus the bare
// `user/repo` github shorthand
function isHostedGitSpec(spec: string): boolean {
  if (!spec) {
    return false;
  }
  if (isGitHubShorthand(spec)) {
    return true;
  }
  const protocol = URL_PROTOCOL_RE.exec(spec)?.[1].toLowerCase();
  return protocol !== undefined && GIT_HOST_SHORTCUTS.has(protocol);
}

// mirrors hosted-git-info's from-url.js
function isGitHubShorthand(arg: string): boolean {
  const firstHash = arg.indexOf('#');
  const firstSlash = arg.indexOf('/');
  const secondSlash = arg.indexOf('/', firstSlash + 1);
  const firstColon = arg.indexOf(':');
  const firstSpace = WHITESPACE_CHAR_RE.exec(arg);
  const firstAt = arg.indexOf('@');

  const spaceOnlyAfterHash = !firstSpace || (firstHash > -1 && firstSpace.index > firstHash);
  const atOnlyAfterHash = firstAt === -1 || (firstHash > -1 && firstAt > firstHash);
  const colonOnlyAfterHash = firstColon === -1 || (firstHash > -1 && firstColon > firstHash);
  const secondSlashOnlyAfterHash = secondSlash === -1 || (firstHash > -1 && secondSlash > firstHash);
  const hasSlash = firstSlash > 0;
  const doesNotEndWithSlash = firstHash > -1 ? arg[firstHash - 1] !== '/' : !arg.endsWith('/');
  const doesNotStartWithDot = arg[0] !== '.';

  return spaceOnlyAfterHash && hasSlash && doesNotEndWithSlash
    && doesNotStartWithDot && atOnlyAfterHash && colonOnlyAfterHash
    && secondSlashOnlyAfterHash;
}

// mirrors validate-npm-package-name, errors only (warnings never influence
// validForOldPackages, which is all npa consults)
function validatePackageName(name: string): string[] {
  const errors: string[] = [];

  if (name.length === 0) {
    errors.push('name length must be greater than zero');
  }
  if (name[0] === '.') {
    errors.push('name cannot start with a period');
  }
  if (name[0] === '-') {
    errors.push('name cannot start with a hyphen');
  }
  if (name[0] === '_') {
    errors.push('name cannot start with an underscore');
  }
  if (name.trim() !== name) {
    errors.push('name cannot contain leading or trailing spaces');
  }
  const lowercased = name.toLowerCase();
  if (lowercased === 'node_modules' || lowercased === 'favicon.ico') {
    errors.push(`${lowercased} is not a valid package name`);
  }

  if (encodeURIComponent(name) !== name) {
    // maybe it's a scoped package name, like @user/package
    const nameMatch = SCOPED_PACKAGE_RE.exec(name);
    let scopedAndUrlSafe = false;
    if (nameMatch) {
      const user = nameMatch[1] as string | undefined;
      const pkg = nameMatch[2];
      if (pkg[0] === '.') {
        errors.push('name cannot start with a period');
      }
      scopedAndUrlSafe = user !== undefined
        && encodeURIComponent(user) === user
        && encodeURIComponent(pkg) === pkg;
    }
    if (!scopedAndUrlSafe) {
      errors.push('name can only contain URL-friendly characters');
    }
  }

  return errors;
}

function createSpecError(message: string, code: string): Error {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  return error;
}
