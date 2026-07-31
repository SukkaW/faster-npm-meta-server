import type { QueryObject } from 'ufo';
import { HttpError, toPackageError } from './errors';
import type { ParsedSpec } from './package-arg';
import { parsePackageArg as parsePackage } from './package-arg';
import type {
  MaybeError,
  PackageError
} from './types';

const COMPACT_HYPHEN_RE = /(?<=\d)-(?=\d)/g;
const FULL_VERSION_SUFFIX_RE = /\d+\.\d+\.\d+$/;
const COMPARATOR_BOUNDARY_RE = /(?<=[0-9x*])(?=[<>=^~])/gi;
const WHITESPACE_RE = /\s+/g;

type PackageHandler<T extends object> = (
  spec: ParsedSpec,
  query: QueryObject
) => Promise<T>;

export async function handlePackagesQuery<T extends object>(
  raw: string,
  query: QueryObject,
  handler: PackageHandler<T>
): Promise<MaybeError<T> | Array<MaybeError<T>>> {
  const throwError = query.throw !== 'false' && query.throw !== false;
  const normalizedRaw = decodeURIComponent(
    raw.replaceAll('%2B', '+')
  ).replaceAll(' ', '+');
  const encodedSpecs = normalizedRaw.split('+');
  const specs: string[] = [];
  for (let index = 0; index < encodedSpecs.length; index++) {
    const spec = decodeURIComponent(encodedSpecs[index]);
    if (spec) {
      specs.push(spec);
    }
  }

  const validSpecs: Array<[index: number, spec: ParsedSpec]> = [];
  const results: Array<MaybeError<T> | undefined> = [];
  results.length = specs.length;

  for (let index = 0; index < specs.length; index++) {
    const rawSpec = specs[index];
    let parsedSpec: ParsedSpec;
    try {
      parsedSpec = parsePackage(normalizeSemverRange(rawSpec));
    } catch (error) {
      const packageError = toPackageError(error, rawSpec);
      if (throwError) {
        throwPackageError(packageError);
      }
      results[index] = packageError;
      continue;
    }

    if (!parsedSpec.name) {
      const packageError: PackageError = {
        status: 400,
        name: rawSpec,
        error: `Invalid package specifier: ${rawSpec}`
      };
      if (throwError) {
        throwPackageError(packageError);
      }
      results[index] = packageError;
      continue;
    }

    validSpecs.push([index, parsedSpec]);
  }

  if (validSpecs.length > 0) {
    const promises: Array<Promise<void>> = [];
    promises.length = validSpecs.length;

    for (let index = 0; index < validSpecs.length; index++) {
      const [resultIndex, parsedSpec] = validSpecs[index];
      promises[index] = (async () => {
        await handler(parsedSpec, query)
          .then((result) => {
            results[resultIndex] = result;
          })
          .catch((error: unknown) => {
            results[resultIndex] = toPackageError(error, parsedSpec.raw);
          });
      })();
    }

    await Promise.allSettled(promises);
  }

  if (throwError) {
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      if (result && isPackageError(result)) {
        throwPackageError(result);
      }
    }
  }

  return results.length === 1
    ? results[0]!
    : results as Array<MaybeError<T>>;
}

function isPackageError(value: object): value is PackageError {
  return 'error' in value;
}

function throwPackageError(error: PackageError): never {
  throw new HttpError(error.error, { status: error.status });
}

function normalizeSemverRange(spec: string): string {
  const lastAtIndex = spec.lastIndexOf('@');
  if (lastAtIndex <= 0) {
    return spec;
  }

  const name = spec.slice(0, lastAtIndex);
  const version = spec.slice(lastAtIndex + 1);
  const normalizedVersion = version
    .replaceAll(COMPACT_HYPHEN_RE, (match, offset, input) => {
      const before = input.slice(0, offset);
      return FULL_VERSION_SUFFIX_RE.test(before) || before.includes('-')
        ? match
        : ' - ';
    })
    .replaceAll(COMPARATOR_BOUNDARY_RE, ' ')
    .replaceAll(WHITESPACE_RE, ' ')
    .trim();

  return `${name}@${normalizedVersion}`;
}
